// The Gmail adapter at its seam: what it says to a mail server. A fake SMTP
// server on this machine answers; nothing reaches Gmail. The fake offers no
// STARTTLS, so the tests that send turn the adapter's TLS requirement off,
// and one test checks the adapter refuses to send without it.

import { createServer, type AddressInfo } from "node:net";
import { expect, onTestFinished, test } from "vitest";
import { devMailer, gmailMailer } from "./gmail.ts";

const ACCOUNT = { address: "pact.sender@gmail.example", appPassword: "abcdefghijklmnop" };
const EMAIL = { to: "operator@example.test", subject: "Pact operator alert: a test", text: "Something happened.\n" };

interface Received {
  /** The AUTH line's argument, decoded. */
  auth: string | null;
  mailFrom: string | null;
  rcptTo: string[];
  /** The message as sent after DATA, CRLFs read as LFs. */
  data: string;
}

/**
 * A mail server that accepts every message, or refuses `refusedRecipient`.
 * `received` holds the messages it took; `logins`, every AUTH line's argument,
 * decoded, by connection, whether or not a message followed. Closes when the test ends.
 */
async function fakeSmtp(refusedRecipient?: string) {
  const received: Received[] = [];
  const logins: string[][] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    const session: Received = { auth: null, mailFrom: null, rcptTo: [], data: "" };
    const connectionLogins: string[] = [];
    logins.push(connectionLogins);
    let buffered = "";
    let inData = false;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 smtp.fake.test ESMTP");
    socket.on("data", (chunk: string) => {
      buffered += chunk;
      for (let end = buffered.indexOf("\r\n"); end >= 0; end = buffered.indexOf("\r\n")) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(structuredClone(session));
            reply("250 2.0.0 OK queued");
          } else session.data += `${line}\n`;
          continue;
        }
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO") {
          reply("250-smtp.fake.test");
          reply("250 AUTH PLAIN");
        } else if (verb === "AUTH") {
          session.auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8");
          connectionLogins.push(session.auth);
          reply("235 2.7.0 Accepted");
        } else if (verb === "MAIL") {
          session.mailFrom = line;
          reply("250 2.1.0 OK");
        } else if (verb === "RCPT") {
          if (refusedRecipient && line.includes(refusedRecipient)) reply("550 5.1.1 No such user");
          else {
            session.rcptTo.push(line);
            reply("250 2.1.5 OK");
          }
        } else if (verb === "DATA") {
          inData = true;
          reply("354 Go ahead");
        } else if (verb === "QUIT") {
          reply("221 2.0.0 Bye");
          socket.end();
        } else if (verb === "RSET") reply("250 OK");
        else reply("502 5.5.1 Unrecognized command");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { received, logins, port: (server.address() as AddressInfo).port };
}

test("sends from the Pact account, logged in with its app password, to the address given", async () => {
  const smtp = await fakeSmtp();
  const mailer = gmailMailer(ACCOUNT, { host: "127.0.0.1", port: smtp.port, requireTLS: false });

  await mailer.send(EMAIL);

  expect(smtp.received).toHaveLength(1);
  const [message] = smtp.received;
  expect(message!.auth).toBe("\0pact.sender@gmail.example\0abcdefghijklmnop");
  expect(message!.mailFrom).toContain("<pact.sender@gmail.example>");
  expect(message!.rcptTo).toEqual([expect.stringContaining("<operator@example.test>")]);
  expect(message!.data).toContain("From: Pact <pact.sender@gmail.example>\n");
  expect(message!.data).toContain("To: operator@example.test\n");
  expect(message!.data).toContain("Subject: Pact operator alert: a test\n");
  expect(message!.data).toContain("Content-Type: text/plain");
  expect(message!.data).toContain("\n\nSomething happened.\n");
});

test("sends an HTML version beside the plain text when there is one", async () => {
  const smtp = await fakeSmtp();
  const mailer = gmailMailer(ACCOUNT, { host: "127.0.0.1", port: smtp.port, requireTLS: false });

  await mailer.send({ ...EMAIL, html: "<p>Something happened.</p>" });

  const data = smtp.received[0]!.data;
  expect(data).toContain("Content-Type: multipart/alternative");
  expect(data).toContain("Content-Type: text/plain");
  expect(data).toContain("Content-Type: text/html");
  expect(data).toContain("<p>Something happened.</p>");
});

test("rejects when the mail server refuses the message", async () => {
  const smtp = await fakeSmtp("operator@example.test");
  const mailer = gmailMailer(ACCOUNT, { host: "127.0.0.1", port: smtp.port, requireTLS: false });

  await expect(mailer.send(EMAIL)).rejects.toThrow(/No such user/);
  expect(smtp.received).toEqual([]);
});

test("never sends the app password over a connection that STARTTLS hasn't secured", async () => {
  const smtp = await fakeSmtp();
  const mailer = gmailMailer(ACCOUNT, { host: "127.0.0.1", port: smtp.port });

  await expect(mailer.send(EMAIL)).rejects.toThrow(/STARTTLS/);
  expect(smtp.logins).toEqual([[]]);
  expect(smtp.received).toEqual([]);
});

test("development without a Gmail account logs each email instead of sending it", async () => {
  const logs: string[] = [];

  await devMailer((line) => logs.push(line)).send(EMAIL);

  expect(logs).toEqual([
    'email not sent (development, no Gmail account): to operator@example.test, "Pact operator alert: a test"\nSomething happened.\n',
  ]);
});
