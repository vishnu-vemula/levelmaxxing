-- Unapplied draft. Requires 001-firebase-users.sql and a verified Firebase
-- integration in PostgREST. A human database operator owns validation and release.
BEGIN;

CREATE TABLE levelmaxing_private.sync_accounts (
    account_id uuid PRIMARY KEY REFERENCES levelmaxing_private.users (id),
    dataset_epoch uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE levelmaxing_private.sync_devices (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.sync_accounts (account_id),
    device_id uuid NOT NULL,
    generation bigint NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 9007199254740991),
    last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (account_id, device_id),
    UNIQUE (account_id, device_id, generation)
);

-- Append-only v1 observations also serve as the immutable change projection.
CREATE TABLE levelmaxing_private.weight_measurements (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.sync_accounts (account_id),
    measurement_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    grams integer NOT NULL CHECK (grams BETWEEN 20000 AND 450000),
    measured_on date NOT NULL CHECK (measured_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
    PRIMARY KEY (account_id, measurement_id),
    UNIQUE (account_id, revision)
);

CREATE TABLE levelmaxing_private.sync_operation_receipts (
    account_id uuid NOT NULL,
    device_id uuid NOT NULL,
    generation bigint NOT NULL,
    seq bigint NOT NULL CHECK (seq BETWEEN 1 AND 9007199254740991),
    request_hash bytea NOT NULL CHECK (pg_catalog.octet_length(request_hash) = 32),
    result jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
    recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    PRIMARY KEY (account_id, device_id, generation, seq),
    FOREIGN KEY (account_id, device_id, generation)
        REFERENCES levelmaxing_private.sync_devices (account_id, device_id, generation)
);

ALTER TABLE levelmaxing_private.sync_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.weight_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.sync_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE levelmaxing_private.sync_accounts, levelmaxing_private.sync_devices,
    levelmaxing_private.weight_measurements, levelmaxing_private.sync_operation_receipts
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION levelmaxing_private.require_sync_participant() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_firebase_uid text := levelmaxing_private.current_firebase_uid();
    v_account_id uuid;
BEGIN
    SELECT u.id INTO v_account_id
    FROM levelmaxing_private.users AS u
    WHERE u.firebase_uuid = v_firebase_uid AND u.status = 'active' AND u.access_role = 'participant';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'participant_required';
    END IF;
    RETURN v_account_id;
END;
$func$;

-- Pin the active status until this RPC commits. Writers take the revision lock first.
CREATE FUNCTION levelmaxing_private.lock_sync_participant(p_account_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $func$
BEGIN
    PERFORM 1
    FROM levelmaxing_private.users AS u
    WHERE u.id = p_account_id AND u.status = 'active' AND u.access_role = 'participant'
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'participant_required';
    END IF;
END;
$func$;

CREATE FUNCTION levelmaxing_private.sync_positive_safe_integer(p_value jsonb) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_number numeric;
BEGIN
    IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
        RETURN NULL;
    END IF;
    v_number := p_value::text::numeric;
    IF v_number < 1 OR v_number > 9007199254740991 OR v_number <> trunc(v_number) THEN
        RETURN NULL;
    END IF;
    RETURN v_number::bigint;
END;
$func$;

CREATE FUNCTION public.levelmaxing_register_device_v1(p_device_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_epoch uuid;
    v_generation bigint;
BEGIN
    IF p_device_id IS NULL OR p_device_id::text COLLATE "C" !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_device';
    END IF;

    INSERT INTO levelmaxing_private.sync_accounts (account_id) VALUES (v_account_id)
        ON CONFLICT (account_id) DO NOTHING;
    SELECT a.dataset_epoch INTO STRICT v_epoch
    FROM levelmaxing_private.sync_accounts AS a
    WHERE a.account_id = v_account_id
    FOR UPDATE;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    INSERT INTO levelmaxing_private.sync_devices (account_id, device_id)
        VALUES (v_account_id, p_device_id) ON CONFLICT (account_id, device_id) DO NOTHING;
    SELECT d.generation INTO STRICT v_generation
    FROM levelmaxing_private.sync_devices AS d
    WHERE d.account_id = v_account_id AND d.device_id = p_device_id;

    RETURN jsonb_build_object('deviceId', p_device_id, 'generation', v_generation, 'epoch', v_epoch);
END;
$func$;

CREATE FUNCTION public.levelmaxing_push_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    v_request_epoch text := p_request ->> 'epoch';
    v_device_text text := p_request ->> 'deviceId';
    v_device_id uuid;
    v_request_generation bigint := levelmaxing_private.sync_positive_safe_integer(p_request -> 'generation');
    v_epoch uuid;
    v_first_revision bigint;
    v_revision bigint;
    v_generation bigint;
    v_first_seq bigint;
    v_last_seq bigint;
    v_prev_request_seq bigint := 0;
    v_seq bigint;
    v_op_id text;
    v_entity_id uuid;
    v_grams integer;
    v_raw_grams bigint;
    v_date_text text;
    v_measured_on date;
    v_op jsonb;
    v_operations jsonb := '[]';
    v_results jsonb := '[]';
    v_hash bytea;
    v_existing_hash bytea;
    v_existing_result jsonb;
    v_result jsonb;
BEGIN
    IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
        OR octet_length(p_request::text) > 262144
        OR jsonb_typeof(p_request -> 'epoch') IS DISTINCT FROM 'string'
        OR v_request_epoch COLLATE "C" !~ '^[A-Za-z0-9_-]{1,80}$'
        OR jsonb_typeof(p_request -> 'deviceId') IS DISTINCT FROM 'string'
        OR v_device_text COLLATE "C" !~ v_uuid_pattern
        OR v_request_generation IS NULL
        OR jsonb_typeof(p_request -> 'ops') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_sync_command';
    END IF;
    IF jsonb_array_length(p_request -> 'ops') NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_sync_command';
    END IF;
    v_device_id := v_device_text::uuid;

    -- Validate and canonicalize the complete bounded batch before taking write locks.
    FOR v_op IN SELECT value FROM jsonb_array_elements(p_request -> 'ops') AS op(value)
    LOOP
        v_seq := levelmaxing_private.sync_positive_safe_integer(v_op -> 'seq');
        v_op_id := v_device_text || '.' || v_request_generation::text || '.' || v_seq::text;
        v_raw_grams := levelmaxing_private.sync_positive_safe_integer(v_op -> 'payload' -> 'grams');
        v_date_text := v_op -> 'payload' ->> 'measuredOn';

        IF jsonb_typeof(v_op) IS DISTINCT FROM 'object'
            OR v_seq IS NULL OR v_seq <= v_prev_request_seq
            OR (v_op -> 'opId') IS DISTINCT FROM to_jsonb(v_op_id)
            OR jsonb_typeof(v_op -> 'entityId') IS DISTINCT FROM 'string'
            OR (v_op ->> 'entityId') COLLATE "C" !~ v_uuid_pattern
            OR (v_op -> 'type') IS DISTINCT FROM '"progress.weight.record"'::jsonb
            OR (v_op -> 'version') IS DISTINCT FROM '1'::jsonb
            OR (v_op -> 'expectedVersion') IS DISTINCT FROM '0'::jsonb
            OR jsonb_typeof(v_op -> 'payload') IS DISTINCT FROM 'object'
            OR v_raw_grams IS NULL OR v_raw_grams NOT BETWEEN 20000 AND 450000
            OR jsonb_typeof(v_op -> 'payload' -> 'measuredOn') IS DISTINCT FROM 'string'
            OR v_date_text COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR substr(v_date_text, 1, 4) = '0000' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_sync_command';
        END IF;
        BEGIN
            v_measured_on := make_date(substr(v_date_text, 1, 4)::integer,
                substr(v_date_text, 6, 2)::integer, substr(v_date_text, 9, 2)::integer);
        EXCEPTION WHEN datetime_field_overflow THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_sync_command';
        END;
        v_prev_request_seq := v_seq;
        v_operations := v_operations || jsonb_build_array(jsonb_build_object(
            'seq', v_seq, 'opId', v_op_id, 'entityId', v_op ->> 'entityId',
            'grams', v_raw_grams::integer, 'measuredOn', to_char(v_measured_on, 'YYYY-MM-DD')
        ));
    END LOOP;

    SELECT a.dataset_epoch, a.revision INTO v_epoch, v_first_revision
    FROM levelmaxing_private.sync_accounts AS a
    WHERE a.account_id = v_account_id
    FOR UPDATE;
    IF NOT FOUND OR v_epoch::text IS DISTINCT FROM v_request_epoch THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'sync_context_changed';
    END IF;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    SELECT d.generation, d.last_seq INTO v_generation, v_first_seq
    FROM levelmaxing_private.sync_devices AS d
    WHERE d.account_id = v_account_id AND d.device_id = v_device_id
    FOR UPDATE;
    IF NOT FOUND OR v_generation IS DISTINCT FROM v_request_generation THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'sync_context_changed';
    END IF;

    v_revision := v_first_revision;
    v_last_seq := v_first_seq;
    FOR v_op IN SELECT value FROM jsonb_array_elements(v_operations) AS op(value)
    LOOP
        v_seq := (v_op ->> 'seq')::bigint;
        v_op_id := v_op ->> 'opId';
        v_entity_id := (v_op ->> 'entityId')::uuid;
        v_grams := (v_op ->> 'grams')::integer;
        v_date_text := v_op ->> 'measuredOn';
        v_measured_on := v_date_text::date;
        v_hash := sha256(convert_to(jsonb_build_array(
            v_account_id, v_epoch, v_device_id, v_generation, v_seq, v_op_id,
            'progress.weight.record', 1, v_entity_id, 0, v_grams, v_date_text
        )::text, 'UTF8'));
        v_result := jsonb_build_object('seq', v_seq, 'opId', v_op_id);

        SELECT r.request_hash, r.result INTO v_existing_hash, v_existing_result
        FROM levelmaxing_private.sync_operation_receipts AS r
        WHERE r.account_id = v_account_id AND r.device_id = v_device_id
            AND r.generation = v_generation AND r.seq = v_seq;
        IF FOUND THEN
            IF v_existing_hash = v_hash THEN
                v_result := v_existing_result;
            ELSE
                v_result := v_result || '{"status":"conflict","code":"operation_body_changed"}'::jsonb;
            END IF;
        ELSIF v_seq <= v_last_seq THEN
            v_result := v_result || '{"status":"processed_receipt_expired","code":"receipt_expired"}'::jsonb;
        ELSIF v_seq <> v_last_seq + 1 THEN
            v_result := v_result || jsonb_build_object('status', 'sequence_gap',
                'code', 'sequence_gap', 'expectedSeq', v_last_seq + 1);
        ELSE
            INSERT INTO levelmaxing_private.weight_measurements
                (account_id, measurement_id, revision, grams, measured_on)
            VALUES (v_account_id, v_entity_id, v_revision + 1, v_grams, v_measured_on)
                ON CONFLICT (account_id, measurement_id) DO NOTHING;
            IF FOUND THEN
                v_revision := v_revision + 1;
                v_result := v_result || jsonb_build_object('status', 'applied',
                    'revision', v_revision::text, 'entityVersion', 1);
            ELSE
                v_result := v_result || '{"status":"conflict","code":"entity_already_exists"}'::jsonb;
            END IF;

            INSERT INTO levelmaxing_private.sync_operation_receipts
                (account_id, device_id, generation, seq, request_hash, result)
            VALUES (v_account_id, v_device_id, v_generation, v_seq, v_hash, v_result);
            v_last_seq := v_seq;
        END IF;
        v_results := v_results || jsonb_build_array(v_result);
    END LOOP;

    IF v_last_seq <> v_first_seq THEN
        UPDATE levelmaxing_private.sync_devices
        SET last_seq = v_last_seq
        WHERE account_id = v_account_id AND device_id = v_device_id;
    END IF;
    IF v_revision <> v_first_revision THEN
        UPDATE levelmaxing_private.sync_accounts
        SET revision = v_revision
        WHERE account_id = v_account_id;
    END IF;

    RETURN jsonb_build_object('results', v_results);
END;
$func$;

CREATE FUNCTION public.levelmaxing_pull_v1(
    p_epoch text, p_after text, p_high_water text, p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_epoch uuid;
    v_revision bigint;
    v_after bigint;
    v_high_water bigint;
    v_groups jsonb;
BEGIN
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
        OR p_after IS NULL OR p_after COLLATE "C" !~ '^(0|[1-9][0-9]{0,18})$'
        OR (p_high_water IS NOT NULL AND p_high_water COLLATE "C" !~ '^(0|[1-9][0-9]{0,18})$')
        OR (p_epoch IS NOT NULL AND p_epoch COLLATE "C" !~ '^[A-Za-z0-9_-]{1,80}$')
        OR (p_epoch IS NULL AND (p_after <> '0' OR p_high_water IS NOT NULL)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cursor_expired';
    END IF;
    BEGIN
        v_after := p_after::bigint;
        v_high_water := p_high_water::bigint;
    EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cursor_expired';
    END;

    -- Bootstrap the empty account on its first read without a hot-path write.
    SELECT a.dataset_epoch, a.revision INTO v_epoch, v_revision
    FROM levelmaxing_private.sync_accounts AS a WHERE a.account_id = v_account_id;
    IF NOT FOUND THEN
        INSERT INTO levelmaxing_private.sync_accounts (account_id) VALUES (v_account_id)
            ON CONFLICT (account_id) DO NOTHING;
        SELECT a.dataset_epoch, a.revision INTO STRICT v_epoch, v_revision
        FROM levelmaxing_private.sync_accounts AS a WHERE a.account_id = v_account_id;
    END IF;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    v_high_water := coalesce(v_high_water, v_revision);
    IF (p_epoch IS NOT NULL AND v_epoch::text IS DISTINCT FROM p_epoch)
        OR v_after > v_high_water OR v_high_water > v_revision THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cursor_expired';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'revision', page.revision::text,
        'items', jsonb_build_array(jsonb_build_object(
            'type', 'progress.weight', 'id', page.measurement_id, 'version', 1,
            'view', jsonb_build_object('grams', page.grams, 'measuredOn', to_char(page.measured_on, 'YYYY-MM-DD'))
        ))
    ) ORDER BY page.revision), '[]'::jsonb) INTO v_groups
    FROM (
        SELECT w.revision, w.measurement_id, w.grams, w.measured_on
        FROM levelmaxing_private.weight_measurements AS w
        WHERE w.account_id = v_account_id AND w.revision > v_after AND w.revision <= v_high_water
        ORDER BY w.revision LIMIT p_limit
    ) AS page;

    RETURN jsonb_build_object('epoch', v_epoch, 'highWater', v_high_water::text, 'groups', v_groups);
END;
$func$;

REVOKE ALL ON FUNCTION levelmaxing_private.require_sync_participant(),
    levelmaxing_private.lock_sync_participant(uuid), levelmaxing_private.sync_positive_safe_integer(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.levelmaxing_register_device_v1(uuid), public.levelmaxing_push_v1(jsonb),
    public.levelmaxing_pull_v1(text, text, text, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.levelmaxing_register_device_v1(uuid), public.levelmaxing_push_v1(jsonb),
    public.levelmaxing_pull_v1(text, text, text, integer)
    TO authenticated;

COMMIT;
