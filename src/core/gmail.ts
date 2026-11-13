// The Mailer adapters: Gmail in production, sending from an account made just
// for Pact through smtp.gmail.com on port 587, upgraded with STARTTLS before
// the app password is sent; and a stand-in for development that logs each
// email instead of sending it, so local development needs no Gmail account.
// Nodemailer speaks SMTP and builds the MIME message.

import { createTransport } from "nodemailer";
import type { Mailer } from "./ports.ts";

export interface GmailAccount {
  address: string;
  /** An app password: Gmail takes it in place of the account's password, which 2-Step Verification guards. */
  appPassword: string;
}

export interface GmailOptions {
  /** Gmail's mail server; tests point it at a fake one. */
  host?: string;
  port?: number;
  /** Refuse to log in until STARTTLS has secured the connection. Default true; a test's fake server has no certificate. */
  requireTLS?: boolean;
}

export function gmailMailer(account: GmailAccount, options: GmailOptions = {}): Mailer {
  const transport = createTransport({
    host: options.host ?? "smtp.gmail.com",
    port: options.port ?? 587,
    // Port 587 starts in plain text and upgrades with STARTTLS.
    secure: false,
    requireTLS: options.requireTLS ?? true,
    auth: { user: account.address, pass: account.appPassword },
    // Milliseconds. An operator alert waits for its email, so a mail server that hangs mustn't hold it up for long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return {
    async send({ to, subject, text, html }) {
      // One recipient, so a refusal rejects.
      await transport.sendMail({ from: { name: "Pact", address: account.address }, to, subject, text, html });
    },
  };
}

/** Development only, without a Gmail account: each email is logged, not sent. */
export function devMailer(log: (line: string) => void): Mailer {
  return {
    async send({ to, subject, text }) {
      log(`email not sent (development, no Gmail account): to ${to}, "${subject}"\n${text}`);
    },
  };
}
