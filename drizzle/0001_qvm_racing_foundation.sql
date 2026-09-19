CREATE TABLE IF NOT EXISTS racing_paper_positions (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  runner TEXT NOT NULL,
  venue TEXT NOT NULL,
  odds REAL NOT NULL,
  probability REAL NOT NULL,
  stake REAL NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT,
  pnl REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS racing_sync_cycles (
  cycle_id TEXT PRIMARY KEY,
  counts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS racing_races (id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_race_id TEXT NOT NULL UNIQUE, venue TEXT NOT NULL, scheduled_off_at TEXT NOT NULL, status TEXT NOT NULL, source_updated_at TEXT);
CREATE TABLE IF NOT EXISTS racing_runners (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, provider_runner_id TEXT NOT NULL, horse_name TEXT NOT NULL, declaration_status TEXT NOT NULL, UNIQUE(race_id, provider_runner_id));
CREATE TABLE IF NOT EXISTS racing_runner_form (id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, event_date TEXT, available_at TEXT NOT NULL, speed_figure REAL);
CREATE TABLE IF NOT EXISTS racing_market_quotes (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, runner_id TEXT NOT NULL, provider TEXT NOT NULL, market_type TEXT NOT NULL, captured_at TEXT NOT NULL, source_updated_at TEXT, back_odds REAL, lay_odds REAL, market_status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS racing_predictions (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, runner_id TEXT NOT NULL, model_version TEXT NOT NULL, probability REAL NOT NULL, fair_odds REAL NOT NULL, calculated_at TEXT NOT NULL, UNIQUE(race_id, runner_id, model_version));
CREATE TABLE IF NOT EXISTS racing_data_snapshots (id TEXT PRIMARY KEY, provider TEXT NOT NULL, endpoint TEXT NOT NULL, content_hash TEXT NOT NULL, captured_at TEXT NOT NULL, available_at TEXT, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS racing_source_health (id TEXT PRIMARY KEY, provider TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL, message TEXT);
CREATE TABLE IF NOT EXISTS racing_model_runs (id TEXT PRIMARY KEY, model_version TEXT NOT NULL, training_cutoff TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS racing_agent_runs (id TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS racing_worker_heartbeats (id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, status TEXT NOT NULL, last_started_at TEXT NOT NULL, last_finished_at TEXT NOT NULL, last_attempted_sync_at TEXT NOT NULL, last_successful_sync_at TEXT, last_error TEXT);
CREATE TABLE IF NOT EXISTS racing_decision_replays (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, input_snapshot_id TEXT NOT NULL, created_at TEXT NOT NULL);
