// Small building blocks shared by several screens.

import { useEffect, useState, type ReactNode } from "react";

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

export function Empty({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
      {children}
    </div>
  );
}
