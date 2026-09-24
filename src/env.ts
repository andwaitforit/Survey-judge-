/**
 * Read an environment variable, treating empty or whitespace-only values as unset. Hosting
 * dashboards (e.g. Vercel) make it easy to save a variable with an empty value, and `??` would let
 * that empty string through.
 */
export function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}
