// Apple Health: its setup page (the upload key and URL, the Pact Health
// Shortcut's steps, the automations, Run Pact Health and the last upload),
// which the create form shows as its Set up Apple Health step too, and the
// alert when an Apple Health pact's account has no upload key (Today and the
// pact's page).

import { useEffect, useState } from "react";
import { API_PATHS, APP_PATHS, RUN_PACT_HEALTH_URL, type Json } from "../shared/api.ts";
import { RECONNECT_TEXT, type AppleHealthLastUpload } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { clockTime, dateIn, dateUnlessToday } from "./format.ts";
import { HeartIcon } from "./icons.tsx";
import { plural } from "./vacation-text.ts";
import { Loaded, useLoad, useNow, useSend } from "./ui.tsx";

/**
 * Apple Health is disconnected while a bedtime pact needs it: set up opens
 * the Apple Health page, which makes a new upload key. It never needs
 * reconnecting: Pact doesn't call Apple Health, its Shortcut posts to Pact.
 */
export function AppleHealthConnectionAlert() {
  return (
    <div className="alert bad" role="status">
      <span>
        <b>Apple Health is disconnected.</b> {RECONNECT_TEXT.apple_health}
      </span>
      <div className="row2">
        <a className="btn sm primary" href={APP_PATHS.appleHealth}>
          Set up Apple Health
        </a>
      </div>
    </div>
  );
}

/**
 * "Last upload 9:02am · 14 sleep samples, 2 mindful sessions", with its date
 * when it wasn't today in `timeZone` (the profile's), or "No upload yet".
 */
export function lastUploadText(last: Json<AppleHealthLastUpload> | null, now: number, timeZone: string): string {
  if (last === null) return "No upload yet";
  const day = dateUnlessToday(dateIn(Date.parse(last.at), timeZone), now, timeZone);
  const at = `${day === null ? "" : `${day}, `}${clockTime(last.at, timeZone)}`;
  const counts = `${plural(last.sleepSamples, "sleep sample", "sleep samples")}, ${plural(last.mindfulSessions, "mindful session", "mindful sessions")}`;
  return `Last upload ${at} · ${counts}`;
}

/**
 * Calls `reload` each time Pact comes back to the front while `active`: the
 * owner may have just run Pact Health in Shortcuts, so a new upload shows.
 */
export function useReloadOnReturn(active: boolean, reload: () => unknown): void {
  useEffect(() => {
    if (!active) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [active, reload]);
}

/** The Apple Health page, from Profile and Today's alert. Disconnect is on Profile. */
export function AppleHealthPage({
  timezone,
  onKeyMade,
}: {
  /** The profile's timezone, for the last upload. */
  timezone: string;
  /** After a new upload key: the profile's connections changed. */
  onKeyMade: () => void;
}) {
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  return (
    <>
      <p className="muted">{SETUP_INTRO}</p>
      <AppleHealthSetup
        timezone={timezone}
        uploadUrl={uploadUrl}
        onUploadUrl={(url) => {
          setUploadUrl(url);
          onKeyMade();
        }}
      />
    </>
  );
}

/** What the setup page and the create form's step say first. */
export const SETUP_INTRO =
  "Pact reads your sleep from Apple Health with a Shortcut on your iPhone called Pact Health. Set it up once on your iPhone; automations then run it for you.";

/**
 * The setup itself: the upload URL, the Shortcut's steps, the automations,
 * and the last upload with Run Pact Health. `uploadUrl` is a key made since
 * the screen opened, held by its screen so going back a step keeps it: Pact
 * can't show it again. The last upload loads again whenever Pact comes back
 * to the front.
 */
export function AppleHealthSetup({
  timezone,
  uploadUrl,
  onUploadUrl,
}: {
  timezone: string;
  uploadUrl: string | null;
  onUploadUrl: (url: string) => void;
}) {
  const { state, reload } = useLoad(api.appleHealth, API_PATHS.appleHealth);
  const now = useNow();
  useReloadOnReturn(true, reload);
  return (
    <Loaded state={state} what="Apple Health">
      {(status) => (
        <>
          <section className="stack">
            <div className="label">Upload URL</div>
            <UploadKey
              connected={status.connected}
              uploadUrl={uploadUrl}
              onUploadUrl={(url) => {
                onUploadUrl(url);
                void reload();
              }}
            />
          </section>
          <section className="stack">
            <div className="label">Build the Shortcut</div>
            <ShortcutSteps />
          </section>
          <section className="stack">
            <div className="label">Run it automatically</div>
            <Automations />
          </section>
          <section className="stack">
            <div className="label">Check it works</div>
            <div className="card">
              <div className="row2 last-upload">
                <span className="kico k-ring" aria-hidden="true">
                  <HeartIcon />
                </span>
                <b role="status">{lastUploadText(status.lastUpload, now, timezone)}</b>
              </div>
              <a className="btn primary" href={RUN_PACT_HEALTH_URL}>
                Run Pact Health
              </a>
              <small className="muted">Run it on your iPhone, then come back here to see the upload.</small>
            </div>
          </section>
        </>
      )}
    </Loaded>
  );
}

/**
 * Make upload key with no connection; the new upload URL with Copy, once;
 * otherwise Make a new key, after a warning that the old one stops working.
 */
function UploadKey({
  connected,
  uploadUrl,
  onUploadUrl,
}: {
  connected: boolean;
  uploadUrl: string | null;
  onUploadUrl: (url: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const {
    busy,
    error,
    run: make,
  } = useSend(
    async () => {
      const key = await api.makeAppleHealthKey();
      setAsking(false);
      setCopied(false);
      onUploadUrl(key.uploadUrl);
    },
    (failure) => `Couldn't make a key. ${failureText(failure, "Check your connection and try again.")}`,
  );
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard access: the URL is on screen to copy by hand.
    }
  };

  let body;
  if (uploadUrl !== null) {
    body = (
      <div className="alert info">
        <p>
          <b>Copy it now: Pact shows it only once.</b> It goes in step 7 of the Shortcut. Keep it to yourself: anyone
          with it can send sleep to your account.
        </p>
        <code className="invite-link">{uploadUrl}</code>
        <div className="row2">
          <button className="btn sm primary" onClick={() => void copy(uploadUrl)}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  } else if (connected) {
    body = (
      <div className="card">
        <p>Your Pact Health Shortcut has your upload URL. Pact can't show it again.</p>
        {asking ? (
          <div className="alert amber" role="status">
            <span>
              <b>Your old upload URL stops working at once.</b> Paste the new one into Pact Health, or it can't send
              your sleep.
            </span>
            <div className="row2">
              <button className="btn sm" disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button className="btn sm primary" disabled={busy} onClick={() => make()}>
                {busy ? "Making…" : "Make a new key"}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn sm self-start" onClick={() => setAsking(true)}>
            Make a new key
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="card">
        <p>
          Pact Health sends your sleep to your own upload URL, which has a key in it. Make it on your iPhone, so you can
          paste it into the Shortcut.
        </p>
        <button className="btn primary" disabled={busy} onClick={() => make()}>
          {busy ? "Making…" : "Make upload key"}
        </button>
      </div>
    );
  }
  return (
    <>
      {body}
      {error && <p className="error small">{error}</p>}
    </>
  );
}

/** The Pact Health Shortcut's steps, as the spec has them (`.scratch/apple-health-evidence/spec.md`, Shortcut). */
function ShortcutSteps() {
  return (
    <>
      <p className="small">In the Shortcuts app on your iPhone:</p>
      <ol className="gsteps shortcut">
        <li>
          <span>
            New Shortcut, named exactly <b>Pact Health</b>.
          </span>
        </li>
        <li>
          <span>
            <b>Find Health Samples</b> where Type is Sleep Analysis and Start Date is in the last 3 days. Sort by Start
            Date, oldest first.
          </span>
        </li>
        <li>
          <span>
            <b>Repeat with Each</b> item in Health Samples. Inside it:
            <ul>
              <li>
                a <b>Text</b> action: <code>sleep|</code>, Repeat Item's Start Date, <code>|</code>, Repeat Item's End
                Date, <code>|</code>, Repeat Item's Value, <code>|</code>, Repeat Item's Source. Set both dates' format
                to ISO 8601 with "Include ISO 8601 Time" on.
              </li>
              <li>
                <b>Add to Variable</b>: the Text, to a variable named <code>Lines</code>.
              </li>
            </ul>
          </span>
        </li>
        <li>
          <span>
            <b>Find Health Samples</b> where Type is Mindful Minutes and Start Date is in the last 3 days.
          </span>
        </li>
        <li>
          <span>
            <b>Repeat with Each</b> item in those Health Samples, with the same two actions inside, but the Text starts{" "}
            <code>mindful|</code>.
          </span>
        </li>
        <li>
          <span>
            After the last End Repeat, <b>Combine Text</b>: <code>Lines</code>, with New Lines.
          </span>
        </li>
        <li>
          <span>
            <b>Get Contents of URL</b>: the upload URL, Method POST, Request Body File, the Combined Text.
          </span>
        </li>
        <li>
          <span>
            Optional: <b>Show Notification</b> with Contents of URL, to see Pact's answer.
          </span>
        </li>
      </ol>
      <small className="muted">If you have no mindful minutes, step 5 does nothing, and the upload still goes.</small>
    </>
  );
}

/** The personal automations that run Pact Health, and why they're these. */
function Automations() {
  return (
    <div className="card">
      <p>
        In Shortcuts, go to <b>Automation</b> and tap <b>New</b>. Add each of these to run Pact Health, set to{" "}
        <b>Run Immediately</b>:
      </p>
      <ul className="automations">
        <li>When your iPhone is disconnected from power.</li>
        <li>When the Oura or Google Health app is closed.</li>
      </ul>
      <small className="muted">
        Health can't be read while your iPhone is locked, so these run it while you're using your phone. Each run sends
        the last 3 days, so a run that's missed is made up by the next.
      </small>
    </div>
  );
}
