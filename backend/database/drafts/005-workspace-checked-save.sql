-- Unapplied additive draft. Requires 003 and the batch function from 004.
-- Keep the existing write function and receipt namespace during rollout.
BEGIN;

CREATE FUNCTION public.levelmaxing_workspace_save_checked_v1(
    p_section text, p_expect bigint, p_operation_id uuid, p_value jsonb, p_known text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_current jsonb;
    v_snapshot jsonb;
    v_version bigint;
    v_request_hash bytea;
    v_result jsonb;
BEGIN
    IF p_section IS NULL OR p_section COLLATE "C" NOT IN ('profile', 'training', 'nutrition', 'journal')
        OR p_expect IS NULL OR p_expect NOT BETWEEN 0 AND 9007199254740991
        OR p_operation_id IS NULL OR p_operation_id::text COLLATE "C" !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR p_known IS NULL OR char_length(p_known) <> 64 OR p_known COLLATE "C" !~ '^[0-9a-f]{64}$'
        OR (p_expect = 0) <> (p_known = repeat('0', 64))
        OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
        OR octet_length(p_value::text) > 524288 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_value';
    END IF;

    -- Hold the same per-account advisory lock as the legacy writer through tag
    -- comparison and receipt commit. A replay still returns its original result.
    PERFORM pg_advisory_xact_lock(hashtextextended('levelmaxing.workspace:' || v_account_id::text, 0));
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);
    SELECT r.request_hash INTO v_request_hash FROM levelmaxing_private.workspace_receipts AS r
    WHERE r.account_id = v_account_id AND r.operation_id = p_operation_id;
    IF FOUND THEN
        v_result := public.levelmaxing_workspace_save_v1(p_section, p_expect, p_operation_id, p_value);
    ELSE
        v_current := public.levelmaxing_workspace_batch_v1(jsonb_build_array(jsonb_build_object(
            'section', p_section, 'known', p_known
        ))) -> 'sections' -> 0;
        v_snapshot := v_current -> 'snapshot';
        v_version := (v_snapshot ->> 'version')::bigint;

        IF v_current ->> 'tag' = p_known OR v_version <> p_expect THEN
            v_result := public.levelmaxing_workspace_save_v1(p_section, p_expect, p_operation_id, p_value);
        ELSE
            IF NOT levelmaxing_private.workspace_value_valid_v1(p_section, p_value) THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_value';
            END IF;

            -- An equal version with a different representation is possible
            -- after restore. Record the conflict using the legacy command hash.
            v_request_hash := sha256(convert_to(jsonb_build_array(p_section, p_expect, p_value)::text, 'UTF8'));
            INSERT INTO levelmaxing_private.workspace_receipts
                (account_id, operation_id, section, request_hash, outcome, snapshot_version)
            VALUES (v_account_id, p_operation_id, p_section, v_request_hash, 'conflict', nullif(v_version, 0));
            RETURN jsonb_build_object('outcome', 'conflict', 'snapshot', v_snapshot);
        END IF;
    END IF;

    IF v_result ->> 'outcome' = 'applied' THEN
        IF v_request_hash IS NULL THEN
            SELECT r.request_hash INTO STRICT v_request_hash FROM levelmaxing_private.workspace_receipts AS r
            WHERE r.account_id = v_account_id AND r.operation_id = p_operation_id;
        END IF;
        -- Use the receipt version, including if a subsequent operation has
        -- advanced the section. Retries reproduce the original applied tag.
        v_version := (v_result -> 'snapshot' ->> 'version')::bigint;
        RETURN v_result || jsonb_build_object('tag', levelmaxing_private.workspace_representation_tag_v1(
            v_account_id, p_section, v_version, v_request_hash
        ));
    END IF;
    RETURN v_result;
END;
$func$;

REVOKE ALL ON FUNCTION public.levelmaxing_workspace_save_checked_v1(text, bigint, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.levelmaxing_workspace_save_checked_v1(text, bigint, uuid, jsonb, text)
    TO authenticated;

COMMIT;
