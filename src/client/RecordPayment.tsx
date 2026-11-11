// Recording a payment, from a ledger: the owner paid the recipient outside
// the app and sends a screenshot of it for a reviewer to approve. Until then
// it doesn't lower what's owed.

import { useState } from "react";
import type { Json, RecordPaymentRequest } from "../shared/api.ts";
import { MAX_TEXT_CHARS, type LedgerSummary, type RecordPaymentRefusal } from "../shared/types.ts";
import { api, TEXT_TOO_LONG_TEXT, uploadFailureText } from "./api.ts";
import { centsInputText, money, parseCents } from "./format.ts";
import { usePhotoPicks } from "./photos.ts";
import { Sheet, useSend } from "./ui.tsx";

/** The Record a payment sheet for one ledger. The amount starts at the core's `suggestedPaymentCents`. */
export function RecordPaymentSheet({
  ledger,
  onClose,
  onSent,
}: {
  ledger: Json<LedgerSummary>;
  onClose: () => void;
  /** After the payment was recorded: the sheet's owner closes it and reloads. */
  onSent: () => void;
}) {
  const { payableCents } = ledger;
  const [amount, setAmount] = useState(() => centsInputText(ledger.suggestedPaymentCents));
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useSend(
    async (payment: RecordPaymentRequest, screenshotBlob: Blob) => {
      const result = await api.recordPayment(ledger.recipientId, payment, screenshotBlob);
      if (!result.ok) {
        return result.reason === "payment-exceeds-owed" ? overLimitText(ledger) : REFUSAL_TEXT[result.reason];
      }
      onSent();
    },
    (failure) =>
      uploadFailureText(
        failure,
        "The screenshot was too large to send. Choose another.",
        "Couldn't send. Check your connection and try again.",
      ),
  );
  // One screenshot: once it's picked, Choose screenshot makes way for its thumbnail.
  const picks = usePhotoPicks({ max: 1, unreadable: "That image couldn't be read. Choose another.", setError });
  const screenshot = picks.photos[0] ?? null;

  const amountCents = parseCents(amount);
  const tooMuch = amountCents !== null && amountCents > payableCents;
  const ready = amountCents !== null && amountCents > 0 && !tooMuch && screenshot !== null;

  const send = () => {
    if (ready && amountCents !== null && screenshot !== null) run({ amountCents, note }, screenshot.blob);
  };

  return (
    <Sheet title="Record a payment" closeLabel="Cancel" onClose={onClose}>
      <p className="muted">To {ledger.name}</p>
      <label className="field">
        <span>Amount</span>
        <span className="money-inp">
          <b>$</b>
          <input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </span>
        <small>
          {ledger.awaitingCents === 0
            ? `Up to ${money(payableCents)}.`
            : `Up to ${money(payableCents)}, as ${money(ledger.awaitingCents)} is awaiting approval.`}
          {tooMuch && <b className="error"> {overLimitText(ledger)}</b>}
        </small>
      </label>
      <div className="field">
        <span>Screenshot of the payment</span>
        {/* The photo library, not the camera: it's a screenshot. */}
        <input ref={picks.input} type="file" accept="image/*" hidden onChange={picks.onChange} />
        {screenshot ? (
          <div className="photos">
            <div className="thumb">
              <img src={screenshot.url} alt="Screenshot of the payment" />
              <button className="remove" aria-label="Remove the screenshot" onClick={() => picks.remove(screenshot)}>
                ×
              </button>
            </div>
          </div>
        ) : (
          <button className="btn self-start" onClick={picks.choose}>
            Choose screenshot
          </button>
        )}
      </div>
      <label className="field">
        <span>Note (optional)</span>
        <input
          className="inp"
          maxLength={MAX_TEXT_CHARS}
          value={note}
          placeholder="e.g. Sent on Venmo"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p className="muted small">
        A reviewer checks the screenshot. It doesn't lower what you owe until they approve it.
      </p>
      {error && <p className="error small">{error}</p>}
      <button className="btn primary block" disabled={busy || !ready} onClick={send}>
        {busy ? "Sending…" : "Send for approval"}
      </button>
    </Sheet>
  );
}

const REFUSAL_TEXT: Record<Exclude<RecordPaymentRefusal, "payment-exceeds-owed">, string> = {
  "recipient-not-found": "This ledger wasn't found.",
  "invalid-amount": "Enter an amount above $0.",
  "no-screenshot": "Choose a screenshot of the payment.",
  "text-too-long": TEXT_TOO_LONG_TEXT,
};

/** An amount over the ledger's `payableCents`: more than owed, or, with payments awaiting approval, more than what's left. */
function overLimitText(ledger: Json<LedgerSummary>): string {
  return ledger.awaitingCents === 0 ? "That's more than you owe." : `That's more than ${money(ledger.payableCents)}.`;
}
