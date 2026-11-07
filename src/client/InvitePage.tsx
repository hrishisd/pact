// The page an invite link opens (story 7). It shows before the sign-in gate:
// a signed-out visitor signs in with Google from here, comes back here, and accepts.

import { useEffect, useState } from "react";
import type { AcceptInviteResponse, InviteLookupResponse, MeResponse } from "../shared/api.ts";
import type { InviteUnusableReason, Refusal } from "../shared/types.ts";
import { api, failureText, signInWithInvite } from "./api.ts";
import { GoogleIcon } from "./icons.tsx";
import { initial } from "./format.ts";
import { Centered, useSend } from "./ui.tsx";

type State =
  | { kind: "loading" }
  | { kind: "failed"; error: unknown }
  | { kind: "open"; inviterName: string }
  | { kind: "refused"; reason: Refusal<AcceptInviteResponse>; inviterName?: string }
  | { kind: "accepted"; friendName: string };

export function InvitePage({
  token,
  profile,
  onDone,
}: {
  token: string;
  /** Null when signed out. */
  profile: MeResponse | null;
  /** Leaves the invite page for the app. */
  onDone: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [signingIn, setSigningIn] = useState(false);
  // Google sign-in that went wrong comes back here with ?error=<code>.
  const [signInFailed] = useState(() => new URLSearchParams(window.location.search).has("error"));

  const load = () => {
    setState({ kind: "loading" });
    api.invite(token).then(
      (lookup: InviteLookupResponse) =>
        setState(
          lookup.ok ? { kind: "open", inviterName: lookup.inviterName } : { kind: "refused", reason: lookup.reason },
        ),
      (error: unknown) => setState({ kind: "failed", error }),
    );
  };
  useEffect(load, [token]);

  // A refusal is a screen of its own, not an error under Accept.
  const {
    busy,
    error: acceptError,
    run: accept,
  } = useSend(
    async (inviterName: string) => {
      const result = await api.acceptInvite(token);
      setState(
        result.ok
          ? { kind: "accepted", friendName: result.friend.name }
          : { kind: "refused", reason: result.reason, inviterName },
      );
    },
    (error) => `Couldn't accept. ${failureText(error, "Check your connection and try again.")}`,
  );

  const openPact = profile && (
    <button className="btn block" onClick={onDone}>
      Open Pact
    </button>
  );

  switch (state.kind) {
    case "loading":
      return <div className="screen" aria-busy="true" />;
    case "failed":
      return (
        <Centered>
          <h1>This invite couldn't load</h1>
          <p className="muted">{failureText(state.error, "Check your connection and try again.")}</p>
          <button className="btn primary" onClick={load}>
            Try again
          </button>
        </Centered>
      );
    case "refused": {
      const { title, body } = refusalText(state.reason, state.inviterName);
      return (
        <Centered>
          <h1>{title}</h1>
          <p className="muted">{body}</p>
          {openPact}
        </Centered>
      );
    }
    case "accepted":
      return (
        <Centered>
          <h1>You and {state.friendName} are friends</h1>
          <p className="muted">You can now pick each other to review pacts.</p>
          <button className="btn primary block" onClick={onDone}>
            Open Pact
          </button>
        </Centered>
      );
    case "open": {
      const { inviterName } = state;
      return (
        <Centered>
          <div className="stack invite-head">
            <span className="avatar lg" aria-hidden="true">
              {initial(inviterName)}
            </span>
            <h1>{inviterName} invited you to Pact</h1>
            <p className="muted">Commitments with money on the line, checked by your friends.</p>
          </div>
          <div className="card">
            <b>Accepting makes you friends.</b>
            <p>You can pick each other as reviewers on pacts. A reviewer checks evidence and decides on excuses.</p>
          </div>
          {profile ? (
            <div className="stack">
              {acceptError && <p className="error">{acceptError}</p>}
              <button className="btn primary block" disabled={busy} onClick={() => accept(inviterName)}>
                Accept
              </button>
              <button className="btn block" onClick={onDone}>
                Not now
              </button>
              <p className="muted small">Signed in as {profile.email}</p>
            </div>
          ) : (
            <div className="stack">
              {signInFailed && <p className="error">Sign-in didn't work. Try again.</p>}
              <button
                className="btn block google"
                disabled={signingIn}
                onClick={() => {
                  setSigningIn(true);
                  signInWithInvite(token).catch(() => setSigningIn(false));
                }}
              >
                <GoogleIcon />
                Sign in with Google
              </button>
              <p className="muted small">Then you can accept.</p>
            </div>
          )}
        </Centered>
      );
    }
  }
}

function refusalText(
  reason: Refusal<AcceptInviteResponse>,
  inviterName: string | undefined,
): { title: string; body: string } {
  const unusable: Record<InviteUnusableReason, { title: string; body: string }> = {
    "invite-not-found": {
      title: "This invite link doesn't work",
      body: "Check you have the whole link, or ask your friend for a new one.",
    },
    "invite-used": {
      title: "This invite has been used",
      body: "Each invite link works once. Ask your friend for a new one.",
    },
    "invite-expired": {
      title: "This invite has expired",
      body: "Invite links last 7 days. Ask your friend for a new one.",
    },
  };
  switch (reason) {
    case "own-invite":
      return { title: "This is your own invite", body: "Send the link to a friend so they can accept it." };
    case "already-friends":
      return {
        title: inviterName ? `You and ${inviterName} are already friends` : "You're already friends",
        body: "You can already pick each other to review pacts.",
      };
    default:
      return unusable[reason];
  }
}
