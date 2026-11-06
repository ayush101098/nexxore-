"""SQLite storage for decisions, positions and executions. Enough for the demo."""

import json
import sqlite3
import threading

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    decision_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
    position_id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS executions (
    tx_hash TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
    wallet TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    set_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'EIP-191 signature'
);
CREATE TABLE IF NOT EXISTS settlements (
    decision_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_created ON decisions (created_at);
CREATE INDEX IF NOT EXISTS executions_decision ON executions (decision_id);
CREATE INDEX IF NOT EXISTS positions_status ON positions (status);
"""


class Store:
    def __init__(self, path: str = "riskpilot.db"):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            if path != ":memory:":
                self._db.execute("PRAGMA journal_mode=WAL")
                self._db.execute("PRAGMA synchronous=NORMAL")
            self._db.executescript(_SCHEMA)
            if "source" not in {r[1] for r in self._db.execute("PRAGMA table_info(profiles)")}:  # older DBs
                self._db.execute("ALTER TABLE profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'EIP-191 signature'")

    def _write(self, sql: str, args: tuple) -> None:
        with self._lock, self._db:
            self._db.execute(sql, args)

    def _read(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            return [json.loads(row[0]) for row in self._db.execute(sql, args)]

    def save_decision(self, d: dict) -> None:
        self._write(
            "INSERT OR REPLACE INTO decisions VALUES (?, ?, ?)",
            (d["decision_id"], d["created_at"], json.dumps(d)),
        )

    def get_decision(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM decisions WHERE decision_id = ?", (decision_id,))
        return rows[0] if rows else None

    def list_decisions(self, limit: int = 50) -> list[dict]:
        return self._read("SELECT body FROM decisions ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,))

    def save_position(self, p: dict) -> None:
        self._write(
            "INSERT OR REPLACE INTO positions VALUES (?, ?, ?, ?)",
            (p["position_id"], p["decision_id"], p["status"], json.dumps(p)),
        )

    def position_for_decision(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM positions WHERE decision_id = ?", (decision_id,))
        return rows[0] if rows else None

    def open_positions(self) -> list[dict]:
        return self._read("SELECT body FROM positions WHERE status = 'open' ORDER BY rowid")

    def list_executions(self, limit: int = 100) -> list[dict]:
        return self._read("SELECT body FROM executions ORDER BY rowid DESC LIMIT ?", (limit,))

    def executions_for_decision(self, decision_id: str) -> list[dict]:
        return self._read("SELECT body FROM executions WHERE decision_id = ? ORDER BY rowid", (decision_id,))

    def save_execution(self, e: dict) -> None:
        self._write("INSERT OR REPLACE INTO executions VALUES (?, ?, ?)", (e["tx_hash"], e["decision_id"], json.dumps(e)))

    def set_profile(self, wallet: str, profile: str, set_at: str, source: str = "EIP-191 signature") -> None:
        """source says how it was set: the wallet's signature, or the local demo default (make demo-freeze)."""
        with self._lock, self._db:
            self._db.execute("INSERT OR REPLACE INTO profiles VALUES (?, ?, ?, ?)", (wallet.lower(), profile, set_at, source))

    def get_profile(self, wallet: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT wallet, profile, set_at, source FROM profiles WHERE wallet = ?", (wallet.lower(),)).fetchone()
        return None if row is None else {"wallet": row[0], "profile": row[1], "set_at": row[2], "source": row[3]}

    def save_settlement(self, s: dict) -> None:
        self._write("INSERT OR REPLACE INTO settlements VALUES (?, ?, ?)", (s["decision_id"], s["status"], json.dumps(s)))

    def get_settlement(self, decision_id: str) -> dict | None:
        rows = self._read("SELECT body FROM settlements WHERE decision_id = ?", (decision_id,))
        return rows[0] if rows else None

    def list_settlements(self) -> list[dict]:
        return self._read("SELECT body FROM settlements ORDER BY rowid")
