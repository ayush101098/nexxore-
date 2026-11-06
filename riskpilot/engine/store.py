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
"""


class Store:
    def __init__(self, path: str = "riskpilot.db"):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)

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
