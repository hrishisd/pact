// The Profile sheet's Friends section: who you're friends with, and an invite link to share.

import { useState } from "react";
import { invitePath } from "../shared/api.ts";
import { api, failureText } from "./api.ts";
import { initial } from "./format.ts";
import { useLoad } from "./ui.tsx";

export function FriendsSection() {
  const { data: friends, failed } = useLoad(api.friends);

  return (
    <section className="stack">
      <div className="label">Friends</div>
      {failed && <p className="muted small">Friends couldn't load.</p>}
      {friends?.length === 0 && <p className="muted small">No friends yet.</p>}
      {friends !== null && friends.length > 0 && (
        <div className="list">
          {friends.map((friend) => (
            <div key={friend.id} className="rowbtn">
              <span className="avatar sm" aria-hidden="true">
                {initial(friend.name)}
              </span>
              <span className="rt">
                <b>{friend.name}</b>
              </span>
            </div>
          ))}
        </div>
      )}
      <InviteFriend />
    </section>
  );
}

type InviteState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; url: string; copied: boolean };

/**
 * Story 6: makes an invite link and opens the phone's share sheet. Without
 * one, it copies the link. The link stays on screen either way, with Share
 * and Copy, in case the first try didn't go through.
 */
function InviteFriend() {
  const [state, setState] = useState<InviteState>({ kind: "idle" });
  const canShare = typeof navigator.share === "function";

  const share = async (url: string) => {
    try {
      await navigator.share({ url });
    } catch {
      // Cancelled, or the browser wanted a fresh tap: the link and its buttons are on screen.
    }
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: "ready", url, copied: true });
    } catch {
      // No clipboard access: the link is on screen to copy by hand.
    }
  };
  const create = async () => {
    setState({ kind: "creating" });
    try {
      const invite = await api.createInvite();
      const url = new URL(invitePath(invite.token), window.location.origin).href;
      setState({ kind: "ready", url, copied: false });
      if (canShare) await share(url);
      else await copy(url);
    } catch (error) {
      setState({ kind: "failed", error });
    }
  };

  if (state.kind !== "ready") {
    return (
      <>
        <button className="btn" disabled={state.kind === "creating"} onClick={() => void create()}>
          Invite a friend
        </button>
        {state.kind === "failed" ? (
          <p className="error">Couldn't make a link. {failureText(state.error, "Check your connection and try again.")}</p>
        ) : (
          <p className="muted small">Each link works once and expires in 7 days.</p>
        )}
      </>
    );
  }
  return (
    <div className="alert info">
      <p>Send this link to a friend. It works once and expires in 7 days.</p>
      <code className="invite-link">{state.url}</code>
      <div className="row2">
        {canShare && (
          <button className="btn sm" onClick={() => void share(state.url)}>
            Share
          </button>
        )}
        <button className="btn sm" onClick={() => void copy(state.url)}>
          {state.copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
