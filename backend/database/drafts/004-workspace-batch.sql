-- Unapplied additive draft. Requires 003-participant-workspace.sql.
-- Keep existing per-section reads and save receipts available during rollout.

-- Each successfully applied version has exactly one such receipt. Filtering
-- avoids scanning stale-operation receipts that reference the same snapshot.
-- A database operator builds this index outside a transaction and verifies it is
-- valid before applying the function block. The build can run while writes continue.
CREATE INDEX CONCURRENTLY workspace_applied_representation_idx
    ON levelmaxing_private.workspace_receipts (account_id, section, snapshot_version)
    INCLUDE (request_hash) WHERE outcome = 'applied';

BEGIN;

-- For an applied version, the immutable receipt hash covers the entire
-- document. A preserved version without its receipt still has a content tag.
CREATE FUNCTION levelmaxing_private.workspace_representation_tag_v1(
    p_account_id uuid, p_section text, p_version bigint, p_request_hash bytea
) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $func$
    SELECT CASE WHEN p_version = 0 THEN repeat('0', 64)
        ELSE encode(sha256(convert_to(jsonb_build_array(
            p_account_id, p_section, p_version,
            coalesce(encode(p_request_hash, 'hex'), (
                SELECT encode(sha256(convert_to(saved.value::text, 'UTF8')), 'hex')
                FROM levelmaxing_private.workspace_versions AS saved
                WHERE saved.account_id = p_account_id AND saved.section = p_section AND saved.version = p_version
            ))
        )::text, 'UTF8')), 'hex')
    END;
$func$;

CREATE FUNCTION public.levelmaxing_workspace_batch_v1(p_sections jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_result jsonb;
BEGIN
    IF jsonb_typeof(p_sections) IS DISTINCT FROM 'array' OR octet_length(p_sections::text) > 1024 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_batch';
    END IF;
    IF jsonb_array_length(p_sections) NOT BETWEEN 1 AND 4 OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sections) AS item(entry)
        WHERE CASE WHEN jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN true
            ELSE NOT (entry ?& ARRAY['section', 'known']) OR (entry - ARRAY['section', 'known']) <> '{}'::jsonb
                OR jsonb_typeof(entry -> 'section') IS DISTINCT FROM 'string'
                OR (entry ->> 'section') COLLATE "C" NOT IN ('profile', 'training', 'nutrition', 'journal')
                OR (
                    jsonb_typeof(entry -> 'known') IS DISTINCT FROM 'null'
                    AND (jsonb_typeof(entry -> 'known') IS DISTINCT FROM 'string'
                         OR (entry ->> 'known') COLLATE "C" !~ '^[0-9a-f]{64}$')
                )
            END
    ) OR (
        SELECT count(DISTINCT (item.entry ->> 'section') COLLATE "C")
        FROM jsonb_array_elements(p_sections) AS item(entry)
    ) <> jsonb_array_length(p_sections) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_batch';
    END IF;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    -- In v1 the successful receipt commits atomically with the immutable
    -- version, and its hash incorporates the complete document. The ordinary
    -- unchanged read only accesses version and receipt indexes. If an operator
    -- ever compacts receipts, safely derive a tag from the actual document.
    WITH requested AS (
        SELECT entry ->> 'section' AS section, entry ->> 'known' AS known, position
        FROM jsonb_array_elements(p_sections) WITH ORDINALITY AS item(entry, position)
    ), heads AS MATERIALIZED (
        SELECT requested.section, requested.known, requested.position, coalesce(head.version, 0) AS version,
            levelmaxing_private.workspace_representation_tag_v1(
                v_account_id, requested.section, coalesce(head.version, 0), receipt.request_hash
            ) AS tag
        FROM requested
        LEFT JOIN LATERAL (
            SELECT s.version
            FROM levelmaxing_private.workspace_versions AS s
            WHERE s.account_id = v_account_id AND s.section = requested.section
            ORDER BY s.version DESC LIMIT 1
        ) AS head ON true
        LEFT JOIN LATERAL (
            SELECT r.request_hash
            FROM levelmaxing_private.workspace_receipts AS r
            WHERE r.account_id = v_account_id AND r.section = requested.section AND r.snapshot_version = head.version
                AND r.outcome = 'applied'
            LIMIT 1
        ) AS receipt ON true
    )
    SELECT jsonb_build_object('sections', jsonb_agg(jsonb_build_object(
        'section', heads.section, 'tag', heads.tag,
        'snapshot', CASE WHEN heads.known = heads.tag THEN NULL
            ELSE jsonb_build_object('version', heads.version, 'value', (
                SELECT saved.value
                FROM levelmaxing_private.workspace_versions AS saved
                WHERE saved.account_id = v_account_id AND saved.section = heads.section AND saved.version = heads.version
            ))
        END
    ) ORDER BY heads.position))
    INTO v_result
    FROM heads;
    RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION levelmaxing_private.workspace_representation_tag_v1(uuid, text, bigint, bytea),
    public.levelmaxing_workspace_batch_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.levelmaxing_workspace_batch_v1(jsonb) TO authenticated;

COMMIT;
