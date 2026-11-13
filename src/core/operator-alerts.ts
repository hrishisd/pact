// The operator alert path. Every operator alert, the core's and the adapters',
// goes through `operatorAlerts`: it writes the OPERATOR_ALERT log line and
// emails the operator's address (OPERATOR_EMAIL) at once. The email skips the
// outbox and the database, so it still goes after a restore from an old
// backup. The push, for the alerts that have one, is the core's, through the
// outbox (core.ts).

import type { Mailer } from "./ports.ts";

export interface OperatorAlert {
  /** A few words for the email's subject, such as "database restored from backup". */
  title: string;
  /** The whole alert: the log line's words after its tag, and the email's body. */
  text: string;
}

/**
 * Raises an operator alert. The log line is written before it returns; the
 * promise settles once the email is sent or has failed. It never rejects: a
 * failed email is logged and not retried.
 */
export type RaiseOperatorAlert = (alert: OperatorAlert) => Promise<void>;

export function operatorAlerts(options: {
  mailer: Mailer;
  operatorEmail: string;
  log: (line: string) => void;
}): RaiseOperatorAlert {
  const { mailer, operatorEmail: to, log } = options;
  return async ({ title, text }) => {
    log(`OPERATOR_ALERT ${text}`);
    try {
      await mailer.send({ to, subject: `Pact operator alert: ${title}`, text: `${text}\n` });
    } catch (error) {
      log(`operator alert email to ${to} failed, not retried: "${title}": ${String(error)}`);
    }
  };
}
