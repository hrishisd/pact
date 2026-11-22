// The operator alert path. Every operator alert, the core's and the adapters',
// goes through `operatorAlerts`: it writes the OPERATOR_ALERT log line and
// emails the operator's address (OPERATOR_EMAIL). The email skips the outbox
// and the database, so it still goes after a restore from an old backup. The
// push, for the alerts that have one, is the core's, through the outbox
// (`pushOperatorAlert`, outbox.ts).

import type { Mailer } from "./ports.ts";

export interface OperatorAlert {
  /** A few words for the email's subject, such as "database restored from backup". */
  title: string;
  /** The whole alert: the log line's words after its tag, and the email's body. */
  text: string;
  /** Only the log line: for an alert already emailed, or one about email itself. */
  withoutEmail?: boolean;
}

/**
 * Raises an operator alert: writes the log line now and starts the email
 * without waiting for it, so a slow mail server never holds up a boot, a
 * tick or an adapter's call. A failed email is logged and not retried.
 */
export type RaiseOperatorAlert = (alert: OperatorAlert) => void;

export interface OperatorAlerts {
  raise: RaiseOperatorAlert;
  /** Settles once every email started so far is sent or has failed. Shutdown waits on it, briefly. */
  settled(): Promise<void>;
}

export function operatorAlerts(options: {
  mailer: Mailer;
  operatorEmail: string;
  log: (line: string) => void;
}): OperatorAlerts {
  const { mailer, operatorEmail: to, log } = options;
  const sending = new Set<Promise<void>>();
  return {
    raise({ title, text, withoutEmail = false }) {
      log(`OPERATOR_ALERT ${text}`);
      if (withoutEmail) return;
      const send = mailer
        .send({ to, subject: `Pact operator alert: ${title}`, text: `${text}\n` })
        .catch((error: unknown) =>
          log(`operator alert email to ${to} failed, not retried: "${title}": ${String(error)}`),
        )
        .finally(() => sending.delete(send));
      sending.add(send);
    },
    async settled() {
      await Promise.all(sending);
    },
  };
}
