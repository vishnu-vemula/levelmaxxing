-- Unapplied draft. Requires 001-firebase-users.sql and 002-progress-sync.sql.
-- A human database operator owns migration testing and release.
BEGIN;

-- Immutable values let a replay reproduce its original snapshot. Multiple receipts
-- can reference one version without copying that version's document.
CREATE TABLE levelmaxing_private.workspace_versions (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.users (id) ON DELETE CASCADE,
    section text COLLATE "C" NOT NULL CHECK (section IN ('profile', 'training', 'nutrition', 'journal')),
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    value jsonb NOT NULL CHECK (
        pg_catalog.jsonb_typeof(value) = 'object' AND pg_catalog.octet_length(value::text) <= 524288
    ),
    PRIMARY KEY (account_id, section, version)
);

CREATE TABLE levelmaxing_private.workspace_receipts (
    account_id uuid NOT NULL REFERENCES levelmaxing_private.users (id) ON DELETE CASCADE,
    operation_id uuid NOT NULL,
    section text COLLATE "C" NOT NULL CHECK (section IN ('profile', 'training', 'nutrition', 'journal')),
    request_hash bytea NOT NULL CHECK (pg_catalog.octet_length(request_hash) = 32),
    outcome text NOT NULL CHECK (outcome IN ('applied', 'conflict')),
    snapshot_version bigint,
    CHECK (outcome = 'conflict' OR snapshot_version IS NOT NULL),
    PRIMARY KEY (account_id, operation_id),
    FOREIGN KEY (account_id, section, snapshot_version)
        REFERENCES levelmaxing_private.workspace_versions (account_id, section, version) ON DELETE CASCADE
);

CREATE INDEX workspace_receipts_version_idx
    ON levelmaxing_private.workspace_receipts (account_id, section, snapshot_version);

ALTER TABLE levelmaxing_private.workspace_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.workspace_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE levelmaxing_private.workspace_versions, levelmaxing_private.workspace_receipts
    FROM PUBLIC, anon, authenticated, service_role;

-- JSONB writes are directly reachable by a Firebase participant through PostgREST.
-- Keep these fixed v1 rules aligned with packages/contracts/src/workspace.ts.
-- The rule document is private and never comes from the caller.
CREATE FUNCTION levelmaxing_private.workspace_matches_rule_v1(p_value jsonb, p_rule jsonb, p_types jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_rule text := p_rule ->> 0;
    v_type text := jsonb_typeof(p_value);
    v_text text;
    v_length integer;
    v_number numeric;
    v_year integer;
    v_month integer;
    v_day integer;
    v_items bigint;
    v_distinct bigint;
BEGIN
    IF v_rule = 'optional' THEN
        RETURN p_value IS NULL OR levelmaxing_private.workspace_matches_rule_v1(p_value, p_rule -> 1, p_types);
    END IF;
    IF p_value IS NULL THEN
        RETURN false;
    END IF;
    CASE v_rule
        WHEN 'nullable' THEN
            RETURN v_type = 'null' OR levelmaxing_private.workspace_matches_rule_v1(p_value, p_rule -> 1, p_types);
        WHEN 'ref' THEN
            RETURN levelmaxing_private.workspace_matches_rule_v1(p_value, p_types -> (p_rule ->> 1), p_types);
        WHEN 'object' THEN
            IF v_type <> 'object' THEN RETURN false; END IF;
            RETURN NOT EXISTS (
                SELECT 1 FROM jsonb_object_keys(p_value) AS field(key) WHERE NOT ((p_rule -> 1) ? field.key)
            ) AND NOT EXISTS (
                SELECT 1 FROM jsonb_each(p_rule -> 1) AS field(key, rule)
                WHERE NOT levelmaxing_private.workspace_matches_rule_v1(p_value -> field.key, field.rule, p_types)
            );
        WHEN 'array', 'entities' THEN
            IF v_type <> 'array' THEN RETURN false; END IF;
            IF jsonb_array_length(p_value) > (p_rule ->> 2)::integer THEN RETURN false; END IF;
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements(p_value) AS item(value)
                WHERE NOT levelmaxing_private.workspace_matches_rule_v1(item.value, p_rule -> 1, p_types)
            ) THEN RETURN false; END IF;
            IF v_rule = 'entities' THEN
                SELECT count(*), count(DISTINCT (item.value ->> 'id') COLLATE "C") INTO v_items, v_distinct
                FROM jsonb_array_elements(p_value) AS item(value);
                RETURN v_items = v_distinct;
            END IF;
            RETURN true;
        WHEN 'boolean' THEN
            RETURN v_type = 'boolean';
        WHEN 'oneOf' THEN
            RETURN v_type = 'string' AND (p_rule -> 1) ? (p_value #>> '{}');
        WHEN 'number', 'integer' THEN
            IF v_type <> 'number' THEN RETURN false; END IF;
            v_number := p_value::text::numeric;
            RETURN v_number BETWEEN (p_rule ->> 1)::numeric AND (p_rule ->> 2)::numeric
                AND (v_rule <> 'integer' OR trunc(v_number) = v_number);
        WHEN 'id' THEN
            RETURN v_type = 'string' AND (p_value #>> '{}') COLLATE "C" ~ '^[A-Za-z0-9_-]{1,80}$';
        WHEN 'string' THEN
            IF v_type <> 'string' THEN RETURN false; END IF;
            v_text := p_value #>> '{}';
            -- Count supplementary code points as two UTF-16 units, matching JS.
            v_length := char_length(v_text) + regexp_count(v_text COLLATE "C", U&'[\+010000-\+10FFFF]');
            RETURN v_length BETWEEN (p_rule ->> 1)::integer AND (p_rule ->> 2)::integer
                AND ((p_rule ->> 1)::integer = 0 OR btrim(v_text,
                    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> '');
        WHEN 'date', 'instant' THEN
            IF v_type <> 'string' THEN RETURN false; END IF;
            v_text := p_value #>> '{}';
            IF v_rule = 'date' THEN
                IF v_text COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(v_text, 4) = '0000' THEN
                    RETURN false;
                END IF;
            ELSIF v_text COLLATE "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$' THEN
                RETURN false;
            END IF;
            v_year := substr(v_text, 1, 4)::integer;
            v_month := substr(v_text, 6, 2)::integer;
            v_day := substr(v_text, 9, 2)::integer;
            RETURN v_month BETWEEN 1 AND 12 AND v_day BETWEEN 1 AND CASE v_month
                WHEN 2 THEN CASE WHEN v_year % 4 = 0 AND (v_year % 100 <> 0 OR v_year % 400 = 0) THEN 29 ELSE 28 END
                WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END;
        ELSE
            RETURN false;
    END CASE;
END;
$func$;

CREATE FUNCTION levelmaxing_private.workspace_value_valid_v1(p_section text, p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_types constant jsonb := $rules$
    {
      "profile": ["object", {
        "name": ["string", 0, 120], "goal": ["string", 0, 120], "experience": ["string", 0, 120],
        "equipment": ["array", ["ref", "name"], 30], "weekdays": ["array", ["ref", "name"], 7],
        "minutes": ["integer", 0, 600], "muscles": ["array", ["ref", "name"], 30],
        "calories": ["nullable", ["integer", 1, 20000]], "units": ["oneOf", ["kg", "lb"]], "onboarded": ["boolean"]
      }],
      "training": ["object", {
        "activeProgramId": ["nullable", ["id"]], "session": ["nullable", ["ref", "workout"]],
        "history": ["entities", ["ref", "workout"], 1200], "programs": ["entities", ["object", {
          "id": ["id"], "name": ["ref", "name"], "days": ["entities", ["object", {
            "id": ["id"], "name": ["ref", "name"], "weekday": ["optional", ["integer", 0, 6]],
            "exercises": ["entities", ["object", {
              "id": ["id"], "name": ["ref", "name"], "sets": ["integer", 1, 100],
              "reps": ["integer", 1, 1000], "restSeconds": ["integer", 0, 3600]
            }], 70]
          }], 30]
        }], 100]
      }],
      "nutrition": ["object", {
        "meals": ["entities", ["object", {
          "id": ["id"], "name": ["ref", "name"], "date": ["date"], "meal": ["oneOf", ["Breakfast", "Lunch", "Dinner", "Snack"]],
          "quantity": ["number", 0.000001, 1000000], "unit": ["string", 1, 50], "macros": ["ref", "macros"],
          "source": ["string", 1, 140]
        }], 5000],
        "recipes": ["entities", ["object", {
          "id": ["id"], "name": ["ref", "name"], "servings": ["number", 0.000001, 10000],
          "ingredients": ["entities", ["object", {
            "id": ["id"], "name": ["ref", "name"], "amount": ["string", 0, 120], "macros": ["ref", "macros"]
          }], 100]
        }], 200],
        "groceries": ["entities", ["object", {
          "id": ["id"], "name": ["ref", "name"], "amount": ["string", 0, 120], "checked": ["boolean"],
          "priceCents": ["nullable", ["integer", 0, 100000000]], "store": ["string", 0, 120]
        }], 500]
      }],
      "journal": ["object", {
        "checkIns": ["entities", ["object", {
          "id": ["id"], "date": ["date"], "hunger": ["integer", 1, 5], "energy": ["integer", 1, 5],
          "sleep": ["number", 0, 24], "note": ["string", 0, 2000]
        }], 1500],
        "activities": ["entities", ["object", {
          "id": ["id"], "date": ["date"], "name": ["ref", "name"], "minutes": ["integer", 1, 1440]
        }], 3000],
        "bookmarks": ["array", ["id"], 250]
      }],
      "name": ["string", 1, 120],
      "macros": ["object", {
        "calories": ["number", 0, 1000000], "protein": ["number", 0, 100000],
        "carbs": ["number", 0, 100000], "fat": ["number", 0, 100000]
      }],
      "workout": ["object", {
        "id": ["id"], "name": ["ref", "name"], "programId": ["id"], "dayId": ["id"],
        "startedAt": ["instant"], "finishedAt": ["nullable", ["instant"]], "restEndsAt": ["optional", ["nullable", ["instant"]]],
        "exercises": ["entities", ["object", {
          "id": ["id"], "name": ["ref", "name"], "sets": ["integer", 1, 100], "reps": ["integer", 1, 1000],
          "restSeconds": ["integer", 0, 3600], "logged": ["entities", ["object", {
            "id": ["id"], "reps": ["integer", 1, 1000], "grams": ["integer", 0, 2000000]
          }], 100]
        }], 70]
      }]
    }
    $rules$::jsonb;
BEGIN
    RETURN levelmaxing_private.workspace_matches_rule_v1(p_value, v_types -> p_section, v_types);
END;
$func$;

CREATE FUNCTION public.levelmaxing_workspace_read_v1(p_section text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $func$
DECLARE
    v_account_id uuid := levelmaxing_private.require_sync_participant();
    v_version bigint;
    v_value jsonb;
BEGIN
    IF p_section IS NULL OR p_section COLLATE "C" NOT IN ('profile', 'training', 'nutrition', 'journal') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_workspace_section';
    END IF;
    PERFORM levelmaxing_private.lock_sync_participant(v_account_id);

    SELECT s.version, s.value INTO v_version, v_value
    FROM levelmaxing_private.workspace_versions AS s
    WHERE s.account_id = v_account_id AND s.section = p_section
    ORDER BY s.version DESC LIMIT 1;

    RETURN jsonb_build_object('version', coalesce(v_version, 0), 'value', v_value);
END;
$func$;

CREATE FUNCTION public.levelmaxing_workspace_save_v1(
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
        IF v_version = p_expect THEN
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

REVOKE ALL ON FUNCTION levelmaxing_private.workspace_matches_rule_v1(jsonb, jsonb, jsonb),
    levelmaxing_private.workspace_value_valid_v1(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.levelmaxing_workspace_read_v1(text),
    public.levelmaxing_workspace_save_v1(text, bigint, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.levelmaxing_workspace_read_v1(text),
    public.levelmaxing_workspace_save_v1(text, bigint, uuid, jsonb) TO authenticated;

COMMIT;
