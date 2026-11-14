# 01 Operator alert emails: the email port, the Gmail adapter, and all four alerts by email

Status: done
Blocked by: none

Spec: `../spec.md` stories 12 and 13, and the Implementation decisions sections "What is emailed" (operator alerts), "What an email says" (operator alert emails) and "Sending".

## What to build

Every operator alert reaches the operator's inbox as well as the log and the push. This ticket builds the sending path the daily summary (ticket 02) reuses.

### Core and server
- **An email port** in `src/core/ports.ts`, apart from `Notifier`: a sketch is `send({ to, subject, text, html? })`, rejecting when the message isn't accepted. A fake in `src/core/testing/` records what was sent.
- **A Gmail adapter** sending through `smtp.gmail.com` on port 587 with STARTTLS and an app password. Pick a small, maintained SMTP library, or justify writing to the socket directly. New Fly secrets for the sender's address and app password, read in `src/server/config.ts`. Without them outside production, the server logs each email instead of sending it, so local dev needs no Gmail account (note it in `docs/agents/local-dev.md`). Production refuses to start without them, as for the other required secrets; add them to the Fly secrets check (`check-fly-secrets`).
- **One operator alert path** that writes the `OPERATOR_ALERT` log line and emails `OPERATOR_EMAIL` (from config, not the database), as well as the existing push where there is one. The email is sent straight away, not through the outbox, so it still goes after a restore from an old backup. A failed send is logged, not retried.
- **All four alerts use it:** reminders dropped after downtime and the database restored (both in `core.ts`, which also keep their push), and the Oura refresh-token alert and the AnkiWeb protocol-error alert (`oura.ts`, `anki.ts`), which today only log. Give the adapters a way to raise one without the outbox.
- **The email** is plain text: subject "Pact operator alert: <short title>", body the log line's words.

### Docs
- `docs/behaviour.md`, "Notifications and reminders": operator alerts go by email too.
- ADR 0002: rewrite the Notifications and Operator alerts bullets to describe what's built (Gmail, a dedicated account, the email port, no outbox for operator alerts).
- `GLOSSARY.md`, Operator alert: drop "once email is built".

## Acceptance criteria

- [x] Reminders dropped after downtime: one email to the operator address with the count, plus the existing push and log line.
- [x] Database restored on boot: one email with the last scheduler tick, even when the restored database has no push subscription for the operator.
- [x] The Oura refresh-token alert and the AnkiWeb protocol-error alert each send one email to the operator address.
- [x] A failing email port doesn't stop the log line or the push, and its failure is logged.
- [x] Outside production without Gmail secrets, an alert's email is logged, not sent; in production, missing Gmail secrets stop the server starting.
- [x] `npm run check` passes.
- [ ] Manual: an operator alert email reaches the iPhone inbox, not spam (`../manual-checks.md`).
