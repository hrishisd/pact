import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { API_PATHS, APP_PATHS, OURA_RECONNECT_PATH, type MeResponse } from "../shared/api.ts";
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
import type { ItemOpeners } from "./item-page.tsx";
import { NotificationsAlert, NotificationsPage, NotificationsSection } from "./Notifications.tsx";
import { forgetThisDevice, usePush, type Push } from "./push.ts";
import { loadAndRemember } from "./last-loaded.ts";
import { LedgerPage, Ledgers } from "./Ledgers.tsx";
import { inviteTokenFromPath, opensProfileSheet, useNavigation, type Page, type TabId } from "./navigation.ts";
import { PactPage } from "./PactPage.tsx";
import { PaymentPage } from "./PaymentPage.tsx";
import { PlanVacation } from "./PlanVacation.tsx";
import { Pacts } from "./Pacts.tsx";
import { Review } from "./Review.tsx";
import { Today } from "./Today.tsx";
import { Centered, Sheet, loadedData, useLoad, useSend } from "./ui.tsx";
import { VacationSection } from "./VacationSection.tsx";

type Session =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "failed"; error: unknown }
  | { kind: "signed-in"; profile: MeResponse };

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

  // An invite link shows before the sign-in gate: sign in from it, accept,
  // then the app.
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

function allTimezones(including: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(including) ? zones : [including, ...zones].sort();
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

function useSaveTimezone(profile: MeResponse, onSaved: (p: MeResponse) => void) {
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

const TABS: Record<TabId, { label: string; Icon: typeof TodayIcon }> = {
  today: { label: "Today", Icon: TodayIcon },
  pacts: { label: "Pacts", Icon: PactsIcon },
  review: { label: "Review", Icon: ReviewIcon },
  ledgers: { label: "Ledgers", Icon: LedgersIcon },
};

/** What the shell shows: the header's title (and subtitle), and the screen under it. */
interface View {
  title: string;
  subtitle?: string;
  body: ReactNode;
  /** The body ends in a footer bar, so the screen leaves no padding under it. */
  foot?: boolean;
}

function Shell({
  profile,
  onProfile,
  onSignedOut,
}: {
  profile: MeResponse;
  onProfile: (p: MeResponse) => void;
  onSignedOut: () => void;
}) {
  const nav = useNavigation();
  const { tab, page } = nav;
  // A vacation's decision or question opens /profile: the sheet over Today.
  const [profileOpen, setProfileOpen] = useState(() => opensProfileSheet(window.location.pathname));
  // What the Profile sheet's Vacation section says when it opens, after a vacation is sent.
  const [vacationMessage, setVacationMessage] = useState<string | null>(null);
  const reviewCount = useReviewCount(tab);
  useLoadOtherTabs(tab);
  const push = usePush();
  // Pact and recipient names learnt by loading their pages, for a page opened from a link.
  const [pactNames, pactLoaded] = useLearntNames();
  const [ledgerNames, ledgerLoaded] = useLearntNames();

  // Then the address is Today's, so a reload doesn't open the sheet again.
  useEffect(() => {
    if (opensProfileSheet(window.location.pathname))
      window.history.replaceState(window.history.state, "", APP_PATHS.today);
  }, []);

  const openProfile = () => {
    setVacationMessage(null);
    setProfileOpen(true);
  };
  const planVacation = () => {
    setProfileOpen(false);
    nav.push({ kind: "plan-vacation" });
  };
  const openPact = (id: string, name: string) => nav.push({ kind: "pact", id, name });
  const openLedger = (recipientId: string, name: string) => nav.push({ kind: "ledger", recipientId, name });
  const openExcuse = (id: string) => nav.push({ kind: "excuse", id });
  const openChangeRequest = (id: string) => nav.push({ kind: "change-request", id });
  const openEvidence = (id: string) => nav.push({ kind: "evidence", id });
  const openPayment = (id: string) => nav.push({ kind: "payment", id });
  // Each waiting item's own page; a vacation has none, so it opens the Profile sheet, where its card is.
  const openers: ItemOpeners = {
    evidence: openEvidence,
    excuse: openExcuse,
    payment: openPayment,
    "change-request": openChangeRequest,
    vacation: openProfile,
  };
  const create = () => nav.push({ kind: "create" });
  const openNotifications = () => {
    setProfileOpen(false);
    nav.push({ kind: "notifications" });
  };

  const pageView = (page: Page): View => {
    switch (page.kind) {
      case "pact":
        return {
          title: pactNames[page.id] ?? page.name ?? "",
          body: (
            <PactPage
              key={page.id}
              pactId={page.id}
              timezone={profile.timezone}
              onLoaded={pactLoaded}
              onEdit={() => nav.push({ kind: "edit-pact", id: page.id })}
              onDeleted={nav.back}
              onRequestChange={() => nav.push({ kind: "change-pact", id: page.id })}
              openers={openers}
              onInvite={openProfile}
            />
          ),
        };
      case "create":
        return {
          title: "New pact",
          body: (
            <CreatePact
              connections={{
                ouraConnected: profile.connections.some((connection) => connection.service === "oura"),
                ouraAvailable: profile.ouraAvailable,
                ankiConnected: profile.connections.some((connection) => connection.service === "anki"),
                ankiAvailable: profile.ankiAvailable,
              }}
              onCancel={nav.back}
              onCreated={(id, name) => nav.replace({ kind: "pact", id, name })}
              onInvite={openProfile}
            />
          ),
        };
      case "edit-pact":
        return {
          title: "Edit pact",
          body: <EditPact key={page.id} pactId={page.id} onDone={nav.back} onInvite={openProfile} />,
        };
      case "change-pact":
        return {
          title: "Request change",
          body: <ChangePact key={page.id} pactId={page.id} onDone={nav.back} onInvite={openProfile} />,
        };
      case "change-request":
        return {
          title: "Change request",
          body: (
            <ChangeRequestPage
              key={page.id}
              changeRequestId={page.id}
              timezone={profile.timezone}
              onOpenPact={openPact}
            />
          ),
        };
      case "ledger":
        return {
          title: ledgerNames[page.recipientId] ?? page.name ?? "",
          body: (
            <LedgerPage
              key={page.recipientId}
              recipientId={page.recipientId}
              timezone={profile.timezone}
              onLoaded={ledgerLoaded}
              onOpenPact={openPact}
            />
          ),
        };
      case "excuse":
        return {
          title: "Excuse",
          body: <ExcusePage key={page.id} excuseId={page.id} timezone={profile.timezone} onOpenPact={openPact} />,
        };
      case "evidence":
        return {
          title: "Evidence",
          body: <EvidencePage key={page.id} evidenceId={page.id} timezone={profile.timezone} onOpenPact={openPact} />,
        };
      case "payment":
        return {
          title: "Payment",
          body: <PaymentPage key={page.id} paymentId={page.id} timezone={profile.timezone} onOpenLedger={openLedger} />,
        };
      case "notifications":
        return { title: "Notifications", body: <NotificationsPage push={push} onDone={nav.back} /> };
      case "plan-vacation":
        return {
          title: "Vacation",
          foot: true,
          body: (
            <PlanVacation
              onCancel={nav.back}
              onSent={(message) => {
                nav.replaceWithToday();
                setVacationMessage(message);
                setProfileOpen(true);
              }}
            />
          ),
        };
    }
  };

  const tabView = (tab: TabId): View => {
    const { label } = TABS[tab];
    switch (tab) {
      case "today":
        return {
          title: label,
          subtitle: new Intl.DateTimeFormat("en-US", {
            timeZone: profile.timezone,
            weekday: "short",
            month: "short",
            day: "numeric",
          }).format(new Date()),
          body: (
            <>
              <NotificationsAlert push={push} onSetUp={openNotifications} />
              <Today
                timezone={profile.timezone}
                onOpenPact={openPact}
                onOpenLedger={openLedger}
                openers={openers}
                onCreate={create}
                onInvite={openProfile}
              />
            </>
          ),
        };
      case "pacts":
        return { title: label, body: <Pacts onOpenPact={openPact} onCreate={create} /> };
      case "review":
        return { title: label, body: <Review timezone={profile.timezone} onQueue={reviewCount.set} /> };
      case "ledgers":
        return { title: label, body: <Ledgers timezone={profile.timezone} onOpenLedger={openLedger} /> };
    }
  };

  const { title, subtitle = "", body, foot = false } = page ? pageView(page) : tabView(tab);

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
        <button className="avatar" aria-label="Profile" onClick={openProfile}>
          {initial(profile.name)}
        </button>
      </header>
      <main className={foot ? "scroll gut has-foot" : "scroll gut"}>{body}</main>
      <nav className="tabbar" aria-label="Main">
        {(Object.keys(TABS) as TabId[]).map((id) => {
          const { label, Icon } = TABS[id];
          return (
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
          );
        })}
      </nav>
      {profileOpen && (
        <ProfileSheet
          profile={profile}
          push={push}
          onSetUpNotifications={openNotifications}
          vacationMessage={vacationMessage}
          onPlanVacation={planVacation}
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
 * What each tab loads, so the shell can load the tabs not shown ahead and the
 * first visit to each shows at once. The review queue is the badge's.
 */
const TAB_LOADS: Record<TabId, [string, () => Promise<unknown>][]> = {
  today: [[API_PATHS.today, () => api.today()]],
  pacts: [[API_PATHS.pacts, () => api.pacts()]],
  review: [[API_PATHS.waitingOnReply, () => api.waitingOnReply()]],
  ledgers: [[API_PATHS.ledgers, () => api.ledgers()]],
};

/** Loads the tabs other than `tab` once, when the shell opens; one that fails just loads when visited. */
function useLoadOtherTabs(tab: TabId) {
  useEffect(() => {
    for (const [id, loads] of Object.entries(TAB_LOADS))
      if (id !== tab) for (const [key, load] of loads) loadAndRemember(key, load).catch(() => {});
  }, []);
}

/**
 * The Review tab's badge: how many items wait for this account's decision.
 * Loaded on each change to another tab, sharing the Review tab's load
 * (last-loaded.ts); the Review tab sets it whenever its queue loads.
 */
function useReviewCount(tab: TabId): { value: number; set: (length: number) => void } {
  const [value, set] = useState(0);
  useEffect(() => {
    if (tab === "review") return;
    // A badge that fails to load just keeps its last count.
    loadAndRemember(API_PATHS.reviewQueue, api.reviewQueue).then(
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
  vacationMessage,
  onPlanVacation,
  onClose,
  onProfile,
  onSignedOut,
}: {
  profile: MeResponse;
  push: Push;
  onSetUpNotifications: () => void;
  /** What the Vacation section says on opening, such as "Sent to Sam for approval." */
  vacationMessage: string | null;
  onPlanVacation: () => void;
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
  const lastVacation = loadedData(useLoad(api.lastVacation, API_PATHS.lastVacation).state) ?? null;

  return (
    <Sheet title="Profile" closeLabel="Done" onClose={onClose}>
      <div className="row2">
        <span className="avatar">{initial(profile.name)}</span>
        <span className="stack-sm">
          <b>{profile.name}</b>
          <span className="muted small">{profile.email}</span>
        </span>
      </div>

      <VacationSection message={vacationMessage} lastOne={lastVacation} onPlan={onPlanVacation} />

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
  connections: MeResponse["connections"];
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

/**
 * What each service's row says, how it disconnects, and how it reconnects:
 * Oura through its own sign-in page, AnkiWeb with a form right here.
 */
const SERVICES = {
  oura: {
    name: "Oura Ring",
    short: "Oura",
    unit: "nights",
    icon: <RingIcon />,
    iconClass: "k-ring",
    disconnect: () => api.disconnectOura(),
    reconnect: { kind: "link", href: OURA_RECONNECT_PATH },
  },
  anki: {
    name: "AnkiWeb",
    short: "AnkiWeb",
    unit: "days",
    icon: <CardsIcon />,
    iconClass: "k-anki",
    disconnect: () => api.disconnectAnki(),
    reconnect: { kind: "form" },
  },
} as const;

function ConnectionRow({
  connection,
  timezone,
  onProfile,
}: {
  connection: MeResponse["connections"][number];
  timezone: string;
  onProfile: (p: MeResponse) => void;
}) {
  // Asking: Disconnect's warning is open. Reconnecting: AnkiWeb's sign-in form is.
  const [mode, setMode] = useState<"idle" | "asking" | "reconnecting">("idle");
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
      setMode("idle");
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
      {mode === "asking" ? (
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
            <button className="btn sm" disabled={busy} onClick={() => setMode("idle")}>
              Keep connected
            </button>
            <button className="btn sm danger" disabled={busy} onClick={() => disconnect()}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      ) : mode === "reconnecting" ? (
        <AnkiReconnectForm onReconnected={() => void reconnected()} onCancel={() => setMode("idle")} />
      ) : (
        <div className="row2">
          {connection.status === "needs-reconnecting" &&
            (service.reconnect.kind === "link" ? (
              <a className="btn sm primary" href={service.reconnect.href}>
                Reconnect
              </a>
            ) : (
              <button className="btn sm primary" onClick={() => setMode("reconnecting")}>
                Reconnect
              </button>
            ))}
          <button className="btn sm" onClick={() => setMode("asking")}>
            Disconnect
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

// ---------- helpers ----------

/** "America/Los_Angeles" → "Los Angeles (America)". */
function prettyZone(zone: string): string {
  const parts = zone.split("/");
  if (parts.length < 2) return zone.replaceAll("_", " ");
  const city = parts.slice(1).join(" / ").replaceAll("_", " ");
  return `${city} (${parts[0]})`;
}
