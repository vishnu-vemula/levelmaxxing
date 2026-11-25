-- Owner-operated draft. This file is outside Supabase's automatic migration directory.
BEGIN;

CREATE SCHEMA levelmaxing_private;
REVOKE ALL ON SCHEMA levelmaxing_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE levelmaxing_private.firebase_configuration (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    project_id text NOT NULL CHECK (project_id ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$')
);

CREATE TABLE levelmaxing_private.users (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    firebase_uuid text COLLATE "C" NOT NULL UNIQUE
        CHECK (pg_catalog.char_length(firebase_uuid) BETWEEN 1 AND 128),
    access_role text NOT NULL DEFAULT 'participant'
        CHECK (access_role IN ('participant', 'operator')),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE levelmaxing_private.firebase_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE levelmaxing_private.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA levelmaxing_private FROM PUBLIC, anon, authenticated, service_role;

-- The Data API authenticates the token before exposing auth.jwt().
-- Recheck issuer and audience here since authenticated callers can invoke the RPC directly.
CREATE FUNCTION levelmaxing_private.current_firebase_uid() RETURNS text
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
    SELECT auth.jwt() ->> 'sub'
    FROM levelmaxing_private.firebase_configuration AS cfg
    WHERE cfg.singleton
      AND auth.jwt() ->> 'iss' = 'https://securetoken.google.com/' || cfg.project_id
      AND auth.jwt() ->> 'aud' = cfg.project_id
      AND auth.jwt() ->> 'role' = 'authenticated'
      AND pg_catalog.jsonb_typeof(auth.jwt() -> 'aud') = 'string'
      AND pg_catalog.jsonb_typeof(auth.jwt() -> 'sub') = 'string'
      AND pg_catalog.char_length(auth.jwt() ->> 'sub') BETWEEN 1 AND 128
      AND pg_catalog.jsonb_typeof(auth.jwt() -> 'firebase') = 'object'
      AND NOT ((auth.jwt() -> 'firebase') ? 'tenant')
      AND pg_catalog.jsonb_typeof(auth.jwt() -> 'firebase' -> 'sign_in_provider') = 'string'
      AND auth.jwt() -> 'firebase' ->> 'sign_in_provider' NOT IN ('', 'anonymous', 'custom')
$function$;

REVOKE ALL ON FUNCTION levelmaxing_private.current_firebase_uid() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.levelmaxing_resolve_firebase_user_v1() RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    caller_uid text := levelmaxing_private.current_firebase_uid();
    actor levelmaxing_private.users%ROWTYPE;
BEGIN
    IF caller_uid IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT u.* INTO actor
    FROM levelmaxing_private.users AS u
    WHERE u.firebase_uuid = caller_uid COLLATE "C";

    IF NOT FOUND THEN
        INSERT INTO levelmaxing_private.users (firebase_uuid)
        VALUES (caller_uid)
        ON CONFLICT (firebase_uuid) DO NOTHING;

        SELECT u.* INTO actor
        FROM levelmaxing_private.users AS u
        WHERE u.firebase_uuid = caller_uid COLLATE "C";
    END IF;

    IF NOT FOUND OR actor.status <> 'active' THEN
        RETURN NULL;
    END IF;

    RETURN pg_catalog.jsonb_build_object('accountId', actor.id, 'role', actor.access_role);
END;
$function$;

REVOKE ALL ON FUNCTION public.levelmaxing_resolve_firebase_user_v1() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.levelmaxing_resolve_firebase_user_v1() TO authenticated;

COMMIT;
