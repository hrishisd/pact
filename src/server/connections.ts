// Connecting and disconnecting Oura and AnkiWeb. Two places hold a
// connection: the adapter keeps its tokens (Oura's, or AnkiWeb's host key)
// and the core records the connection. These own the order the two change in.

import type { AccountId, AnkiConnector, ConnectionService, OuraConnector, PactCore } from "../core/index.ts";
import type { ConnectAnkiRequest, ConnectAnkiResponse, OuraResult } from "../shared/api.ts";

export interface Connections {
  /**
   * Oura's tokens first, from the code its callback carried; the core
   * records the connection once they're stored. A failure is logged.
   */
  connectOura(accountId: AccountId, code: string): Promise<Extract<OuraResult, "connected" | "failed" | "unavailable">>;
  /**
   * AnkiWeb trades the email and password for a host key, which the adapter
   * stores, and the password goes no further; the core records the
   * connection once it's stored. A failure to reach AnkiWeb is logged.
   */
  connectAnki(accountId: AccountId, request: ConnectAnkiRequest): Promise<ConnectAnkiResponse>;
  /**
   * The core first, so a failure leaves the connection as it was; then the
   * adapter forgets the tokens. AnkiWeb's host key and collection copy go
   * once any check already running for the account has finished.
   */
  disconnect(accountId: AccountId, service: ConnectionService): Promise<void>;
}

export function connections({
  core,
  oura,
  anki,
  log,
}: {
  core: PactCore;
  /** Null when Oura isn't set up: connecting is `unavailable`. */
  oura: OuraConnector | null;
  /** Null when Anki isn't set up: connecting is `unavailable`. */
  anki: AnkiConnector | null;
  log: (line: string) => void;
}): Connections {
  return {
    async connectOura(accountId, code) {
      if (!oura) return "unavailable";
      const connected = await oura.connect(accountId, code).catch((failure: unknown) => {
        log(`oura connect failed: ${messageOf(failure)}`);
        return { ok: false as const };
      });
      if (!connected.ok) return "failed";
      await core.as(accountId).connectOura();
      return "connected";
    },

    async connectAnki(accountId, { email, password }) {
      if (!anki) return { ok: false, reason: "unavailable" };
      const connected = await anki.login(accountId, email.trim(), password).catch((failure: unknown) => {
        log(`anki connect failed: ${messageOf(failure)}`);
        return { ok: false as const, reason: "unreachable" as const };
      });
      if (connected.ok) await core.as(accountId).connectAnki();
      return connected;
    },

    async disconnect(accountId, service) {
      if (service === "oura") {
        await core.as(accountId).disconnectOura();
        oura?.forget(accountId);
      } else {
        await core.as(accountId).disconnectAnki();
        await anki?.forget(accountId);
      }
    },
  };
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
