-- Row-level security on every table, with no policies: nothing is readable or writable except by
-- the table owner (the role Prisma connects as, which bypasses RLS). On Supabase this blocks the
-- PostgREST `anon` / `authenticated` roles from the decision log and API key hashes, even if this
-- schema is ever exposed through the Data API. On plain Postgres it is harmless.
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudyConfigVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Supabase only: revoke the API roles' default grants on OUR objects. This is scoped to the
-- tables and function this app owns, never the whole schema, so it is safe in a shared database.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "Customer", "ApiKey", "StudyConfigVersion", "Decision" FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION decision_append_only() FROM %I', r);
    END IF;
  END LOOP;
END $$;
