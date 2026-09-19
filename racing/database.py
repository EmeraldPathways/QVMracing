import sqlite3
from datetime import datetime, timezone


class RacingDatabase:
    def __init__(self, path: str = "qvm_racing.sqlite3"):
        self.connection = sqlite3.connect(path)
        self.connection.row_factory = sqlite3.Row
        self.initialize()

    def initialize(self):
        self.connection.executescript("""
        CREATE TABLE IF NOT EXISTS racing_races (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          provider_race_id TEXT NOT NULL,
          venue TEXT NOT NULL,
          scheduled_off_at TEXT NOT NULL,
          status TEXT NOT NULL,
          UNIQUE(provider, provider_race_id)
        );
        CREATE TABLE IF NOT EXISTS racing_worker_heartbeats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cycle_id TEXT NOT NULL,
          status TEXT NOT NULL,
          last_started_at TEXT NOT NULL,
          last_finished_at TEXT NOT NULL,
          last_attempted_sync_at TEXT,
          last_successful_sync_at TEXT,
          last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS racing_sync_cycles (
          cycle_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        );
        """)
        self.connection.commit()

    def upsert_race(self, race: dict):
        self.connection.execute("""INSERT INTO racing_races(provider, provider_race_id, venue, scheduled_off_at, status)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, provider_race_id) DO UPDATE SET status=excluded.status""",
          (race["provider"], race["providerRaceId"], race["venue"], race["scheduledOffAt"], race["status"]))
        self.connection.commit()

    def insert_cycle(self, cycle_id: str):
        try:
            self.connection.execute("INSERT INTO racing_sync_cycles(cycle_id, created_at) VALUES (?, ?)", (cycle_id, datetime.now(timezone.utc).isoformat()))
            self.connection.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("cycle already processed") from exc

    def save_heartbeat(self, heartbeat: dict):
        self.connection.execute("""INSERT INTO racing_worker_heartbeats(cycle_id,status,last_started_at,last_finished_at,last_attempted_sync_at,last_successful_sync_at,last_error)
          VALUES (:cycleId,:status,:lastStartedAt,:lastFinishedAt,:lastAttemptedSyncAt,:lastSuccessfulSyncAt,:lastError)""", heartbeat)
        self.connection.commit()

    def latest_heartbeat(self):
        row = self.connection.execute("SELECT * FROM racing_worker_heartbeats ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        return {
            "cycleId": row["cycle_id"], "status": row["status"], "lastStartedAt": row["last_started_at"],
            "lastFinishedAt": row["last_finished_at"], "lastAttemptedSyncAt": row["last_attempted_sync_at"],
            "lastSuccessfulSyncAt": row["last_successful_sync_at"], "lastError": row["last_error"],
        }

    def count(self, table: str) -> int:
        if table not in {"racing_races", "racing_worker_heartbeats", "racing_sync_cycles"}:
            raise ValueError("unknown racing table")
        return self.connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
