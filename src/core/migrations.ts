// Schema migrations, applied in order on open. The database's `user_version`
// records how many have run. Never edit a migration that has shipped; append
// a new one. Opening checks this: db.ts records a fingerprint of each
// migration's text when it applies it, and refuses to open a database whose
// applied migrations no longer match (see docs/agents/local-dev.md to reset a
// dev database). Times are stored as ISO 8601 UTC strings.

export const migrations: readonly string[] = [
  // 1: walking skeleton
  `
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    -- lower-cased email: one account per Google address, matched case-insensitively
    email_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- IANA zone; NULL until the user confirms one
    timezone TEXT,
    is_operator INTEGER NOT NULL DEFAULT 0 CHECK (is_operator IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX account_one_operator ON account (is_operator) WHERE is_operator = 1;

  CREATE TABLE scheduler_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_tick_at TEXT NOT NULL
  );

  -- Notifications a command produced, written in the command's transaction
  -- and delivered after it commits. A failed delivery stays here for the next
  -- attempt, so a notification may be sent twice but is never lost.
  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_account_id TEXT NOT NULL REFERENCES account (id),
    kind TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    delivered_at TEXT
  );
  CREATE INDEX outbox_undelivered ON outbox (id) WHERE delivered_at IS NULL;
  `,
  // 2: invites, friends and recipients
  `
  -- A single-use invite link. The first new account made by signing in with
  -- a usable token claims it, and only that account may then accept it (an
  -- account that already existed may accept an unclaimed one). Accepting
  -- makes the two accounts friends and uses the invite up.
  CREATE TABLE invite (
    token TEXT PRIMARY KEY,
    inviter_account_id TEXT NOT NULL REFERENCES account (id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_by_account_id TEXT REFERENCES account (id),
    used_at TEXT,
    used_by_account_id TEXT REFERENCES account (id),
    CHECK ((used_at IS NULL) = (used_by_account_id IS NULL))
  );

  -- One row per pair of friends, the smaller account id first.
  CREATE TABLE friendship (
    account_a_id TEXT NOT NULL REFERENCES account (id),
    account_b_id TEXT NOT NULL REFERENCES account (id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (account_a_id, account_b_id),
    CHECK (account_a_id < account_b_id)
  );
  CREATE INDEX friendship_b ON friendship (account_b_id);

  -- An owner's saved recipients. A recipient is just a name (a person or an
  -- organization); it isn't an account. Names may repeat.
  CREATE TABLE recipient (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX recipient_owner ON recipient (owner_account_id);
  `,
  // 3: pacts
  `
  -- A pact is Active from the moment it's created. Its evidence kind never
  -- changes. first_occurrence is a "YYYY-MM-DD" day in the owner's timezone,
  -- worked out once at creation.
  CREATE TABLE pact (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('camera', 'oura')),
    schedule TEXT NOT NULL, -- JSON, the shared Schedule type
    penalty_cents INTEGER NOT NULL CHECK (penalty_cents > 0),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    stage TEXT NOT NULL CHECK (stage IN ('active', 'ended')),
    first_occurrence TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX pact_owner ON pact (owner_account_id);

  CREATE TABLE pact_reviewer (
    pact_id TEXT NOT NULL REFERENCES pact (id),
    reviewer_account_id TEXT NOT NULL REFERENCES account (id),
    PRIMARY KEY (pact_id, reviewer_account_id)
  );
  CREATE INDEX pact_reviewer_account ON pact_reviewer (reviewer_account_id);
  `,
  // 4: evidence, judging and penalties
  `
  -- An occurrence gets a row once something happens to it: evidence arrives,
  -- or it's judged. Its timing follows from the pact (occurrences.ts); due_at
  -- is recorded with the row. outcome is NULL while it's not judged yet.
  CREATE TABLE occurrence (
    pact_id TEXT NOT NULL REFERENCES pact (id),
    date TEXT NOT NULL, -- "YYYY-MM-DD" in the owner's timezone
    due_at TEXT NOT NULL,
    outcome TEXT CHECK (outcome IN ('kept', 'missed', 'excused')),
    judged_at TEXT,
    PRIMARY KEY (pact_id, date),
    CHECK ((outcome IS NULL) = (judged_at IS NULL))
  );
  CREATE INDEX occurrence_not_judged ON occurrence (due_at) WHERE outcome IS NULL;

  -- Judging's cursor: every occurrence of the pact on or before this date has
  -- been judged or found to be waiting on a decision. NULL until the first.
  ALTER TABLE pact ADD COLUMN judged_through TEXT;

  -- Photo evidence for one occurrence, submitted by the pact's owner at the
  -- time the server received its last photo. decision is NULL while it waits
  -- for a reviewer; the first decision is final. After a rejection the owner
  -- may submit again while the occurrence is open, so an occurrence can have
  -- several rejected rows but at most one waiting and one approved.
  CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    pact_id TEXT NOT NULL,
    occurrence_date TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('approved', 'rejected')),
    decided_by_account_id TEXT REFERENCES account (id),
    decided_at TEXT,
    reject_reason TEXT,
    FOREIGN KEY (pact_id, occurrence_date) REFERENCES occurrence (pact_id, date),
    CHECK ((decision IS NULL) = (decided_at IS NULL)),
    CHECK ((decision IS NULL) = (decided_by_account_id IS NULL)),
    CHECK ((decision IS 'rejected') = (reject_reason IS NOT NULL))
  );
  CREATE INDEX evidence_occurrence ON evidence (pact_id, occurrence_date);
  CREATE UNIQUE INDEX evidence_one_waiting ON evidence (pact_id, occurrence_date) WHERE decision IS NULL;
  CREATE UNIQUE INDEX evidence_one_approved ON evidence (pact_id, occurrence_date) WHERE decision = 'approved';

  -- The photos of one piece of evidence, in the order taken. photo_id is the
  -- PhotoStore's; received_at is when the server received it.
  CREATE TABLE evidence_photo (
    evidence_id TEXT NOT NULL REFERENCES evidence (id),
    position INTEGER NOT NULL CHECK (position >= 0),
    photo_id TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    PRIMARY KEY (evidence_id, position)
  );

  -- What a Missed occurrence adds to the owner's ledger for the recipient the
  -- pact named at the time: the pact's penalty then. One per occurrence.
  CREATE TABLE penalty (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    pact_id TEXT NOT NULL,
    occurrence_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    added_at TEXT NOT NULL,
    FOREIGN KEY (pact_id, occurrence_date) REFERENCES occurrence (pact_id, date),
    UNIQUE (pact_id, occurrence_date)
  );
  CREATE INDEX penalty_ledger ON penalty (owner_account_id, recipient_id);
  `,
  // 5: no judging of days before evidence could be submitted
  `
  -- Pacts made before migration 4 have no judging cursor, so the first tick
  -- would judge every scheduled day since their first occurrence Missed, with
  -- a penalty each, though no evidence could be submitted then. Start their
  -- judging after today's date in UTC instead. A migration has no Clock, so
  -- this reads SQLite's; it runs once, as the release with judging boots.
  -- It errs lenient: in every timezone, an occurrence dated after today in
  -- UTC is due after now (UTC+14 is under a day ahead), so nothing due before
  -- this runs is judged, though today's occurrence may not be judged either.
  -- A cursor before a pact's first occurrence is harmless: judging starts
  -- from the first occurrence then. On a fresh database there are no pacts.
  UPDATE pact SET judged_through = date('now') WHERE judged_through IS NULL;
  `,
  // 6: occurrences don't record a due time
  `
  -- An occurrence's due time follows from the pact and the owner's timezone
  -- now (occurrences.ts). The one recorded with the row went stale when the
  -- owner changed timezone, and nothing reads it.
  DROP INDEX occurrence_not_judged;
  ALTER TABLE occurrence DROP COLUMN due_at;
  `,
  // 7: accepting a miss
  `
  -- When the owner accepted a Missed occurrence (Take the L), or NULL. It
  -- only takes the occurrence off Today (its rejected-evidence alert, or its
  -- Missed card); the ledger doesn't change.
  ALTER TABLE occurrence ADD COLUMN miss_accepted_at TEXT;
  `,
  // 8: payments
  `
  -- The owner's record that they paid a recipient outside the app, with one
  -- screenshot (photo_id is the PhotoStore's). It counts against the ledger
  -- only once a reviewer of any of the owner's pacts with that recipient
  -- approves it. decision is NULL while it waits; the first decision is final.
  CREATE TABLE payment (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT, -- trimmed; NULL when there's none
    photo_id TEXT NOT NULL UNIQUE,
    recorded_at TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('approved', 'rejected')),
    decided_by_account_id TEXT REFERENCES account (id),
    decided_at TEXT,
    reject_reason TEXT,
    CHECK ((decision IS NULL) = (decided_at IS NULL)),
    CHECK ((decision IS NULL) = (decided_by_account_id IS NULL)),
    CHECK ((decision IS 'rejected') = (reject_reason IS NOT NULL))
  );
  CREATE INDEX payment_ledger ON payment (owner_account_id, recipient_id);
  `,
  // 9: push subscriptions and notification settings
  `
  -- One row per device. The browser names a device by its endpoint, so a device
  -- someone else signs in on moves to their account.
  CREATE TABLE push_subscription (
    endpoint TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES account (id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX push_subscription_account ON push_subscription (account_id);

  -- The notification settings an account turned off. Every setting starts on,
  -- so a kind added later is on for everyone.
  CREATE TABLE notification_setting_off (
    account_id TEXT NOT NULL REFERENCES account (id),
    setting TEXT NOT NULL,
    PRIMARY KEY (account_id, setting)
  );
  `,
  // 10: retrying one device
  `
  -- The endpoints a notification has reached, JSON. A retry goes only to the
  -- others, so one failing device doesn't repeat it on the rest.
  ALTER TABLE outbox ADD COLUMN sent_to TEXT NOT NULL DEFAULT '[]';
  `,
  // 11: the edit window
  `
  -- When the scheduler told the pact's reviewers about it, in the transaction
  -- that queued the notifications, so each hears once even across a restart.
  -- NULL until its edit window closes. Pacts from before this have long closed,
  -- and their reviewers already know.
  ALTER TABLE pact ADD COLUMN reviewers_notified_at TEXT;
  UPDATE pact SET reviewers_notified_at = created_at;
  `,
  // 12: excuses
  `
  -- The owner's request to have some occurrences of one pact treated as
  -- Excused. The days it covers are fixed when it's filed (excuse_day).
  -- decision is NULL while it waits; the first decision is final. While it
  -- waits, the penalties of its covered days are held: they don't count
  -- toward owed. rejection_accepted_at is when the owner took the L on its
  -- rejected-excuse alert.
  CREATE TABLE excuse (
    id TEXT PRIMARY KEY,
    pact_id TEXT NOT NULL REFERENCES pact (id),
    reason TEXT NOT NULL,
    filed_at TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('approved', 'rejected')),
    decided_by_account_id TEXT REFERENCES account (id),
    decided_at TEXT,
    reject_reason TEXT,
    rejection_accepted_at TEXT,
    CHECK ((decision IS NULL) = (decided_at IS NULL)),
    CHECK ((decision IS NULL) = (decided_by_account_id IS NULL)),
    CHECK ((decision IS 'rejected') = (reject_reason IS NOT NULL)),
    CHECK (rejection_accepted_at IS NULL OR decision = 'rejected')
  );
  CREATE INDEX excuse_pact ON excuse (pact_id);

  -- The occurrences an excuse covers, by date. Days ahead have no occurrence
  -- row yet. A day is on at most one waiting excuse; the core checks that.
  CREATE TABLE excuse_day (
    excuse_id TEXT NOT NULL REFERENCES excuse (id),
    pact_id TEXT NOT NULL REFERENCES pact (id),
    date TEXT NOT NULL, -- "YYYY-MM-DD" in the owner's timezone
    PRIMARY KEY (excuse_id, date)
  );
  CREATE INDEX excuse_day_occurrence ON excuse_day (pact_id, date);

  -- An excuse's photos, in the order added. photo_id is the PhotoStore's.
  CREATE TABLE excuse_photo (
    excuse_id TEXT NOT NULL REFERENCES excuse (id),
    position INTEGER NOT NULL CHECK (position >= 0),
    photo_id TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    PRIMARY KEY (excuse_id, position)
  );
  `,
  // 13: Oura connections and bedtime pacts
  `
  -- A link between an account and an outside service that supplies evidence.
  -- A row exists only once the owner has connected the service.
  CREATE TABLE connection (
    account_id TEXT NOT NULL REFERENCES account (id),
    service TEXT NOT NULL CHECK (service IN ('oura')),
    status TEXT NOT NULL CHECK (status IN ('connected', 'needs-reconnecting')),
    connected_at TEXT NOT NULL,
    PRIMARY KEY (account_id, service)
  );

  -- Oura Ring pacts only: the in-bed-by time, "HH:MM". NULL for Camera.
  ALTER TABLE pact ADD COLUMN in_bed_by TEXT;

  -- A bedtime night judged from Oura: the bedtime_start of the long_sleep
  -- that decided it, as Oura wrote it (with Oura's UTC offset). NULL otherwise.
  ALTER TABLE occurrence ADD COLUMN bedtime_start TEXT;

  -- Oura's OAuth tokens, encrypted. Only the Oura adapter (oura.ts) reads and
  -- writes this table; the core never does. Refresh tokens are single-use, so
  -- each refresh replaces both.
  CREATE TABLE oura_token (
    account_id TEXT PRIMARY KEY REFERENCES account (id),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 14: weekly bills and overdue reminders
  `
  -- Every Wednesday at 18:00 in the owner's timezone, one bill per recipient
  -- for the owner's owed penalties that can't be excused any more. A bill
  -- never changes once made. It's due at 18:00 seven days later.
  CREATE TABLE bill (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    billed_on TEXT NOT NULL, -- the Wednesday, "YYYY-MM-DD" in the owner's timezone
    created_at TEXT NOT NULL,
    due_at TEXT NOT NULL
  );
  CREATE INDEX bill_ledger ON bill (owner_account_id, recipient_id);

  -- The bill a penalty is on; NULL until a Wednesday bills it.
  ALTER TABLE penalty ADD COLUMN bill_id TEXT REFERENCES bill (id);

  -- How far billing has run for the account: the last instant it checked.
  -- NULL until the first tick after the account was made.
  ALTER TABLE account ADD COLUMN billed_through TEXT;

  -- When an owner Overdue to a recipient was last reminded, and when the
  -- reviewers were last told. Kept after the bill is paid, so a payment
  -- that's later rejected doesn't tell the reviewers again within the week.
  CREATE TABLE overdue_notice (
    owner_account_id TEXT NOT NULL REFERENCES account (id),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    owner_reminded_at TEXT,
    reviewers_told_at TEXT,
    PRIMARY KEY (owner_account_id, recipient_id)
  );
  `,
  // 15: change requests and ending pacts
  `
  -- When an approved change request ended the pact (stage 'ended'); NULL while Active.
  ALTER TABLE pact ADD COLUMN ended_at TEXT;

  -- The terms a pact had before a change took effect. They still apply to its
  -- occurrences dated before \`until\`, the first day not open when the change
  -- took effect; the pact row holds the terms from the latest \`until\` on. So
  -- an open occurrence keeps the old terms, and judging it later (a rejection,
  -- a night Oura reports late) costs what it cost then.
  CREATE TABLE pact_earlier_terms (
    pact_id TEXT NOT NULL REFERENCES pact (id),
    until TEXT NOT NULL, -- "YYYY-MM-DD" in the owner's timezone
    description TEXT NOT NULL,
    schedule TEXT NOT NULL, -- JSON, the shared Schedule type
    in_bed_by TEXT,
    penalty_cents INTEGER NOT NULL CHECK (penalty_cents > 0),
    recipient_id TEXT NOT NULL REFERENCES recipient (id),
    PRIMARY KEY (pact_id, until)
  );

  -- An owner's proposed change that relaxes a pact, or ends it, waiting for a
  -- reviewer. before_terms and after_terms are the changeable terms (JSON) when
  -- it was sent, after what applied at once (the name, added reviewers);
  -- after_terms is NULL when it ends the pact. decision is NULL while it
  -- waits; the first decision is final. The owner can withdraw it while it
  -- waits. A pact has at most one waiting.
  CREATE TABLE change_request (
    id TEXT PRIMARY KEY,
    pact_id TEXT NOT NULL REFERENCES pact (id),
    ends_pact INTEGER NOT NULL CHECK (ends_pact IN (0, 1)),
    before_terms TEXT NOT NULL,
    after_terms TEXT,
    note TEXT,
    requested_at TEXT NOT NULL,
    decision TEXT CHECK (decision IN ('approved', 'rejected')),
    decided_by_account_id TEXT REFERENCES account (id),
    decided_at TEXT,
    reject_reason TEXT,
    withdrawn_at TEXT,
    CHECK ((ends_pact = 1) = (after_terms IS NULL)),
    CHECK ((decision IS NULL) = (decided_at IS NULL)),
    CHECK ((decision IS NULL) = (decided_by_account_id IS NULL)),
    CHECK ((decision IS 'rejected') = (reject_reason IS NOT NULL)),
    CHECK (decision IS NULL OR withdrawn_at IS NULL)
  );
  CREATE UNIQUE INDEX change_request_one_waiting ON change_request (pact_id)
    WHERE decision IS NULL AND withdrawn_at IS NULL;
  `,
  // 16: reviewer questions
  `
  -- A review item's thread: a reviewer's question, or the owner's reply, text
  -- only. item_id is the evidence, excuse, payment or change request it's
  -- about; their ids are UUIDs, so they never collide. The item is waiting on
  -- the owner's reply while its latest comment (the highest id) is a
  -- reviewer's.
  CREATE TABLE comment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    author_account_id TEXT NOT NULL REFERENCES account (id),
    from_owner INTEGER NOT NULL CHECK (from_owner IN (0, 1)),
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );
  CREATE INDEX comment_item ON comment (item_id, id);
  `,
  // 17: due-by time, start date and end date
  `
  -- Camera only: "HH:MM", the time each day's evidence is due by instead of
  -- midnight. It's a term an occurrence keeps from when it opened, so earlier
  -- terms carry it too.
  ALTER TABLE pact ADD COLUMN due_by TEXT;
  ALTER TABLE pact_earlier_terms ADD COLUMN due_by TEXT;
  -- "YYYY-MM-DD" in the owner's timezone. The start date only pushes
  -- first_occurrence later; it's kept to show and change. After the end date
  -- the pact has no occurrences, and it's Ended once the last one closes.
  ALTER TABLE pact ADD COLUMN start_date TEXT;
  ALTER TABLE pact ADD COLUMN end_date TEXT;
  `,
  // 18: reminders
  `
  -- The owner's reminders: a JSON array of "HH:MM" in the owner's timezone,
  -- in the order they go off. They aren't terms an occurrence keeps: a change
  -- applies at once, so earlier terms don't carry them.
  ALTER TABLE pact ADD COLUMN reminders TEXT NOT NULL DEFAULT '[]';
  -- How far the scheduler has looked for the pact's reminders, an ISO
  -- instant: each one going off by then was sent or dropped. NULL until the
  -- first tick looks, which starts from its own time.
  ALTER TABLE pact ADD COLUMN reminded_through TEXT;
  `,
  // 19: Weekly count
  `
  -- The day evidence counts for, "YYYY-MM-DD" in the owner's timezone: its
  -- occurrence's date on Fixed days; on Weekly count, the day of the week
  -- (occurrence_date is the week's Monday) it was submitted on. Every insert
  -- sets it. At most one day of evidence counts per calendar day, so a day
  -- has at most one waiting and one approved.
  ALTER TABLE evidence ADD COLUMN day TEXT NOT NULL DEFAULT '';
  UPDATE evidence SET day = occurrence_date;
  DROP INDEX evidence_one_waiting;
  DROP INDEX evidence_one_approved;
  CREATE UNIQUE INDEX evidence_one_waiting ON evidence (pact_id, day) WHERE decision IS NULL;
  CREATE UNIQUE INDEX evidence_one_approved ON evidence (pact_id, day) WHERE decision = 'approved';
  -- Weekly count only: when the owner took the L on the day's rejected
  -- evidence, which clears its alert. On Fixed days a rejection judges the
  -- occurrence, and occurrence.miss_accepted_at records it.
  ALTER TABLE evidence ADD COLUMN rejection_accepted_at TEXT;
  `,
  // 20: no bills for Wednesdays before billing existed
  `
  -- Migration 14 left billed_through NULL, and billing starts a NULL account
  -- from its created_at, so an account made before billing existed would get
  -- a bill for every Wednesday since then on the first tick, already overdue.
  -- Start their billing now instead; their owed penalties go on the next
  -- Wednesday's bill. A migration has no Clock, so this reads SQLite's (as
  -- migration 5 does), in the format the core writes. An account with a bill
  -- has been billed, so only accounts with none are moved. Accounts made
  -- after this keep NULL and are billed from their creation.
  UPDATE account SET billed_through = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE billed_through IS NULL
    AND NOT EXISTS (SELECT 1 FROM bill WHERE bill.owner_account_id = account.id);
  `,
  // 21: reminders sent
  `
  -- Each reminder sent: the pact, the day it was about ("YYYY-MM-DD" in the
  -- owner's timezone) and its time as the pact lists it. reminded_through
  -- is an instant, so after the owner moves their timezone west a reminder
  -- already sent comes round again; this stops it going off twice. Rows for
  -- days well behind the cursor are deleted as it moves on.
  CREATE TABLE reminder_sent (
    pact_id TEXT NOT NULL REFERENCES pact (id),
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    PRIMARY KEY (pact_id, date, time)
  );
  `,
  // 22: the 15:00 push for a bedtime night with no sleep data
  `
  -- Each 15:00 push sent about a bedtime night still not judged: the owner
  -- and the night's date ("YYYY-MM-DD" in their timezone). One per night,
  -- however many of the owner's bedtime pacts wait on it, and never again
  -- after a restart.
  CREATE TABLE no_oura_data_push_sent (
    account_id TEXT NOT NULL REFERENCES account (id),
    date TEXT NOT NULL,
    PRIMARY KEY (account_id, date)
  );
  `,
  // 23: Oura's clock for a traveller's bedtime nights
  `
  -- The bedtime_start of the latest sleep period Oura reported for the
  -- account, as Oura wrote it, with its UTC offset: the clock a bedtime night
  -- with no period yet closes on at 18:00 the next day. Only a timestamp with
  -- an offset is kept. NULL until Oura reports one, and the night then closes
  -- on the account's timezone. It outlives the connection, as the owner's
  -- clock rather than the link's.
  ALTER TABLE account ADD COLUMN oura_latest_bedtime_start TEXT;
  `,
];
