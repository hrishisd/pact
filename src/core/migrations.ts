// Schema migrations, applied in order on open. The database's `user_version`
// records how many have run. Never edit a migration that has shipped; append
// a new one. Times are stored as ISO 8601 UTC strings.

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
];
