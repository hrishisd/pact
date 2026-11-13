import { describe, expect, test } from "vitest";
import { failOnCall } from "./testing/fakes.ts";
import { scenario } from "./testing/scenario.ts";

const OPERATOR_ALERT_WITH_TICK = /OPERATOR_ALERT.*2026-01-05T23:00:00\.000Z/;
const RESTORE_EMAIL = {
  to: "owner@example.test",
  subject: "Pact operator alert: database restored from backup",
  text: "database restored from backup; last scheduler tick before the restore: 2026-01-05T23:00:00.000Z\n",
};

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
        payload: {
          alert: "database-restored",
          lastTick: "2026-01-05T23:00:00.000Z",
          title: "Operator alert",
          body: "Database restored from backup. Last tick: 2026-01-05T23:00:00.000Z",
          url: "/",
        },
      },
    ]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));
    expect(s.mailer.sent).toEqual([RESTORE_EMAIL]);
  });

  test("is still logged and emailed when the restored database has no operator account", async () => {
    const s = scenario();
    await s.advanceTo("Mon 18:00");

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sent).toEqual([]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));
    expect(s.mailer.sent).toEqual([RESTORE_EMAIL]);
  });

  test("a failed email is logged, and the log line and the push still go", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");
    await s.advanceTo("Mon 18:00");
    failOnCall(s.mailer, "send", 1, new Error("421 try again later"));

    await s.core.raiseRestoreAlert();

    expect(s.mailer.sent).toEqual([]);
    expect(s.logs).toContainEqual(expect.stringMatching(OPERATOR_ALERT_WITH_TICK));
    expect(s.logs).toContainEqual(
      'operator alert email to owner@example.test failed, not retried: "database restored from backup": Error: 421 try again later',
    );
    expect(s.notifier.kindsSentTo(owner)).toEqual(["operator-alert"]);
  });

  test("says so when the restored database never ticked", async () => {
    const s = scenario();
    const owner = await s.signIn("owner");

    await s.core.raiseRestoreAlert();

    expect(s.notifier.sentTo(owner).map((n) => n.payload)).toEqual([
      {
        alert: "database-restored",
        lastTick: null,
        title: "Operator alert",
        body: "Database restored from backup. Last tick: none",
        url: "/",
      },
    ]);
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
      {
        alert: "database-restored",
        lastTick: "2026-01-05T23:00:00.000Z",
        title: "Operator alert",
        body: "Database restored from backup. Last tick: 2026-01-05T23:00:00.000Z",
        url: "/",
      },
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
      {
        alert: "database-restored",
        lastTick: "2026-01-05T23:01:00.000Z",
        title: "Operator alert",
        body: "Database restored from backup. Last tick: 2026-01-05T23:01:00.000Z",
        url: "/",
      },
    ]);
  });
});
