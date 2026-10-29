import { useCallback, useEffect, useMemo, useState } from "react";
import { inviteTokenFromPath, type MeResponse } from "../shared/api.ts";
import { ApiError, api, signInWithGoogle, signOut } from "./api.ts";
import { CreatePact } from "./CreatePact.tsx";
import { initial } from "./format.ts";
import { FriendsSection } from "./Friends.tsx";
import { BackIcon, GoogleIcon, LedgersIcon, PactsIcon, ReviewIcon, TodayIcon } from "./icons.tsx";
import { InvitePage } from "./InvitePage.tsx";
import { useNavigation, type TabId } from "./navigation.ts";
import { PactPage } from "./PactPage.tsx";
import { Pacts } from "./Pacts.tsx";
import { Today } from "./Today.tsx";
import { Centered, Empty } from "./ui.tsx";

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
  const [inviteToken, setInviteToken] = useState(() => inviteTokenFromPath(window.location.pathname));

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

  useEffect(() => {
    const onPop = () => setInviteToken(inviteTokenFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (session.kind === "loading") return <div className="screen" aria-busy="true" />;

  // An invite link shows before the sign-in gate and the timezone screen:
  // accept first, then the app asks for a timezone if it still needs one.
  if (inviteToken !== null && session.kind !== "failed") {
    const leave = () => {
      window.history.replaceState(null, "", "/");
      setInviteToken(null);
      void load();
    };
    return <InvitePage token={inviteToken} profile={session.kind === "signed-in" ? session.profile : null} onDone={leave} />;
  }

  switch (session.kind) {
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

const TABS: { id: TabId; label: string; Icon: typeof TodayIcon }[] = [
  { id: "today", label: "Today", Icon: TodayIcon },
  { id: "pacts", label: "Pacts", Icon: PactsIcon },
  { id: "review", label: "Review", Icon: ReviewIcon },
  { id: "ledgers", label: "Ledgers", Icon: LedgersIcon },
];

function Shell({
  profile,
  onProfile,
  onSignedOut,
}: {
  profile: ConfirmedProfile;
  onProfile: (p: MeResponse) => void;
  onSignedOut: () => void;
}) {
  const nav = useNavigation();
  const { tab, page } = nav;
  const [profileOpen, setProfileOpen] = useState(false);
  // Pact names learnt by loading their pages, for a page opened from a link.
  const [pactNames, setPactNames] = useState<Record<string, string>>({});
  const pactLoaded = useCallback(
    (id: string, name: string) => setPactNames((names) => (names[id] === name ? names : { ...names, [id]: name })),
    [],
  );

  const openPact = (id: string, name: string) => nav.push({ kind: "pact", id, name });
  const create = () => nav.push({ kind: "create" });

  let title: string;
  let subtitle = "";
  if (page?.kind === "pact") title = pactNames[page.id] ?? page.name ?? "";
  else if (page?.kind === "create") title = "New pact";
  else {
    title = TABS.find((t) => t.id === tab)!.label;
    if (tab === "today") {
      subtitle = new Intl.DateTimeFormat("en-US", { timeZone: profile.timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date());
    }
  }

  return (
    <div className="app">
      <header className="hdr gut">
        {page && (
          <button className="iconbtn" aria-label="Back" onClick={nav.back}>
            <BackIcon />
          </button>
        )}
        <h1>
          {title}
          <span className="sub">{subtitle}</span>
        </h1>
        <button className="avatar" aria-label="Profile" onClick={() => setProfileOpen(true)}>
          {initial(profile.name)}
        </button>
      </header>
      <main className="scroll gut">
        {page?.kind === "pact" && <PactPage key={page.id} pactId={page.id} onLoaded={pactLoaded} />}
        {page?.kind === "create" && (
          <CreatePact
            onCancel={nav.back}
            onCreated={(id, name) => nav.replace({ kind: "pact", id, name })}
            onInvite={() => setProfileOpen(true)}
          />
        )}
        {!page && tab === "today" && <Today onOpenPact={openPact} onCreate={create} onInvite={() => setProfileOpen(true)} />}
        {!page && tab === "pacts" && <Pacts onOpenPact={openPact} onCreate={create} />}
        {!page && tab === "review" && (
          <Empty title="Nothing to review" body="When a friend picks you as a reviewer, their submitted evidence and excuses show up here." />
        )}
        {!page && tab === "ledgers" && <Empty title="No ledgers yet" body="Each recipient you name on a pact gets one ledger." />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ id, label, Icon }) => (
          // The current tab stays marked while a page is pushed on top of it.
          <button
            key={id}
            className="tab"
            aria-current={tab === id ? (page ? "true" : "page") : undefined}
            onClick={() => nav.selectTab(id)}
          >
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

        <FriendsSection />

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
