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
];
