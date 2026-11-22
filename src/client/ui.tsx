// Small building blocks shared by several screens.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { failureText } from "./api.ts";
import { lastLoaded, loadAndRemember } from "./last-loaded.ts";
import { minutesLeft } from "./format.ts";

/** A full screen with its content centred: sign-in, timezone, invite. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="screen centered gut">
      <main className="stack-lg">{children}</main>
    </div>
  );
}

/**
 * Where a screen's load stands. `failed` is a load that failed with nothing
 * loaded before it; a reload that fails keeps what was loaded, with
 * `reloadFailed` saying why. The error is for `failureText`.
 */
export type Load<T> =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "loaded"; data: T; reloadFailed: { error: unknown } | null };

/** How a load settled: what it loaded, or why it failed. */
type Settled<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** `load` after a load settles: new data replaces the old; a failure keeps any data already shown. */
export function settledLoad<T>(load: Load<T>, settled: Settled<T>): Load<T> {
  if (settled.ok) return { kind: "loaded", data: settled.data, reloadFailed: null };
  return load.kind === "loaded"
    ? { ...load, reloadFailed: { error: settled.error } }
    : { kind: "failed", error: settled.error };
}

/** The data on screen, if any: loaded, or kept after a failed reload. */
export function loadedData<T>(load: Load<T>): T | null {
  return load.kind === "loaded" ? load.data : null;
}

/** Why the last load failed, whether or not earlier data is still shown; null when it didn't. */
export function loadFailure<T>(load: Load<T>): { error: unknown } | null {
  if (load.kind === "failed") return { error: load.error };
  return load.kind === "loaded" ? load.reloadFailed : null;
}

/**
 * Loads on mount, and again on `reload()`, keeping the last data meanwhile
 * and if the reload fails. Only the newest load's answer counts: an older one
 * arriving after it is dropped. `reload()`'s promise settles once a load it
 * started, or a newer one, has answered, whether it loaded or failed, or once
 * the screen goes away, which drops the load.
 *
 * With a `key` (the API path it loads), what it loads is remembered
 * (last-loaded.ts), and the screen opened again starts with that while it
 * loads afresh. Pass one only for a screen that shows what it loads. No key
 * for a form or picker that copies the loaded data into what the user edits
 * (the reload would never reach it), nor for a screen that sends what it
 * loaded back in a command: remembered data could undo a change made since.
 */
export function useLoad<T>(load: () => Promise<T>, key?: string): { state: Load<T>; reload: () => Promise<void> } {
  const [state, setState] = useState<Load<T>>(() => {
    const last = key === undefined ? undefined : lastLoaded<T>(key);
    return last === undefined ? { kind: "loading" } : { kind: "loaded", data: last, reloadFailed: null };
  });
  const [loads, setLoads] = useState(0);
  const requested = useRef(0);
  /** Each `reload()` waiting for an answer, with the load it asked for. */
  const waiting = useRef<{ load: number; answered: () => void }[]>([]);
  // A reload runs the cleanup first, which drops the load before it. `load`
  // is left out of the deps on purpose: callers pass a new function each
  // render, and a screen showing something else gets a new `key` instead.
  useEffect(() => {
    const answered = () => {
      const done = waiting.current.filter((reload) => reload.load <= loads);
      waiting.current = waiting.current.filter((reload) => reload.load > loads);
      for (const reload of done) reload.answered();
    };
    return settleUnlessDropped(
      key === undefined ? load() : loadAndRemember(key, load),
      (data) => {
        setState((before) => settledLoad(before, { ok: true, data }));
        answered();
      },
      (error) => {
        setState((before) => settledLoad(before, { ok: false, error }));
        answered();
      },
    );
  }, [loads]);
  // A screen gone away answers no load, so its waiting reloads settle now.
  useEffect(
    () => () => {
      const gone = waiting.current;
      waiting.current = [];
      for (const reload of gone) reload.answered();
    },
    [],
  );
  const reload = useCallback(
    () =>
      new Promise<void>((answered) => {
        requested.current += 1;
        waiting.current.push({ load: requested.current, answered });
        setLoads(requested.current);
      }),
    [],
  );
  return { state, reload };
}

/**
 * Passes `promise`'s value to `onLoaded`, or its error to `onFailed`, unless
 * the returned drop function ran first. It is an effect's cleanup, so only
 * the newest load's answer counts.
 */
export function settleUnlessDropped<T>(
  promise: Promise<T>,
  onLoaded: (value: T) => void,
  onFailed: (error: unknown) => void,
): () => void {
  let dropped = false;
  promise.then(
    (value) => {
      if (!dropped) onLoaded(value);
    },
    (error: unknown) => {
      if (!dropped) onFailed(error);
    },
  );
  return () => {
    dropped = true;
  };
}

/** "`what` couldn't load", and why. */
export function LoadFailed({ what, error }: { what: string; error: unknown }) {
  return <Empty title={`${what} couldn't load`} body={failureText(error, "Check your connection and reopen Pact.")} />;
}

/**
 * A screen's loaded data, through `children`: nothing while it first loads;
 * if that fails, "`what` couldn't load" and why. A failed reload says the same
 * above the data already shown.
 */
export function Loaded<T>({
  state,
  what,
  children,
}: {
  state: Load<T>;
  /** "This pact", for "This pact couldn't load". */
  what: string;
  children: (data: T) => ReactNode;
}) {
  switch (state.kind) {
    case "loading":
      return null;
    case "failed":
      return <LoadFailed what={what} error={state.error} />;
    case "loaded":
      return (
        <>
          {state.reloadFailed && <LoadFailed what={what} error={state.reloadFailed.error} />}
          {children(state.data)}
        </>
      );
  }
}

/** `Loaded` for a lookup that can answer not found (`{ ok: false }`): then `notFound` says so. */
export function LoadedFound<T extends { ok: boolean }>({
  state,
  what,
  notFound,
  children,
}: {
  state: Load<T>;
  what: string;
  notFound: { title: string; body: string };
  children: (found: Extract<T, { ok: true }>) => ReactNode;
}) {
  return (
    <Loaded state={state} what={what}>
      {(result) => (isFound(result) ? children(result) : <Empty title={notFound.title} body={notFound.body} />)}
    </Loaded>
  );
}

function isFound<T extends { ok: boolean }>(result: T): result is Extract<T, { ok: true }> {
  return result.ok;
}

/** What a failed send says, from the error it threw: often `failureText` with the screen's own words. */
type FailureText = (error: unknown) => string;

/**
 * How a send ends. `leavesScreen`: once it goes through, the screen goes
 * away, but not at once (Back waits for the browser), so it stays busy until
 * then rather than offering the button again.
 */
export interface SendOptions {
  leavesScreen?: boolean;
}

/**
 * One send from a button, and what it says: busy while it runs, then
 * `send`'s answer. `send` returns the text of a refusal, to show as the
 * error, or nothing once it went through (having done what follows). If it
 * throws, `failure` says why. The error clears when the next send starts.
 */
export async function sendOnce(
  send: () => Promise<string | void>,
  failure: FailureText,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
  { leavesScreen = false }: SendOptions = {},
): Promise<void> {
  setBusy(true);
  setError(null);
  try {
    const refusal = await send();
    if (typeof refusal === "string") setError(refusal);
    else if (leavesScreen) return;
  } catch (error) {
    setError(failure(error));
  }
  setBusy(false);
}

/**
 * `sendOnce` as a hook: `run(...args)` sends, `busy` and `error` say how it
 * went. `setError` is for the screen's own problems, found before sending
 * (a field left empty, a photo that couldn't be read).
 */
export function useSend<Args extends unknown[]>(
  send: (...args: Args) => Promise<string | void>,
  failure: FailureText,
  options: SendOptions = {},
): { busy: boolean; error: string | null; setError: (error: string | null) => void; run: (...args: Args) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (...args: Args) => void sendOnce(() => send(...args), failure, setBusy, setError, options);
  return { busy, error, setError, run };
}

/** The current time, updated every second, so countdowns stay right and end on time. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** "New · edit for 7 min", next to the name of a pact in its edit window. Nothing once it's closed. */
export function EditWindowChip({ closesAt, now }: { closesAt: string | null; now: number }) {
  const minutes = minutesLeft(closesAt, now);
  return minutes === null ? null : <span className="chip c-new">New · editable for {minutes} min</span>;
}

export function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
      {children}
    </div>
  );
}

/**
 * A sheet that slides up over the screen: its title, maybe a link that closes
 * it (Done, Cancel), then `children`. Tapping outside it or pressing Escape closes it too.
 * It renders on the document's body, wherever it's used.
 */
export function Sheet({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  /** Left out when `children` has its own way to close it. */
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On the body, so a sheet opened from inside a card or list isn't inside it.
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet gut"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grab" />
        <div className="spread">
          <h2>{title}</h2>
          {closeLabel && (
            <button className="link" onClick={onClose}>
              {closeLabel}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
