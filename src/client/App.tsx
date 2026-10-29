import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MeResponse, TodayResponse } from "../shared/api.ts";
import { ApiError, api, signInWithGoogle, signOut } from "./api.ts";
import { GoogleIcon, LedgersIcon, PactsIcon, ReviewIcon, TodayIcon } from "./icons.tsx";

type Session =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "failed" }
  | { kind: "signed-in"; profile: MeResponse };

/** A profile whose timezone the user has confirmed. */
type ConfirmedProfile = MeResponse & { timezone: string };

function isConfirmed(profile: MeResponse): profile is ConfirmedProfile {
  return profile.timezone !== null;
}

export function App() {
  const [session, setSession] = useState<Session>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      setSession({ kind: "signed-in", profile: await api.me() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return setSession({ kind: "signed-out" });
      setSession({ kind: "failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  switch (session.kind) {
    case "loading":
      return <div className="screen" aria-busy="true" />;
    case "signed-out":
      return <SignIn />;
    case "failed":
      return (
        <Centered>
          <h1>Pact couldn't load</h1>
          <p className="muted">Check your connection and try again.</p>
          <button className="btn primary" onClick={() => void load()}>
            Try again
          </button>
        </Centered>
      );
    case "signed-in": {
      const { profile } = session;
      const updated = (next: MeResponse) => setSession({ kind: "signed-in", profile: next });
      const signedOut = () => setSession({ kind: "signed-out" });
      if (!isConfirmed(profile)) return <ConfirmTimezone profile={profile} onConfirmed={updated} />;
      return <Shell profile={profile} onProfile={updated} onSignedOut={signedOut} />;
    }
  }
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="screen centered gut">
      <main className="stack-lg">{children}</main>
    </div>
  );
}

// ---------- Sign in ----------

function SignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <Centered>
      <div className="brand">
        <h1>Pact</h1>
        <p className="muted">Commitments with money on the line, checked by your friends.</p>
      </div>
      <button
        className="btn block google"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          signInWithGoogle().catch(() => setBusy(false));
        }}
      >
        <GoogleIcon />
        Sign in with Google
      </button>
      <p className="muted small">Pact is invite-only for now.</p>
    </Centered>
  );
}

// ---------- Timezone ----------

function detectedTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function allTimezones(including: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(including) ? zones : [including, ...zones].sort();
}

/** Story 2: first sign-in shows the browser's timezone for the user to confirm or change. */
function ConfirmTimezone({
  profile,
  onConfirmed,
}: {
  profile: MeResponse;
  onConfirmed: (p: ConfirmedProfile) => void;
}) {
  const detected = useMemo(detectedTimezone, []);
  const [picking, setPicking] = useState(false);
  const [zone, setZone] = useState(detected);
  const { save, saving, error } = useSaveTimezone(profile, onConfirmed);

  return (
    <Centered>
      <div className="stack">
        <span className="label">Welcome, {firstName(profile.name)}</span>
        <h1>Is this your timezone?</h1>
        <p className="muted">We’ll use it for due times and deadlines.</p>
      </div>
      <div className="card">
        {picking ? (
          <TimezoneSelect value={zone} onChange={setZone} />
        ) : (
          <div className="stack-sm">
            <b className="tz-name">{prettyZone(detected)}</b>
            <span className="muted small">{zoneDetail(detected)}</span>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="stack">
        <button className="btn primary block" disabled={saving} onClick={() => void save(zone)}>
          {picking ? "Use this timezone" : "Confirm"}
        </button>
        {!picking && (
          <button className="btn block" onClick={() => setPicking(true)}>
            Pick another
          </button>
        )}
      </div>
    </Centered>
  );
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(() => allTimezones(value), [value]);
  return (
    <label className="field">
      <span>Timezone</span>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {prettyZone(z)}
          </option>
        ))}
      </select>
    </label>
  );
}

function useSaveTimezone(profile: MeResponse, onSaved: (p: ConfirmedProfile) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (timezone: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.setTimezone(timezone);
      if (result.ok) onSaved({ ...profile, timezone: result.timezone });
      else setError("That timezone isn't recognised. Pick one from the list.");
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, error };
}

// ---------- App shell ----------

const TABS = [
  { id: "today", label: "Today", path: "/", Icon: TodayIcon },
  { id: "pacts", label: "Pacts", path: "/pacts", Icon: PactsIcon },
  { id: "review", label: "Review", path: "/review", Icon: ReviewIcon },
  { id: "ledgers", label: "Ledgers", path: "/ledgers", Icon: LedgersIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];

function tabFromPath(pathname: string): TabId {
  return TABS.find((t) => t.path === pathname)?.id ?? "today";
}

function useTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(() => tabFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: TabId) => {
    const path = TABS.find((t) => t.id === next)!.path;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setTab(next);
  };
  return [tab, go];
}

function Shell({
  profile,
  onProfile,
  onSignedOut,
}: {
  profile: ConfirmedProfile;
  onProfile: (p: MeResponse) => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useTab();
  const [profileOpen, setProfileOpen] = useState(false);
  const current = TABS.find((t) => t.id === tab)!;
  const subtitle: Record<TabId, string> = {
    today: new Intl.DateTimeFormat("en-US", { timeZone: profile.timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date()),
    pacts: "",
    review: "",
    ledgers: "",
  };

  return (
    <div className="app">
      <header className="hdr gut">
        <h1>
          {current.label}
          <span className="sub">{subtitle[tab]}</span>
        </h1>
        <button className="avatar" aria-label="Profile" onClick={() => setProfileOpen(true)}>
          {initial(profile.name)}
        </button>
      </header>
      <main className="scroll gut">
        {tab === "today" && <TodayTab />}
        {tab === "pacts" && <Empty title="No pacts yet" body="Pacts you create show up here." />}
        {tab === "review" && (
          <Empty title="Nothing to review" body="When a friend picks you as a reviewer, their submitted evidence and excuses show up here." />
        )}
        {tab === "ledgers" && <Empty title="No ledgers yet" body="Each recipient you name on a pact gets one ledger." />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className="tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            <span className="tile">
              <Icon />
              {label}
            </span>
          </button>
        ))}
      </nav>
      {profileOpen && (
        <ProfileSheet
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onProfile={onProfile}
          onSignedOut={onSignedOut}
        />
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
    </div>
  );
}

function TodayTab() {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.today().then(setToday, () => setFailed(true));
  }, []);

  if (failed) return <Empty title="Today couldn't load" body="Check your connection and reopen Pact." />;
  if (today === null) return null;
  // Alerts and cards arrive in later tickets; with none, Today says there's nothing open.
  if (today.alerts.length === 0 && today.sections.length === 0) {
    return <Empty title="Nothing to do right now" body="When one of your pacts needs something from you, it shows up here." />;
  }
  return null;
}

// ---------- Profile ----------

function ProfileSheet({
  profile,
  onClose,
  onProfile,
  onSignedOut,
}: {
  profile: ConfirmedProfile;
  onClose: () => void;
  onProfile: (p: MeResponse) => void;
  onSignedOut: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [zone, setZone] = useState(profile.timezone);
  const [signingOut, setSigningOut] = useState(false);
  const { save, saving, error } = useSaveTimezone(profile, (next) => {
    onProfile(next);
    setChanging(false);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet gut" role="dialog" aria-modal="true" aria-label="Profile" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="spread">
          <h2>Profile</h2>
          <button className="link" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="row2">
          <span className="avatar">{initial(profile.name)}</span>
          <span className="stack-sm">
            <b>{profile.name}</b>
            <span className="muted small">{profile.email}</span>
          </span>
        </div>

        <section className="stack">
          <div className="label">Timezone</div>
          {changing ? (
            <div className="card">
              <TimezoneSelect value={zone} onChange={setZone} />
              {error && <p className="error">{error}</p>}
              <div className="row2">
                <button className="btn primary" disabled={saving} onClick={() => void save(zone)}>
                  Save
                </button>
                <button className="btn" onClick={() => setChanging(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="spread">
              <span>{prettyZone(profile.timezone)}</span>
              <button className="link" onClick={() => setChanging(true)}>
                Change
              </button>
            </div>
          )}
        </section>

        <button
          className="btn block danger"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            signOut().then(onSignedOut, () => setSigningOut(false));
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ---------- helpers ----------

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

/** "America/Los_Angeles" → "Los Angeles (America)". */
function prettyZone(zone: string): string {
  const parts = zone.split("/");
  if (parts.length < 2) return zone.replaceAll("_", " ");
  const city = parts.slice(1).join(" / ").replaceAll("_", " ");
  return `${city} (${parts[0]})`;
}

/** e.g. "GMT-07:00 · now 3:42 PM". */
function zoneDetail(zone: string): string {
  const now = new Date();
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now);
  return `${offset} · now ${time}`;
}
