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
];
