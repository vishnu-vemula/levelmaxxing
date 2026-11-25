-- Unapplied draft. Requires 003–005 and the existing participant authorization.
-- Move operations keep record IDs and leave previously committed versions and
-- receipts intact. Old clients still use the active workspace and normal conflicts.
BEGIN;

CREATE TABLE levelmaxing_private.workspace_history_archive (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.users (id) ON DELETE CASCADE,
    kind text COLLATE "C" NOT NULL CHECK (kind IN ('meals', 'workouts')),
    record_id text COLLATE "C" NOT NULL CHECK (record_id ~ '^[A-Za-z0-9_-]{1,80}$'),
    record_date date NOT NULL CHECK (record_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    value jsonb NOT NULL CHECK (
        jsonb_typeof(value) = 'object'
        AND (value ->> 'id') IS NOT DISTINCT FROM record_id
        AND octet_length(value::text) <= 524288
    ),
    record_tag text COLLATE "C" NOT NULL CHECK (record_tag ~ '^[0-9a-f]{64}$'),
    -- Include the ID, date, tag, delimiters and row keys in the byte estimate.
    row_bytes integer NOT NULL CHECK (row_bytes = octet_length(convert_to(value::text, 'UTF8')) + 208),
    PRIMARY KEY (account_id, kind, record_id)
);

CREATE INDEX workspace_history_archive_page_idx
    ON levelmaxing_private.workspace_history_archive (account_id, kind, record_date DESC, record_id DESC)
    INCLUDE (row_bytes);

CREATE TABLE levelmaxing_private.workspace_history_receipts (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.users (id) ON DELETE CASCADE,
    operation_id uuid NOT NULL,
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    PRIMARY KEY (account_id, operation_id)
);

ALTER TABLE levelmaxing_private.workspace_history_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.workspace_history_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE levelmaxing_private.workspace_history_archive, levelmaxing_private.workspace_history_receipts
    FROM PUBLIC, anon, authenticated, service_role;

-- Use the scoped archive primary key to test active keys. Completed workout
-- IDs also live in the session field of older installations.
CREATE FUNCTION levelmaxing_private.workspace_contains_archived_v1(
    p_account_id uuid, p_section text, p_value jsonb
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $func$
    SELECT CASE
        WHEN p_section NOT IN ('nutrition', 'training') THEN false
        WHEN NOT EXISTS (
            SELECT 1 FROM levelmaxing_private.workspace_history_archive AS archived
            WHERE archived.account_id = p_account_id
              AND archived.kind = CASE p_section WHEN 'nutrition' THEN 'meals' ELSE 'workouts' END
        ) THEN false
        WHEN p_section = 'nutrition' THEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_value -> 'meals') AS item(entry)
            JOIN levelmaxing_private.workspace_history_archive AS archived
              ON archived.account_id = p_account_id
             AND archived.kind = 'meals'
             AND archived.record_id = item.entry ->> 'id'
        )
        WHEN p_section = 'training' THEN EXISTS (
            SELECT 1
            FROM (
                SELECT item.entry ->> 'id' AS id
                FROM jsonb_array_elements(p_value -> 'history') AS item(entry)
                UNION ALL SELECT p_value -> 'session' ->> 'id'
            ) AS active
            JOIN levelmaxing_private.workspace_history_archive AS archived
              ON archived.account_id = p_account_id
             AND archived.kind = 'workouts'
             AND archived.record_id = active.id
        )
        ELSE false
    END;
$func$;

CREATE FUNCTION levelmaxing_private.workspace_reject_archived_v1() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $func$
BEGIN
    IF levelmaxing_private.workspace_contains_archived_v1(NEW.account_id, NEW.section, NEW.value) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'workspace_records_archived';
    END IF;
    RETURN NEW;
END;
$func$;

CREATE TRIGGER workspace_versions_reject_archived_v1
    BEFORE INSERT OR UPDATE OF account_id, section, value ON levelmaxing_private.workspace_versions
    FOR EACH ROW EXECUTE FUNCTION levelmaxing_private.workspace_reject_archived_v1();

-- Preserve the existing public signature and receipt format. Only an otherwise
-- applicable write is tested for archived IDs. Turning it into a retained normal
-- conflict lets legacy clients resolve the outbox without an endless retry.
CREATE OR REPLACE FUNCTION public.levelmaxing_workspace_save_v1(
    p_section text, p_expect bigint, p_operation_id uuid, p_value jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_request_hash bytea;
    v_prior_hash bytea;
    v_version bigint;
    v_value jsonb;
    v_outcome text;
BEGIN
    IF p_section IS NULL OR p_section COLLATE "C" NOT IN ('profile', 'training', 'nutrition', 'journal')
        OR p_expect IS NULL OR p_expect NOT BETWEEN 0 AND 9007199254740991
        OR p_operation_id IS NULL OR p_operation_id::text COLLATE "C" !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
        OR octet_length(p_value::text) > 524288 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_value';
    END IF;
    IF NOT levelmaxing_private.workspace_value_valid_v1(p_section, p_value) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_value';
    END IF;
    v_request_hash := sha256(convert_to(jsonb_build_array(p_section, p_expect, p_value)::text, 'UTF8'));

    -- A caller owns one operation ID namespace across sections. Serializing only
    -- its writes protects that namespace and each section CAS, including first insert.
    PERFORM pg_advisory_xact_lock(hashtextextended('levelmaxing.workspace:' || v_account_id::text, 0));
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    SELECT r.request_hash, r.outcome, r.snapshot_version INTO v_prior_hash, v_outcome, v_version
    FROM levelmaxing_private.workspace_receipts AS r
    WHERE r.account_id = v_account_id AND r.operation_id = p_operation_id;
    IF FOUND THEN
        IF v_prior_hash IS DISTINCT FROM v_request_hash THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'workspace_operation_changed';
        END IF;
        SELECT s.value INTO v_value
        FROM levelmaxing_private.workspace_versions AS s
        WHERE s.account_id = v_account_id AND s.section = p_section AND s.version = v_version;
    ELSE
        SELECT s.version, s.value INTO v_version, v_value
        FROM levelmaxing_private.workspace_versions AS s
        WHERE s.account_id = v_account_id AND s.section = p_section
        ORDER BY s.version DESC LIMIT 1;

        v_version := coalesce(v_version, 0);
        IF v_version = p_expect
            AND NOT levelmaxing_private.workspace_contains_archived_v1(v_account_id, p_section, p_value) THEN
            v_version := v_version + 1;
            v_value := p_value;
            v_outcome := 'applied';
            INSERT INTO levelmaxing_private.workspace_versions (account_id, section, version, value)
            VALUES (v_account_id, p_section, v_version, v_value);
        ELSE
            v_outcome := 'conflict';
        END IF;
        INSERT INTO levelmaxing_private.workspace_receipts
            (account_id, operation_id, section, request_hash, outcome, snapshot_version)
        VALUES (v_account_id, p_operation_id, p_section, v_request_hash, v_outcome, nullif(v_version, 0));
    END IF;

    RETURN jsonb_build_object('outcome', v_outcome, 'snapshot',
        jsonb_build_object('version', coalesce(v_version, 0), 'value', v_value));
END;
$func$;

CREATE FUNCTION public.levelmaxing_history_page_v1(
    p_kind text, p_limit integer, p_before_date text, p_before_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_before_date date;
    v_result jsonb;
BEGIN
    IF p_kind IS NULL OR p_kind COLLATE "C" NOT IN ('meals', 'workouts')
        OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
        OR (p_before_date IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_history_request';
    END IF;
    IF p_before_date IS NOT NULL THEN
        IF NOT levelmaxing_private.workspace_matches_rule_v1(to_jsonb(p_before_date), '["date"]', '{}')
            OR p_before_id COLLATE "C" !~ '^[A-Za-z0-9_-]{1,80}$' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_history_request';
        END IF;
        v_before_date := p_before_date::date;
    END IF;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    -- Find the longest prefix that fits both budgets using index metadata.
    -- Only fetch large JSONB values for emitted rows. Leave room for the
    -- response envelope and cursor, and return the last emitted tuple.
    WITH candidates AS MATERIALIZED (
        SELECT archived.record_date, archived.record_id, archived.row_bytes
        FROM levelmaxing_private.workspace_history_archive AS archived
        WHERE archived.account_id = v_account_id AND archived.kind = p_kind
          AND (archived.record_date, archived.record_id) <
              (coalesce(v_before_date, 'infinity'::date), coalesce(p_before_id, '') COLLATE "C")
        ORDER BY archived.record_date DESC, archived.record_id DESC
        LIMIT p_limit + 1
    ), ranked AS (
        SELECT candidates.record_date, candidates.record_id,
            row_number() OVER page_order AS position,
            sum(candidates.row_bytes) OVER page_order AS bytes
        FROM candidates
        WINDOW page_order AS (ORDER BY candidates.record_date DESC, candidates.record_id DESC)
    ), visible AS MATERIALIZED (
        SELECT ranked.record_date, ranked.record_id
        FROM ranked
        WHERE ranked.position <= p_limit AND ranked.bytes <= 1044480 -- 1 MiB less 4096 bytes
    )
    SELECT jsonb_build_object(
        'rows', coalesce(jsonb_agg(jsonb_build_object(
            'id', visible.record_id, 'date', to_char(visible.record_date, 'YYYY-MM-DD'),
            'tag', archived.record_tag, 'value', archived.value
        ) ORDER BY visible.record_date DESC, visible.record_id DESC), '[]'::jsonb),
        'next', CASE WHEN (SELECT count(*) FROM candidates) > count(*) THEN (
            SELECT jsonb_build_object('date', to_char(last_row.record_date, 'YYYY-MM-DD'), 'id', last_row.record_id)
            FROM visible AS last_row
            ORDER BY last_row.record_date, last_row.record_id
            LIMIT 1
        ) ELSE NULL END
    )
    INTO v_result
    FROM visible
    JOIN levelmaxing_private.workspace_history_archive AS archived
      ON archived.account_id = v_account_id AND archived.kind = p_kind AND archived.record_id = visible.record_id;
    RETURN v_result;
END;
$func$;

CREATE FUNCTION public.levelmaxing_history_move_v1(
    p_action text, p_kind text, p_ids text[], p_operation_id uuid, p_expect_version bigint, p_known text,
    p_record_tags text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_request_hash bytea;
    v_prior_hash bytea;
    v_result jsonb;
    v_section text;
    v_field text;
    v_count_limit integer;
    v_date_field text;
    v_version bigint;
    v_tag text;
    v_applied_hash bytea;
    v_value jsonb;
    v_active jsonb;
    v_selected jsonb;
    v_next_active jsonb;
    v_next_value jsonb;
    v_workspace_operation uuid;
    v_row_count integer;
    v_outcome text;
    v_moved integer := 0;
BEGIN
    IF p_action IS NULL OR p_action COLLATE "C" NOT IN ('archive', 'restore')
        OR p_kind IS NULL OR p_kind COLLATE "C" NOT IN ('meals', 'workouts')
        OR p_ids IS NULL OR array_ndims(p_ids) IS DISTINCT FROM 1 OR cardinality(p_ids) NOT BETWEEN 1 AND 20
        OR (p_action = 'archive' AND p_record_tags IS NOT NULL)
        OR (p_action = 'restore' AND (
            p_record_tags IS NULL OR array_ndims(p_record_tags) IS DISTINCT FROM 1
            OR cardinality(p_record_tags) <> cardinality(p_ids)
        ))
        OR p_operation_id IS NULL OR p_operation_id::text COLLATE "C" !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_expect_version IS NULL OR p_expect_version NOT BETWEEN 1 AND 9007199254740991
        OR p_known IS NULL OR char_length(p_known) <> 64
        OR p_known COLLATE "C" !~ '^[0-9a-f]{64}$' OR p_known = repeat('0', 64) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_history_request';
    END IF;
    IF EXISTS (
            SELECT 1 FROM unnest(p_ids) AS requested(id)
            WHERE requested.id IS NULL OR requested.id COLLATE "C" !~ '^[A-Za-z0-9_-]{1,80}$'
        )
        OR (SELECT count(DISTINCT item.id COLLATE "C") FROM unnest(p_ids) AS item(id)) <> cardinality(p_ids)
        OR EXISTS (
            SELECT 1 FROM unnest(p_record_tags) AS requested(tag)
            WHERE requested.tag IS NULL OR char_length(requested.tag) <> 64
                OR requested.tag COLLATE "C" !~ '^[0-9a-f]{64}$'
        ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_history_request';
    END IF;

    v_section := CASE p_kind WHEN 'meals' THEN 'nutrition' ELSE 'training' END;
    v_field := CASE p_kind WHEN 'meals' THEN 'meals' ELSE 'history' END;
    v_count_limit := CASE p_kind WHEN 'meals' THEN 5000 ELSE 1200 END;
    v_date_field := CASE p_kind WHEN 'meals' THEN 'date' ELSE 'finishedAt' END;
    v_request_hash := sha256(convert_to(
        jsonb_build_array(p_action, p_kind, p_ids, p_expect_version, p_known, p_record_tags)::text, 'UTF8'
    ));

    -- Lock order is identical to the existing workspace writer. The archive,
    -- active version and both receipts commit together or roll back together.
    PERFORM pg_advisory_xact_lock(hashtextextended('levelmaxing.workspace:' || v_account_id::text, 0));
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    SELECT receipt.request_hash, receipt.result INTO v_prior_hash, v_result
    FROM levelmaxing_private.workspace_history_receipts AS receipt
    WHERE receipt.account_id = v_account_id AND receipt.operation_id = p_operation_id;
    IF FOUND THEN
        IF v_prior_hash IS DISTINCT FROM v_request_hash THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'history_operation_changed';
        END IF;
        RETURN v_result;
    END IF;

    SELECT head.version, head.value INTO v_version, v_value
    FROM levelmaxing_private.workspace_versions AS head
    WHERE head.account_id = v_account_id AND head.section = v_section
    ORDER BY head.version DESC
    LIMIT 1;
    v_version := coalesce(v_version, 0);
    SELECT receipt.request_hash INTO v_applied_hash
    FROM levelmaxing_private.workspace_receipts AS receipt
    WHERE receipt.account_id = v_account_id AND receipt.section = v_section
      AND receipt.snapshot_version = v_version AND receipt.outcome = 'applied';
    v_tag := levelmaxing_private.workspace_representation_tag_v1(v_account_id, v_section, v_version, v_applied_hash);

    IF v_version <> p_expect_version OR v_tag <> p_known THEN
        v_outcome := 'conflict';
    ELSIF v_version = 9007199254740991 THEN
        v_outcome := 'capacity';
    ELSE
        v_active := v_value -> v_field;

        IF p_action = 'archive' THEN
            SELECT
                coalesce(jsonb_agg(item.entry ORDER BY item.position)
                    FILTER (WHERE item.entry ->> 'id' = ANY(p_ids)), '[]'::jsonb),
                coalesce(jsonb_agg(item.entry ORDER BY item.position)
                    FILTER (WHERE item.entry ->> 'id' <> ALL(p_ids)), '[]'::jsonb)
            INTO v_selected, v_next_active
            FROM jsonb_array_elements(v_active) WITH ORDINALITY AS item(entry, position);

            IF jsonb_array_length(v_selected) <> cardinality(p_ids)
                OR (p_kind = 'workouts' AND coalesce((v_value -> 'session' ->> 'id') = ANY(p_ids), false))
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_selected) AS item(entry)
                    WHERE NOT levelmaxing_private.workspace_matches_rule_v1(
                        to_jsonb(left(item.entry ->> v_date_field, 10)), '["date"]', '{}'
                    )
                ) THEN
                v_outcome := 'missing';
            ELSIF EXISTS (
                SELECT 1 FROM levelmaxing_private.workspace_history_archive AS archived
                WHERE archived.account_id = v_account_id AND archived.kind = p_kind AND archived.record_id = ANY(p_ids)
            ) THEN
                v_outcome := 'conflict';
            ELSE
                INSERT INTO levelmaxing_private.workspace_history_archive
                    (account_id, kind, record_id, record_date, value, record_tag, row_bytes)
                SELECT v_account_id, p_kind, entry ->> 'id', left(entry ->> v_date_field, 10)::date, entry,
                    encode(sha256(convert_to(jsonb_build_array(
                        v_account_id, p_kind, left(entry ->> v_date_field, 10), entry ->> 'id', entry
                    )::text, 'UTF8')), 'hex'),
                    octet_length(convert_to(entry::text, 'UTF8')) + 208
                FROM jsonb_array_elements(v_selected) AS item(entry);
            END IF;
        ELSE
            SELECT coalesce(jsonb_agg(archived.value ORDER BY archived.record_date DESC, archived.record_id DESC), '[]'::jsonb)
            INTO v_selected
            FROM levelmaxing_private.workspace_history_archive AS archived
            WHERE archived.account_id = v_account_id AND archived.kind = p_kind AND archived.record_id = ANY(p_ids);

            IF jsonb_array_length(v_selected) <> cardinality(p_ids) THEN
                v_outcome := 'missing';
            ELSIF EXISTS (
                -- A dataset restore can preserve the active version and tag
                -- while changing an archived ID's content. Check the exact
                -- reviewed rows under the same lock before moving them.
                SELECT 1 FROM unnest(p_ids, p_record_tags) AS requested(id, tag)
                JOIN levelmaxing_private.workspace_history_archive AS archived
                  ON archived.account_id = v_account_id AND archived.kind = p_kind
                 AND archived.record_id = requested.id
                WHERE archived.record_tag <> requested.tag
            ) OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(v_active) AS item(entry)
                WHERE item.entry ->> 'id' = ANY(p_ids)
            ) OR (p_kind = 'workouts' AND coalesce((v_value -> 'session' ->> 'id') = ANY(p_ids), false)) THEN
                v_outcome := 'conflict';
            ELSE
                v_next_active := v_active || v_selected;
                IF p_kind = 'workouts' THEN
                    SELECT jsonb_agg(item.entry ORDER BY
                        coalesce(item.entry ->> 'finishedAt', item.entry ->> 'startedAt') COLLATE "C" DESC,
                        (item.entry ->> 'id') COLLATE "C" DESC
                    ) INTO v_next_active
                    FROM jsonb_array_elements(v_next_active) AS item(entry);
                END IF;
                v_next_value := jsonb_set(v_value, ARRAY[v_field], v_next_active);
                -- JSONB's text form includes spaces. This deliberately leaves
                -- headroom so the next ordinary phone write still fits v1.
                IF jsonb_array_length(v_next_active) > v_count_limit OR octet_length(convert_to(jsonb_build_object(
                    'section', v_section, 'expect', 9007199254740991,
                    'operationId', p_operation_id, 'value', v_next_value
                )::text, 'UTF8')) > 262144 THEN
                    v_outcome := 'capacity';
                ELSE
                    -- The records immediately reappear in the active version
                    -- below. Prior committed workspace versions are retained.
                    DELETE FROM levelmaxing_private.workspace_history_archive AS archived
                    WHERE archived.account_id = v_account_id AND archived.kind = p_kind AND archived.record_id = ANY(p_ids);
                    GET DIAGNOSTICS v_row_count = ROW_COUNT;
                    IF v_row_count <> cardinality(p_ids) THEN
                        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'history_write_retry';
                    END IF;
                END IF;
            END IF;
        END IF;

        IF v_outcome IS NULL THEN
            v_next_value := coalesce(v_next_value, jsonb_set(v_value, ARRAY[v_field], v_next_active));
            v_workspace_operation := gen_random_uuid();
            v_result := public.levelmaxing_workspace_save_checked_v1(
                v_section, v_version, v_workspace_operation, v_next_value, v_tag
            );
            IF v_result ->> 'outcome' IS DISTINCT FROM 'applied'
                OR (v_result -> 'snapshot' ->> 'version')::bigint IS DISTINCT FROM v_version + 1
                OR v_result ->> 'tag' IS NULL THEN
                RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'history_write_retry';
            END IF;

            v_version := v_version + 1;
            v_tag := v_result ->> 'tag';
            v_outcome := 'applied';
            v_moved := cardinality(p_ids);
        END IF;
    END IF;

    v_result := jsonb_build_object('outcome', v_outcome, 'moved', v_moved, 'version', v_version, 'tag', v_tag);
    INSERT INTO levelmaxing_private.workspace_history_receipts (account_id, operation_id, request_hash, result)
        VALUES (v_account_id, p_operation_id, v_request_hash, v_result);
    RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION levelmaxing_private.workspace_contains_archived_v1(uuid, text, jsonb),
    levelmaxing_private.workspace_reject_archived_v1(),
    public.levelmaxing_workspace_save_v1(text, bigint, uuid, jsonb),
    public.levelmaxing_history_page_v1(text, integer, text, text),
    public.levelmaxing_history_move_v1(text, text, text[], uuid, bigint, text, text[])
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.levelmaxing_workspace_save_v1(text, bigint, uuid, jsonb),
    public.levelmaxing_history_page_v1(text, integer, text, text),
    public.levelmaxing_history_move_v1(text, text, text[], uuid, bigint, text, text[])
    TO authenticated;

COMMIT;
