// Recording a payment, from a ledger: the owner paid the recipient outside
// the app and sends a screenshot of it for a reviewer to approve. Until then
// it doesn't lower what's owed.

import { useEffect, useRef, useState } from "react";
import type { Json, RecordPaymentRequest } from "../shared/api.ts";
import type { LedgerSummary, RecordPaymentRefusal } from "../shared/types.ts";
import { api, uploadFailureText } from "./api.ts";
import { centsInputText, money, parseCents } from "./format.ts";
import { shrinkForPreview, type ShrunkPhoto } from "./photos.ts";
import { Sheet, useSend } from "./ui.tsx";

/**
 * The Record a payment sheet for one ledger. The amount starts at the open
 * bills' amount (overdue and due), or with no open bill at the most it may
 * be, the ledger's `payableCents`.
 */
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
  const input = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(() => centsInputText(startingCents(ledger)));
  const [screenshot, setScreenshot] = useState<ShrunkPhoto | null>(null);
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
  // Whether the sheet is still there for a pick to finish into.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The thumbnail's object URL is revoked when it's replaced or removed and when the sheet goes.
  useEffect(() => {
    const url = screenshot?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [screenshot]);

  const amountCents = parseCents(amount);
  const tooMuch = amountCents !== null && amountCents > payableCents;
  const ready = amountCents !== null && amountCents > 0 && !tooMuch && screenshot !== null;

  const pick = async (file: File) => {
    setError(null);
    try {
      const picked = await shrinkForPreview(file);
      if (mounted.current) setScreenshot(picked);
      else URL.revokeObjectURL(picked.url);
    } catch {
      if (mounted.current) setError("That image couldn't be read. Choose another.");
    }
  };
  const remove = () => setScreenshot(null);
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
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pick(file);
          }}
        />
        {screenshot ? (
          <div className="photos">
            <div className="thumb">
              <img src={screenshot.url} alt="Screenshot of the payment" />
              <button className="remove" aria-label="Remove the screenshot" onClick={remove}>
                ×
              </button>
            </div>
          </div>
        ) : (
          <button className="btn self-start" onClick={() => input.current?.click()}>
            Choose screenshot
          </button>
        )}
      </div>
      <label className="field">
        <span>Note (optional)</span>
        <input
          className="inp"
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
};

/** What the amount starts at: the open bills' amount, or everything that may be paid when no bill is open. */
function startingCents(ledger: Json<LedgerSummary>): number {
  const billsCents = ledger.overdueCents + (ledger.billDue?.amountCents ?? 0);
  return billsCents > 0 ? Math.min(billsCents, ledger.payableCents) : ledger.payableCents;
}

/** An amount over the ledger's `payableCents`: more than owed, or, with payments awaiting approval, more than what's left. */
function overLimitText(ledger: Json<LedgerSummary>): string {
  return ledger.awaitingCents === 0 ? "That's more than you owe." : `That's more than ${money(ledger.payableCents)}.`;
}
