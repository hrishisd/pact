// Turning notifications on (story 3) and choosing which ones you get (story 88):
// an alert above Today, the page it opens, and the profile's Notifications
// section, with the daily summary email in an Email section below it.

import { useState } from "react";
import type { DailySummarySetting, NotificationSetting, NotificationSettingState } from "../shared/types.ts";
import { api, failureText } from "./api.ts";
import { AddIcon, ShareIcon } from "./icons.tsx";
import { deviceName, isIos, type Push } from "./push.ts";
import { loadFailure, loadedData, useLoad, useSend } from "./ui.tsx";

const ALERT_CLEARED_KEY = "pact.notifications-alert-cleared";

const SETTING_COPY: Record<NotificationSetting, { label: string; hint: string }> = {
  "picked-as-reviewer": { label: "Picked as a reviewer", hint: "A friend picked you as a reviewer on a pact" },
  "review-item": {
    label: "New review item",
    hint: "Evidence, an excuse, a payment, a change request or a vacation is waiting for you",
  },
  decision: { label: "Decision", hint: "A reviewer approved or rejected something of yours" },
  comment: { label: "Comment", hint: "A reviewer asked you about something, or a friend replied to your question" },
  "missed-occurrence": { label: "Missed occurrence", hint: "One of your pacts was judged Missed" },
  "new-bill": { label: "New bill", hint: "Your Wednesday bill to a recipient is ready" },
  "overdue-bill": { label: "Overdue bill", hint: "A bill of yours is overdue, or one of a friend's you review" },
  "connection-problem": {
    label: "Connection problem",
    hint: "Oura or AnkiWeb needs reconnecting, or last night still has no Oura data at 3pm",
  },
  "reviewed-pact": {
    label: "Pacts you review",
    hint: "A friend added a reviewer or changed timezone on a pact you review",
  },
};

function alertWasCleared(): boolean {
  try {
    return localStorage.getItem(ALERT_CLEARED_KEY) !== null;
  } catch {
    return false;
  }
}

function clearAlert(): void {
  try {
    localStorage.setItem(ALERT_CLEARED_KEY, "1");
  } catch {
    // No storage here: it stays cleared until the app reloads.
  }
}

/** Above Today until push is on for this device, or the user taps Not now. */
export function NotificationsAlert({ push: { state }, onSetUp }: { push: Push; onSetUp: () => void }) {
  const [cleared, setCleared] = useState(alertWasCleared);
  if (cleared || (state !== "needs-install" && state !== "can-turn-on" && state !== "blocked")) return null;
  const text =
    state === "blocked"
      ? `Notifications are blocked on this ${deviceName()}.`
      : "Turn on notifications to hear when a friend's evidence is waiting for you.";
  return (
    <div className="alert info">
      <p>{text}</p>
      <div className="row2">
        <button className="btn sm" onClick={onSetUp}>
          {state === "blocked" ? "Fix this" : "Set up"}
        </button>
        <button
          className="link small"
          onClick={() => {
            clearAlert();
            setCleared(true);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** The guide. What it shows follows this device's state, so it moves on by itself. */
export function NotificationsPage({ push, onDone }: { push: Push; onDone: () => void }) {
  return (
    <div className="stack-lg">
      <Guide push={push} onDone={onDone} />
    </div>
  );
}

function Guide({ push: { state, turnOn }, onDone }: { push: Push; onDone: () => void }) {
  const {
    busy,
    error,
    run: onTurnOn,
  } = useSend(
    () => turnOn(),
    (cause) =>
      // The browser's own failures aren't the server's: say so, not "on our side".
      cause instanceof DOMException
        ? `Your ${deviceName()} couldn't turn them on. Try again.`
        : `Couldn't turn them on. ${failureText(cause, "Check your connection and try again.")}`,
  );

  switch (state) {
    case "checking":
      return null;
    case "needs-install":
      return (
        <>
          <div className="stack">
            <h2>Add Pact to your Home Screen</h2>
            <p className="muted">
              {deviceName()} only sends notifications to apps on your Home Screen. This takes about a minute.
            </p>
          </div>
          <ol className="gsteps">
            <li>
              <span>
                In Safari, tap <ShareIcon /> <b>Share</b>. If you don't see it, it's under the <b>•••</b> button.
              </span>
            </li>
            <li>
              <span>
                Scroll down and tap <AddIcon /> <b>Add to Home Screen</b>, then <b>Add</b>.
              </span>
            </li>
            <li>
              <span>
                Close Safari and open <b>Pact</b> from your Home Screen.
              </span>
            </li>
            <li>
              <span>Sign in again. {deviceName()} keeps the installed app separate from Safari.</span>
            </li>
          </ol>
        </>
      );
    case "can-turn-on":
      return (
        <>
          <div className="stack">
            <h2>Turn on notifications</h2>
            <p className="muted">
              Hear when a friend's evidence is waiting for you, when a reviewer decides on yours, and when a pact is
              Missed. You choose which ones in your profile.
            </p>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary block" disabled={busy} onClick={() => onTurnOn()}>
            Turn on notifications
          </button>
        </>
      );
    case "on":
      return (
        <>
          <div className="alert ok">
            <p>
              <b>Notifications are on for this {deviceName()}.</b>
            </p>
            <p className="small">Add Pact on your other devices to get them there too.</p>
          </div>
          <button className="btn block" onClick={onDone}>
            Done
          </button>
        </>
      );
    case "blocked":
      return isIos() ? (
        <>
          <div className="stack">
            <h2>Notifications are blocked</h2>
            <p className="muted">{deviceName()} won't ask twice, so this has to change in Settings.</p>
          </div>
          <ol className="gsteps">
            <li>
              <span>
                Open your {deviceName()}'s <b>Settings</b>.
              </span>
            </li>
            <li>
              <span>
                Tap <b>Notifications</b>, then <b>Pact</b>.
              </span>
            </li>
            <li>
              <span>
                Turn on <b>Allow Notifications</b>, then come back here.
              </span>
            </li>
          </ol>
        </>
      ) : (
        <div className="stack">
          <h2>Notifications are blocked</h2>
          <p className="muted">Allow notifications for this site in your browser's settings, then come back here.</p>
        </div>
      );
    case "unsupported":
      return (
        <div className="stack">
          <h2>Notifications aren't available here</h2>
          <p className="muted">This browser can't get notifications. Open Pact in a current version of your browser.</p>
        </div>
      );
  }
}

/**
 * The profile's section: this device's state, then one switch per kind,
 * grouped in one block. Below it, the Email section.
 */
export function NotificationsSection({ push: { state }, onSetUp }: { push: Push; onSetUp: () => void }) {
  const { state: load } = useLoad(api.notifications);
  const data = loadedData(load);
  const failed = loadFailure(load);
  const [changed, setChanged] = useState<NotificationSettingState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = changed ?? data?.settings ?? null;

  const toggle = async (setting: NotificationSetting, enabled: boolean) => {
    if (!settings) return;
    setError(null);
    setChanged(settings.map((s) => (s.setting === setting ? { setting, enabled } : s)));
    try {
      setChanged(await api.setNotificationSetting({ setting, enabled }));
    } catch (cause) {
      setChanged(settings);
      setError(saveFailureText(cause));
    }
  };

  return (
    <>
      <section className="stack">
        <div className="label">Notifications</div>
        <DeviceLine state={state} onSetUp={onSetUp} />
        {failed && <p className="muted small">Notification settings couldn't load.</p>}
        {settings && (
          <>
            <div className="list">
              {settings.map(({ setting, enabled }) => (
                <SwitchRow
                  key={setting}
                  {...SETTING_COPY[setting]}
                  checked={enabled}
                  onChange={(on) => void toggle(setting, on)}
                />
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <p className="muted small">These apply to all your devices. Reminders are set on each pact.</p>
          </>
        )}
      </section>
      {data && <EmailSection loaded={data.dailySummary} />}
    </>
  );
}

/** The daily summary's one switch, and the address it goes to. */
function EmailSection({ loaded }: { loaded: DailySummarySetting }) {
  const [changed, setChanged] = useState<DailySummarySetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = changed ?? loaded;

  const toggle = async (enabled: boolean) => {
    setError(null);
    setChanged({ ...summary, enabled });
    try {
      setChanged(await api.setDailySummary({ enabled }));
    } catch (cause) {
      setChanged(summary);
      setError(saveFailureText(cause));
    }
  };

  return (
    <section className="stack">
      <div className="label">Email</div>
      <div className="list">
        <SwitchRow
          label="Daily summary"
          hint="An email at 09:00 when items in your Review Queue, or reviewers' questions to you, have waited more than a day"
          checked={summary.enabled}
          onChange={(on) => void toggle(on)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Sent to {summary.to}, your Google address.</p>
    </section>
  );
}

function SwitchRow(props: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch-row">
      <span className="rt">
        <b>{props.label}</b>
        <small>{props.hint}</small>
      </span>
      <input
        className="switch"
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function saveFailureText(cause: unknown): string {
  return `Couldn't save. ${failureText(cause, "Check your connection and try again.")}`;
}

function DeviceLine({ state, onSetUp }: { state: Push["state"]; onSetUp: () => void }) {
  const device = deviceName();
  switch (state) {
    case "checking":
      return null;
    case "on":
      return (
        <div>
          <span className="chip c-ok">On for this {device}</span>
        </div>
      );
    case "unsupported":
      return <span className="muted small">This browser can't get notifications.</span>;
    case "blocked":
    case "needs-install":
    case "can-turn-on":
      return (
        <div className="spread">
          <span>{state === "blocked" ? `Blocked on this ${device}` : `Off on this ${device}`}</span>
          <button className="link" onClick={onSetUp}>
            {{ blocked: "Fix this", "needs-install": "Set up", "can-turn-on": "Turn on" }[state]}
          </button>
        </div>
      );
  }
}
