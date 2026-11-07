"""Postgres storage (Neon) with the same interface as store.Store, for the hosted agent.

Selected by store.open_store() when DATABASE_URL is a postgres:// URL; local runs keep SQLite.
Bodies are stored as TEXT (the exact JSON string), so a stored decision reads back identical and
Replay still compares equal. seq replaces SQLite's rowid for insertion order; an upsert takes a new
seq, like SQLite's INSERT OR REPLACE.
"""

import json
import threading

import psycopg

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL, seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS positions (
    position_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, body TEXT NOT NULL, seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS executions (
    tx_hash TEXT PRIMARY KEY, decision_id TEXT NOT NULL, body TEXT NOT NULL, seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS profiles (
    wallet TEXT PRIMARY KEY, profile TEXT NOT NULL, set_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'EIP-191 signature', seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS settlements (
    decision_id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS assistant_contexts (
    context_id TEXT PRIMARY KEY, body TEXT NOT NULL, seq BIGSERIAL);
CREATE TABLE IF NOT EXISTS assistant_log (
    request_id TEXT PRIMARY KEY, wallet TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, seq BIGSERIAL);
CREATE INDEX IF NOT EXISTS assistant_log_wallet ON assistant_log (wallet, created_at);
CREATE INDEX IF NOT EXISTS decisions_created ON decisions (created_at);
CREATE INDEX IF NOT EXISTS executions_decision ON executions (decision_id);
CREATE INDEX IF NOT EXISTS positions_status ON positions (status);
"""


class PgStore:
    def __init__(self, url: str):
        self._url = url
        self._lock = threading.Lock()
        self._db = None
        with self._lock:
            self._run(lambda c: c.execute(_SCHEMA))

    def _connect(self):
        # prepare_threshold=None: no server-side prepared statements, which Neon's pooled endpoint
        # (PgBouncer, transaction mode) does not support.
        self._db = psycopg.connect(self._url, autocommit=True, connect_timeout=15, prepare_threshold=None)

    def _run(self, fn):
        """Call fn(conn) under the lock; reconnect once if Neon dropped the connection (idle suspend)."""
        for attempt in (0, 1):
            try:
                if self._db is None or self._db.closed:
                    self._connect()
                return fn(self._db)
            except psycopg.OperationalError:
                self._db = None
                if attempt:
                    raise

    def _write(self, sql: str, args: tuple) -> None:
        with self._lock:
            self._run(lambda c: c.execute(sql, args))

    def _read(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            return self._run(lambda c: [json.loads(r[0]) for r in c.execute(sql, args).fetchall()])

    def save_decision(self, d: dict) -> None:
        self._write("INSERT INTO decisions (decision_id, created_at, body) VALUES (%s, %s, %s) "
                    "ON CONFLICT (decision_id) DO UPDATE SET created_at = EXCLUDED.created_at, body = EXCLUDED.body, seq = DEFAULT",
                    (d["decision_id"], d["created_at"], json.dumps(d)))

    def get_decision(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM decisions WHERE decision_id = %s", (decision_id,))
        return rows[0] if rows else None

    def list_decisions(self, limit: int = 50) -> list[dict]:
        return self._read("SELECT body FROM decisions ORDER BY created_at DESC, seq DESC LIMIT %s", (limit,))

    def save_position(self, p: dict) -> None:
        self._write("INSERT INTO positions (position_id, decision_id, status, body) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (position_id) DO UPDATE SET decision_id = EXCLUDED.decision_id, status = EXCLUDED.status, "
                    "body = EXCLUDED.body, seq = DEFAULT",
                    (p["position_id"], p["decision_id"], p["status"], json.dumps(p)))

    def position_for_decision(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM positions WHERE decision_id = %s", (decision_id,))
        return rows[0] if rows else None

    def open_positions(self) -> list[dict]:
        return self._read("SELECT body FROM positions WHERE status = 'open' ORDER BY seq")

    def list_executions(self, limit: int = 100) -> list[dict]:
        return self._read("SELECT body FROM executions ORDER BY seq DESC LIMIT %s", (limit,))

    def executions_for_decision(self, decision_id: str) -> list[dict]:
        return self._read("SELECT body FROM executions WHERE decision_id = %s ORDER BY seq", (decision_id,))

    def save_execution(self, e: dict) -> None:
        self._write("INSERT INTO executions (tx_hash, decision_id, body) VALUES (%s, %s, %s) "
                    "ON CONFLICT (tx_hash) DO UPDATE SET decision_id = EXCLUDED.decision_id, body = EXCLUDED.body, seq = DEFAULT",
                    (e["tx_hash"], e["decision_id"], json.dumps(e)))

    def set_profile(self, wallet: str, profile: str, set_at: str, source: str = "EIP-191 signature") -> None:
        """source says how it was set: the wallet's signature, or the local demo default (make demo-freeze)."""
        self._write("INSERT INTO profiles (wallet, profile, set_at, source) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (wallet) DO UPDATE SET profile = EXCLUDED.profile, set_at = EXCLUDED.set_at, "
                    "source = EXCLUDED.source, seq = DEFAULT",
                    (wallet.lower(), profile, set_at, source))

    def get_profile(self, wallet: str) -> dict | None:
        with self._lock:
            row = self._run(lambda c: c.execute("SELECT wallet, profile, set_at, source FROM profiles WHERE wallet = %s",
                                                (wallet.lower(),)).fetchone())
        return None if row is None else {"wallet": row[0], "profile": row[1], "set_at": row[2], "source": row[3]}

    def save_settlement(self, s: dict) -> None:
        self._write("INSERT INTO settlements (decision_id, status, body) VALUES (%s, %s, %s) "
                    "ON CONFLICT (decision_id) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body, seq = DEFAULT",
                    (s["decision_id"], s["status"], json.dumps(s)))

    def get_settlement(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM settlements WHERE decision_id = %s", (decision_id,))
        return rows[0] if rows else None

    def list_settlements(self) -> list[dict]:
        return self._read("SELECT body FROM settlements ORDER BY seq")

    def save_assistant(self, entry: dict, context: dict) -> None:
        """An answer or brief with the exact context it was given (replayable by context_snapshot_id)."""
        def both(c):
            c.execute("INSERT INTO assistant_contexts (context_id, body) VALUES (%s, %s) ON CONFLICT (context_id) DO NOTHING",
                      (entry["context_snapshot_id"], json.dumps(context)))
            c.execute("INSERT INTO assistant_log (request_id, wallet, created_at, body) VALUES (%s, %s, %s, %s) "
                      "ON CONFLICT (request_id) DO UPDATE SET wallet = EXCLUDED.wallet, created_at = EXCLUDED.created_at, "
                      "body = EXCLUDED.body, seq = DEFAULT",
                      (entry["request_id"], entry["wallet"].lower(), entry["created_at"], json.dumps(entry)))
        with self._lock:
            self._run(both)

    def assistant_log(self, wallet: str, limit: int = 50) -> list[dict]:
        return self._read("SELECT body FROM assistant_log WHERE wallet = %s ORDER BY created_at DESC LIMIT %s", (wallet.lower(), limit))

    def assistant_context(self, context_id: str) -> dict | None:
        rows = self._read("SELECT body FROM assistant_contexts WHERE context_id = %s", (context_id,))
        return rows[0] if rows else None

    def assistant_contexts_for(self, wallet: str) -> list[dict]:
        """Contexts this wallet's answers and briefs were built from, oldest first."""
        w = wallet.lower()
        return sorted((c for c in self._read("SELECT body FROM assistant_contexts") if c.get("wallet") == w),
                      key=lambda c: c.get("as_of", ""))
