// What the read-only screens last loaded, by API path, so a screen opened
// again shows it at once while it reloads (`useLoad`'s `key`). A command the
// user sends forgets all of it (api.ts), so no screen shows what was there
// before the user's own action. Imports nothing, so api.ts can import it.

const lastLoads = new Map<string, unknown>();
// How many times everything was forgotten: a load that began before the
// latest forgetting mustn't put what it loaded back.
let forgettings = 0;

/** What was last loaded under `key`, if it's still remembered. */
export function lastLoaded<T>(key: string): T | undefined {
  return lastLoads.get(key) as T | undefined;
}

/** Runs `load` and remembers what it loaded under `key`, unless everything was forgotten meanwhile. */
export async function loadAndRemember<T>(key: string, load: () => Promise<T>): Promise<T> {
  const began = forgettings;
  const data = await load();
  if (forgettings === began) lastLoads.set(key, data);
  return data;
}

/** Forgets everything loaded so far, including what loads still on their way bring back. */
export function forgetLoaded(): void {
  lastLoads.clear();
  forgettings++;
}
