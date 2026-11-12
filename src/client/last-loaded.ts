// What the read-only screens last loaded, by API path, so a screen opened
// again shows it at once while it reloads (`useLoad`'s `key`). A command the
// user sends forgets all of it (api.ts), so no screen shows what was there
// before the user's own action; the loads registered with
// `reloadWhenForgotten` (the tabs') then run again, so those screens are
// quick again a round trip later. Imports nothing, so api.ts can import it.

const lastLoads = new Map<string, unknown>();
// How many times everything was forgotten: a load that began before the
// latest forgetting mustn't put what it loaded back.
let forgettings = 0;
const reloads = new Map<string, () => Promise<unknown>>();

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

/**
 * Forgets everything loaded so far, including what loads still on their way
 * bring back, then runs the registered loads again; one that fails is just
 * loaded when its screen opens.
 */
export function forgetLoaded(): void {
  lastLoads.clear();
  forgettings++;
  for (const [key, load] of reloads) loadAndRemember(key, load).catch(() => {});
}

/** Runs `load` again under `key` each time everything is forgotten, until the returned function stops it. */
export function reloadWhenForgotten(key: string, load: () => Promise<unknown>): () => void {
  reloads.set(key, load);
  return () => reloads.delete(key);
}

/** Stops every load registered with `reloadWhenForgotten`. */
export function stopReloading(): void {
  reloads.clear();
}
