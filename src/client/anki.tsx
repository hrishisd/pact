// AnkiWeb pieces more than one screen uses: the sign-in fields (the Connect
// AnkiWeb step, and Reconnect), the alert when Pact can't read the owner's
// AnkiWeb (Today and an Anki pact's page), and the alert when a pact's deck
// is gone from Anki.

import { useState } from "react";
import { RECONNECT_TEXT, type ConnectionProblem } from "../shared/types.ts";
import { api, failureText } from "./api.ts";

/** The AnkiWeb sign-in fields, and why the last try didn't connect. */
export interface AnkiLogin {
  email: string;
  password: string;
  busy: boolean;
  failed: "wrong-login" | "unreachable" | "unavailable" | { error: unknown } | null;
}

export const NO_ANKI_LOGIN: AnkiLogin = { email: "", password: "", busy: false, failed: null };

/** Signs in to AnkiWeb with `login`: true once connected, else the login with why it failed. */
export async function signInToAnki(login: AnkiLogin): Promise<true | AnkiLogin> {
  try {
    const result = await api.connectAnki({ email: login.email, password: login.password });
    if (result.ok) return true;
    return { ...login, busy: false, failed: result.reason };
  } catch (error) {
    return { ...login, busy: false, failed: { error } };
  }
}

/** The AnkiWeb email and password, and why the last try didn't connect. */
export function AnkiLoginFields({
  login,
  onChange,
}: {
  login: AnkiLogin;
  onChange: (change: Partial<AnkiLogin>) => void;
}) {
  const { failed } = login;
  return (
    <>
      <label className="field">
        <span>AnkiWeb email</span>
        <input
          className="inp"
          type="email"
          autoComplete="username"
          value={login.email}
          placeholder="you@example.com"
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          className="inp"
          type="password"
          autoComplete="current-password"
          value={login.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      </label>
      {failed === "wrong-login" && <p className="error">AnkiWeb didn't accept that email and password.</p>}
      {failed === "unreachable" && <p className="error">Couldn't reach AnkiWeb. Try again in a minute.</p>}
      {failed === "unavailable" && <p className="error">Anki isn't set up yet.</p>}
      {typeof failed === "object" && failed !== null && (
        <p className="error">Couldn't connect. {failureText(failed.error, "Check your connection and try again.")}</p>
      )}
    </>
  );
}

/**
 * Reconnect AnkiWeb in place: the email and password, then Reconnect.
 * `onReconnected` runs once AnkiWeb took them.
 */
export function AnkiReconnectForm({ onReconnected, onCancel }: { onReconnected: () => void; onCancel: () => void }) {
  const [login, setLogin] = useState<AnkiLogin>(NO_ANKI_LOGIN);
  const reconnect = async () => {
    setLogin({ ...login, busy: true, failed: null });
    const result = await signInToAnki(login);
    if (result === true) return onReconnected();
    setLogin(result);
  };
  return (
    <div className="stack">
      <AnkiLoginFields login={login} onChange={(change) => setLogin((l) => ({ ...l, ...change }))} />
      <div className="row2">
        <button className="btn sm" disabled={login.busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn sm primary"
          disabled={login.busy || login.email.trim() === "" || login.password === ""}
          onClick={() => void reconnect()}
        >
          {login.busy ? "Reconnecting…" : "Reconnect"}
        </button>
      </div>
    </div>
  );
}

/**
 * Pact can't read the owner's AnkiWeb while an Anki pact needs it.
 * Reconnect signs in again here; `onReconnected` reloads the screen.
 */
export function AnkiConnectionAlert({
  status,
  onReconnected,
}: {
  status: ConnectionProblem;
  onReconnected: () => void;
}) {
  const [reconnecting, setReconnecting] = useState(false);
  return (
    <div className="alert bad" role="status">
      <span>
        <b>{status === "needs-reconnecting" ? "AnkiWeb needs reconnecting." : "AnkiWeb is disconnected."}</b>{" "}
        {RECONNECT_TEXT.anki}
      </span>
      {reconnecting ? (
        <AnkiReconnectForm onReconnected={onReconnected} onCancel={() => setReconnecting(false)} />
      ) : (
        <div className="row2">
          <button className="btn sm primary" onClick={() => setReconnecting(true)}>
            Reconnect AnkiWeb
          </button>
        </div>
      )}
    </div>
  );
}

/** A pact's deck is gone from Anki: its days count as Missed, and the owner can excuse them. */
export function AnkiDeckMissing({ deckName }: { deckName: string | null }) {
  return (
    <div className="alert bad" role="status">
      <span>
        <b>{deckName === null ? "The deck is gone from Anki." : `The ${deckName} deck is gone from Anki.`}</b> Its days
        count as Missed until it's back. File an excuse for a day you couldn't help.
      </span>
    </div>
  );
}
