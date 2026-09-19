export type RacingSyncSnapshot = {
  schemaVersion: "qvm-racing-sync.v1";
  cycleId: string;
  generatedAt: string;
  races: RaceRecord[];
  runners: RunnerRecord[];
  quotes: QuoteRecord[];
  predictions: PredictionRecord[];
  paperPositions: PaperPositionRecord[];
  agentRuns: AgentRunRecord[];
  heartbeat: HeartbeatRecord;
};
export type RaceRecord = { provider: string; providerRaceId: string; venue: string; country: string; scheduledOffAt: string; surface: string; discipline: string; distanceMeters: number; going: string; className: string; fieldSize: number; status: string; sourceUpdatedAt?: string };
export type RunnerRecord = { provider: string; raceProviderId: string; providerRunnerId: string; horseName: string; declarationStatus: string; rating?: number; form?: string };
export type QuoteRecord = { provider: string; raceProviderId: string; providerRunnerId: string; marketType: "WIN"; capturedAt: string; sourceUpdatedAt: string | null; marketStatus: string; backOdds?: number; layOdds?: number; lastTradedOdds?: number };
export type PredictionRecord = { provider: string; raceProviderId: string; providerRunnerId: string; modelVersion: string; probability: number; fairOdds: number; calculatedAt: string; featureSnapshotId: string };
export type PaperPositionRecord = { id: string; raceProviderId: string; providerRunnerId: string; stake: number; status: string; gateReasons: string[] };
export type AgentRunRecord = { role: "WORKER" | "MANAGER" | "AUDITOR"; status: string; createdAt: string };
export type HeartbeatRecord = { workerName: string; status: string; lastStartedAt: string; lastFinishedAt: string; lastAttemptedSyncAt: string; lastSuccessfulSyncAt?: string | null; lastError?: string | null };
