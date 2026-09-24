-- Pin the trigger function's search_path (Supabase advisor 0011). The body only uses pg_catalog
-- built-ins, which stay resolvable with an empty search_path.
ALTER FUNCTION decision_append_only() SET search_path = '';
