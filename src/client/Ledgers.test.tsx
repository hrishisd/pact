import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LedgersResponse } from "../shared/api.ts";
import { Ledgers } from "./Ledgers.tsx";
import { renderWithUser, stubApi } from "./testing/render.tsx";

type Ledger = LedgersResponse[number];

/** Sam's ledger with nothing owed, nothing waiting, and $5 paid. */
function sam(overrides: Partial<Ledger> = {}): Ledger {
  return {
    recipientId: "sam",
    name: "Sam",
    owedCents: 0,
    payableCents: 0,
    awaitingCents: 0,
    awaitingCount: 0,
    paidCents: 500,
    suggestedPaymentCents: 0,
    overdueCents: 0,
    billDue: null,
    creditCents: 0,
    creditWaitsOn: [],
    ...overrides,
  };
}

async function showLedgers(ledger: Ledger) {
  stubApi({ ledgers: async () => [ledger] });
  renderWithUser(<Ledgers timezone="America/New_York" onOpenLedger={vi.fn()} />);
  await screen.findByText("Sam");
}

describe("a ledger's credit", () => {
  test("shows beside owed $0, saying it pays the next penalties", async () => {
    await showLedgers(sam({ creditCents: 500 }));
    expect(screen.getByText("$5 credit. It pays your next penalties.")).toBeTruthy();
  });

  test("while an excuse holding a paid penalty waits, it's a credit only if the excuse is approved", async () => {
    await showLedgers(sam({ creditCents: 500, creditWaitsOn: ["excuse"] }));
    expect(screen.getByText("$5 credit if the excuse is approved")).toBeTruthy();
  });

  test("a waiting vacation, or both, are named", async () => {
    await showLedgers(sam({ creditCents: 500, creditWaitsOn: ["excuse", "vacation"] }));
    expect(screen.getByText("$5 credit if the excuse and vacation are approved")).toBeTruthy();
  });

  test("with no credit, there's no credit line", async () => {
    await showLedgers(sam());
    expect(screen.queryByText(/credit/)).toBeNull();
  });
});
