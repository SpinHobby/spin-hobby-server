/**
 * The only file that touches `process.env`. Everything else reads settings through the topic files in
 * this folder (square.config.ts, supabase.config.ts, ...), so a newcomer can see every setting the
 * server understands, and what its default is, without searching the codebase.
 *
 * Settings are read each time they are asked for, not once at start-up: tests change them between
 * runs, and a missing optional setting must never stop the server booting.
 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** A comma-separated setting as a list: `a, b,c` -> ['a', 'b', 'c']. */
export function envList(name: string): string[] {
  return (env(name) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const isEnvSet = (name: string) => env(name) !== undefined;

/** A URL setting without a trailing slash. */
export function envUrl(name: string): string | undefined {
  return env(name)?.replace(/\/$/, '');
}

/** A number setting; falls back when unset. (Callers that need a range check do it themselves.) */
export const envNumber = (name: string, fallback: number) => Number(env(name) ?? fallback);
