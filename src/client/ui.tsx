// Small building blocks shared by several screens.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
 * What `load` resolves to (null until it does), or `failed` if it rejects.
 * Loads on mount, and again on `reload()`, keeping the last data meanwhile.
 * `failed` is the error when the load failed, for `failureText`; null otherwise.
 */
export function useLoad<T>(load: () => Promise<T>): {
  data: T | null;
  failed: { error: unknown } | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    load().then(
      (loaded) => {
        setData(loaded);
        setFailed(null);
      },
      (error: unknown) => setFailed({ error }),
    );
  }, [loads]);
  return { data, failed, reload: () => setLoads((n) => n + 1) };
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
  return minutes === null ? null : <span className="chip c-new">New · edit for {minutes} min</span>;
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
