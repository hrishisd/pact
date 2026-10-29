import { describe, expect, test } from "vitest";
import { failOnCall } from "./testing/fakes.ts";
import { scenario } from "./testing/scenario.ts";

const OPERATOR_ALERT_WITH_TICK = /OPERATOR_ALERT.*2026-01-05T23:00:00\.000Z/;

describe("operator alert after a restore", () => {
  test("tells the operator when the restored database last ticked", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await s.advanceTo("Mon 18:00");
    await s.restart(); // booting on the restored database

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sentTo(owner)).toEqual([
      {
        recipient: owner.id,
        kind: "operator-alert",
        channel: "push",
        payload: { alert: "database-restored", lastTick: "2026-01-05T23:00:00.000Z" },
      },
    ]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));
  });

  test("is still logged when the restored database has no operator account", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sent).toEqual([]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));
  });

  test("says so when the restored database never ticked", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sentTo(owner).map((n) => n.payload)).toEqual([{ alert: "database-restored", lastTick: null }]);
    expect(s.logs).toContainEqual(expect.stringMatching(/OPERATOR_ALERT.*none/));
  });

  test("a failed delivery loses nothing: the alert is delivered on the next tick, even after a restart", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await s.advanceTo("Mon 18:00");
    failOnCall(s.notifier, "deliver", 1);

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sent).toEqual([]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));

    await s.restart();
    await s.advanceTo("Mon 18:01");

    expect(s.notifier.sentTo(owner).map((n) => n.payload)).toEqual([
      { alert: "database-restored", lastTick: "2026-01-05T23:00:00.000Z" },
    ]);
    // The tick that delivered it is recorded as usual.
    expect(s.core.lastTick()).toEqual(new Date("2026-01-05T23:01:00Z"));
  });

  test("a port failing inside the command leaves nothing half-applied, and a retry raises the alert once", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await s.advanceTo("Mon 18:00");
    failOnCall(s.clock, "now", 1); // the clock read while queueing the alert

    await expect(s.core.raiseRestoreAlert()).rejects.toThrow("injected failure");
    await s.advanceTo("Mon 18:01");

    expect(s.notifier.sent).toEqual([]);

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sentTo(owner).map((n) => n.payload)).toEqual([
      { alert: "database-restored", lastTick: "2026-01-05T23:01:00.000Z" },
    ]);
  });
});
