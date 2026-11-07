import { useCallback, useEffect, useMemo, useState } from "react";
import { inviteTokenFromPath, OURA_RECONNECT_PATH, type MeResponse } from "../shared/api.ts";
import { ApiError, api, failureText, signInWithGoogle, signOut } from "./api.ts";
import { AnkiReconnectForm } from "./anki.tsx";
import { ChangePact } from "./ChangePact.tsx";
import { ChangeRequestPage } from "./ChangeRequestPage.tsx";
import { CreatePact, EditPact } from "./CreatePact.tsx";
import { EvidencePage } from "./EvidencePage.tsx";
import { ExcusePage } from "./ExcusePage.tsx";
import { formatDay, initial } from "./format.ts";
import { FriendsSection } from "./Friends.tsx";
import { BackIcon, CardsIcon, GoogleIcon, LedgersIcon, PactsIcon, ReviewIcon, RingIcon, TodayIcon } from "./icons.tsx";
import { InvitePage } from "./InvitePage.tsx";
import { NotificationsAlert, NotificationsPage, NotificationsSection } from "./Notifications.tsx";
import { forgetThisDevice, usePush, type Push } from "./push.ts";
import { LedgerPage, Ledgers } from "./Ledgers.tsx";
import { useNavigation, type TabId } from "./navigation.ts";
import { PactPage } from "./PactPage.tsx";
import { PaymentPage } from "./PaymentPage.tsx";
import { Pacts } from "./Pacts.tsx";
import { Review } from "./Review.tsx";
import { Today } from "./Today.tsx";
import { Centered, Sheet, useSend } from "./ui.tsx";

type Session =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "failed"; error: unknown }
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
      setSession({ kind: "failed", error });
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
    return (
      <InvitePage token={inviteToken} profile={session.kind === "signed-in" ? session.profile : null} onDone={leave} />
    );
  }

  switch (session.kind) {
    case "signed-out":
      return <SignIn />;
    case "failed":
      return (
        <Centered>
          <h1>Pact couldn't load</h1>
          <p className="muted">{failureText(session.error, "Check your connection and try again.")}</p>
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
        <button className="btn primary block" disabled={saving} onClick={() => save(zone)}>
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
  const { busy, error, run } = useSend(
    async (timezone: string) => {
      const result = await api.setTimezone(timezone);
      if (!result.ok) return "That timezone isn't recognised. Pick one from the list.";
      onSaved({ ...profile, timezone: result.timezone });
    },
    (error) => `Couldn't save. ${failureText(error, "Check your connection and try again.")}`,
  );
  return { save: run, saving: busy, error };
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
  const reviewCount = useReviewCount(tab);
  const push = usePush();
  // Pact and recipient names learnt by loading their pages, for a page opened from a link.
  const [pactNames, pactLoaded] = useLearntNames();
  const [ledgerNames, ledgerLoaded] = useLearntNames();

  const openPact = (id: string, name: string) => nav.push({ kind: "pact", id, name });
  const openLedger = (recipientId: string, name: string) => nav.push({ kind: "ledger", recipientId, name });
  const openExcuse = (id: string) => nav.push({ kind: "excuse", id });
  const openChangeRequest = (id: string) => nav.push({ kind: "change-request", id });
  const openEvidence = (id: string) => nav.push({ kind: "evidence", id });
  const openPayment = (id: string) => nav.push({ kind: "payment", id });
  const create = () => nav.push({ kind: "create" });
  const openNotifications = () => {
    setProfileOpen(false);
    nav.push({ kind: "notifications" });
  };

  let title: string;
  let subtitle = "";
  if (page?.kind === "pact") title = pactNames[page.id] ?? page.name ?? "";
  else if (page?.kind === "create") title = "New pact";
  else if (page?.kind === "edit-pact") title = "Edit pact";
  else if (page?.kind === "change-pact") title = "Request change";
  else if (page?.kind === "change-request") title = "Change request";
  else if (page?.kind === "ledger") title = ledgerNames[page.recipientId] ?? page.name ?? "";
  else if (page?.kind === "excuse") title = "Excuse";
  else if (page?.kind === "evidence") title = "Evidence";
  else if (page?.kind === "payment") title = "Payment";
  else if (page?.kind === "notifications") title = "Notifications";
  else {
    title = TABS.find((t) => t.id === tab)!.label;
    if (tab === "today") {
      subtitle = new Intl.DateTimeFormat("en-US", {
        timeZone: profile.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(new Date());
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
        {page?.kind === "pact" && (
          <PactPage
            key={page.id}
            pactId={page.id}
            timezone={profile.timezone}
            onLoaded={pactLoaded}
            onEdit={() => nav.push({ kind: "edit-pact", id: page.id })}
            onDeleted={nav.back}
            onRequestChange={() => nav.push({ kind: "change-pact", id: page.id })}
            onOpenExcuse={openExcuse}
            onOpenChangeRequest={openChangeRequest}
            onInvite={() => setProfileOpen(true)}
          />
        )}
        {page?.kind === "change-pact" && (
          <ChangePact key={page.id} pactId={page.id} onDone={nav.back} onInvite={() => setProfileOpen(true)} />
        )}
        {page?.kind === "change-request" && (
          <ChangeRequestPage
            key={page.id}
            changeRequestId={page.id}
            timezone={profile.timezone}
            onOpenPact={openPact}
          />
        )}
        {page?.kind === "edit-pact" && (
          <EditPact key={page.id} pactId={page.id} onDone={nav.back} onInvite={() => setProfileOpen(true)} />
        )}
        {page?.kind === "create" && (
          <CreatePact
            ouraConnected={profile.connections.some((connection) => connection.service === "oura")}
            ouraAvailable={profile.ouraAvailable}
            ankiConnected={profile.connections.some((connection) => connection.service === "anki")}
            ankiAvailable={profile.ankiAvailable}
            onCancel={nav.back}
            onCreated={(id, name) => nav.replace({ kind: "pact", id, name })}
            onInvite={() => setProfileOpen(true)}
          />
        )}
        {page?.kind === "notifications" && <NotificationsPage push={push} onDone={nav.back} />}
        {!page && tab === "today" && <NotificationsAlert push={push} onSetUp={openNotifications} />}
        {!page && tab === "today" && (
          <Today
            timezone={profile.timezone}
            onOpenPact={openPact}
            onOpenLedger={openLedger}
            onOpenExcuse={openExcuse}
            onOpenChangeRequest={openChangeRequest}
            onOpenEvidence={openEvidence}
            onOpenPayment={openPayment}
            onCreate={create}
            onInvite={() => setProfileOpen(true)}
          />
        )}
        {!page && tab === "pacts" && <Pacts onOpenPact={openPact} onCreate={create} />}
        {!page && tab === "review" && <Review timezone={profile.timezone} onQueue={reviewCount.set} />}
        {page?.kind === "ledger" && (
          <LedgerPage
            key={page.recipientId}
            recipientId={page.recipientId}
            timezone={profile.timezone}
            onLoaded={ledgerLoaded}
            onOpenPact={openPact}
          />
        )}
        {page?.kind === "excuse" && (
          <ExcusePage key={page.id} excuseId={page.id} timezone={profile.timezone} onOpenPact={openPact} />
        )}
        {page?.kind === "evidence" && (
          <EvidencePage key={page.id} evidenceId={page.id} timezone={profile.timezone} onOpenPact={openPact} />
        )}
        {page?.kind === "payment" && (
          <PaymentPage key={page.id} paymentId={page.id} timezone={profile.timezone} onOpenLedger={openLedger} />
        )}
        {!page && tab === "ledgers" && <Ledgers timezone={profile.timezone} onOpenLedger={openLedger} />}
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
              {id === "review" && reviewCount.value > 0 && (
                <span className="badge" aria-label={`${reviewCount.value} to review`}>
                  {reviewCount.value}
                </span>
              )}
            </span>
          </button>
        ))}
      </nav>
      {profileOpen && (
        <ProfileSheet
          profile={profile}
          push={push}
          onSetUpNotifications={openNotifications}
          onClose={() => setProfileOpen(false)}
          onProfile={onProfile}
          onSignedOut={onSignedOut}
        />
      )}
    </div>
  );
}

/** Names by id, learnt as pages load; `learn` is stable, for a page's load effect. */
function useLearntNames(): [Record<string, string>, (id: string, name: string) => void] {
  const [names, setNames] = useState<Record<string, string>>({});
  const learn = useCallback(
    (id: string, name: string) => setNames((known) => (known[id] === name ? known : { ...known, [id]: name })),
    [],
  );
  return [names, learn];
}

/**
 * The Review tab's badge: how many items wait for this account's decision.
 * Loaded on each tab change; the Review tab sets it whenever its queue loads.
 */
function useReviewCount(tab: TabId): { value: number; set: (length: number) => void } {
  const [value, set] = useState(0);
  useEffect(() => {
    // A badge that fails to load just keeps its last count.
    api.reviewQueue().then(
      (queue) => set(queue.length),
      () => {},
    );
  }, [tab]);
  return { value, set };
}

// ---------- Profile ----------

function ProfileSheet({
  profile,
  push,
  onSetUpNotifications,
  onClose,
  onProfile,
  onSignedOut,
}: {
  profile: ConfirmedProfile;
  push: Push;
  onSetUpNotifications: () => void;
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

  return (
    <Sheet title="Profile" closeLabel="Done" onClose={onClose}>
      <div className="row2">
        <span className="avatar">{initial(profile.name)}</span>
        <span className="stack-sm">
          <b>{profile.name}</b>
          <span className="muted small">{profile.email}</span>
        </span>
      </div>

      <FriendsSection />

      <NotificationsSection push={push} onSetUp={onSetUpNotifications} />

      {profile.connections.length > 0 && (
        <ConnectionsSection connections={profile.connections} timezone={profile.timezone} onProfile={onProfile} />
      )}

      <section className="stack">
        <div className="label">Timezone</div>
        {changing ? (
          <div className="card">
            <TimezoneSelect value={zone} onChange={setZone} />
            {error && <p className="error">{error}</p>}
            <div className="row2">
              <button className="btn primary" disabled={saving} onClick={() => save(zone)}>
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
          // First, while there's still a session: a signed-out phone shouldn't get this account's pushes.
          forgetThisDevice()
            .then(signOut)
            .then(onSignedOut, () => setSigningOut(false));
        }}
      >
        Sign out
      </button>
    </Sheet>
  );
}

/**
 * The connections the owner has made (Oura, AnkiWeb), each with its status.
 * Reconnect when Oura refused its tokens or AnkiWeb its login (AnkiWeb's
 * signs in again on the spot); Disconnect first warns how many
 * Active pacts use it, since their days count as Missed until it's back.
 */
function ConnectionsSection({
  connections,
  timezone,
  onProfile,
}: {
  connections: ConfirmedProfile["connections"];
  timezone: string;
  onProfile: (p: MeResponse) => void;
}) {
  return (
    <section className="stack">
      <div className="label">Connections</div>
      {connections.map((connection) => (
        <ConnectionRow key={connection.service} connection={connection} timezone={timezone} onProfile={onProfile} />
      ))}
    </section>
  );
}

/** What each service's row says, and how it disconnects. */
const SERVICES = {
  oura: {
    name: "Oura Ring",
    short: "Oura",
    unit: "nights",
    icon: <RingIcon />,
    iconClass: "k-ring",
    disconnect: () => api.disconnectOura(),
  },
  anki: {
    name: "AnkiWeb",
    short: "AnkiWeb",
    unit: "days",
    icon: <CardsIcon />,
    iconClass: "k-anki",
    disconnect: () => api.disconnectAnki(),
  },
} as const;

function ConnectionRow({
  connection,
  timezone,
  onProfile,
}: {
  connection: ConfirmedProfile["connections"][number];
  timezone: string;
  onProfile: (p: MeResponse) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const service = SERVICES[connection.service];
  const {
    busy,
    error,
    setError,
    run: disconnect,
  } = useSend(
    async () => onProfile(await service.disconnect()),
    (failure) => `Couldn't disconnect. ${failureText(failure, "Check your connection and try again.")}`,
  );
  const reconnected = async () => {
    setError(null);
    try {
      onProfile(await api.me());
      setReconnecting(false);
    } catch (failure) {
      setError(`Reconnected, but couldn't reload. ${failureText(failure, "Reopen Pact.")}`);
    }
  };
  const n = connection.activePacts;
  return (
    <div className="stack">
      <div className="list">
        <div className="rowbtn">
          <span className={`kico ${service.iconClass}`} aria-hidden="true">
            {service.icon}
          </span>
          <span className="rt">
            <b>{service.name}</b>
            <small>Connected {formatDay(connection.connectedAt, timezone)}</small>
          </span>
          {connection.status === "connected" ? (
            <span className="chip c-ok">Connected</span>
          ) : (
            <span className="chip c-missed">Needs reconnecting</span>
          )}
        </div>
      </div>
      {asking ? (
        <div className="alert amber" role="status">
          <span>
            {n > 0 ? (
              <>
                <b>
                  {n} active {n === 1 ? "pact uses" : "pacts use"} {service.short}.
                </b>{" "}
                {n === 1 ? "Its" : "Their"} {service.unit} will count as Missed until you reconnect.
              </>
            ) : (
              `Disconnect ${service.short}? You can connect it again when you next create a pact that uses it.`
            )}
          </span>
          <div className="row2">
            <button className="btn sm" disabled={busy} onClick={() => setAsking(false)}>
              Keep connected
            </button>
            <button className="btn sm danger" disabled={busy} onClick={() => disconnect()}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      ) : reconnecting ? (
        <AnkiReconnectForm onReconnected={() => void reconnected()} onCancel={() => setReconnecting(false)} />
      ) : (
        <div className="row2">
          {connection.status === "needs-reconnecting" && connection.service === "oura" && (
            <a className="btn sm primary" href={OURA_RECONNECT_PATH}>
              Reconnect
            </a>
          )}
          {connection.status === "needs-reconnecting" && connection.service === "anki" && (
            <button className="btn sm primary" onClick={() => setReconnecting(true)}>
              Reconnect
            </button>
          )}
          <button className="btn sm" onClick={() => setAsking(true)}>
            Disconnect
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
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
