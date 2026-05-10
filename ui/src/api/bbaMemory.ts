export type BbaMemoryRunOutcome = "success" | "failure" | "partial" | null;

export interface BbaMemoryRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  source: string;
  trigger: string | null;
  outcome: BbaMemoryRunOutcome;
  failureClass: string | null;
  durationMs: number | null;
  meta: Record<string, unknown> | null;
}

export interface RecentRunsResponse {
  companyId: string;
  limit: number;
  total: number;
  runs: BbaMemoryRun[];
}

export interface BbaStatsSummary {
  companyId: string;
  windowDays: number;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  successRatePct: number | null;
  topFailureClasses: Array<{ class: string; count: number }>;
}

export interface ExecuteBetRequest {
  issueId?: string | null;
  loginUsername: { secretId?: string | null; secretName?: string | null };
  loginPassword: { secretId?: string | null; secretName?: string | null };
  bookmakerConfig: Record<string, unknown>;
  bet: {
    matchLabel: string;
    market: string;
    selection: string;
    odds: number;
    stake: number;
    eventUrl?: string | null;
    currency?: string | null;
  };
  bets?: Array<ExecuteBetRequest["bet"]>;
  riskControls: {
    maxStakePerBet: number;
    maxTotalStakePerSession: number;
    requireFinalConfirmation?: boolean;
    dailyStopLossPct?: number;
    sessionStopLossPct?: number;
  };
  execution?: Record<string, unknown>;
  currentBalance?: number | null;
  sessionStartedAt?: string | null;
}

export interface ExecuteBetResponse {
  status:
    | "awaiting_confirmation"
    | "completed"
    | "submitted_unconfirmed"
    | "failed"
    | "blocked_by_risk"
    | "session_expired"
    | "partial"
    | string;
  failureReason?: string | null;
  placedBetId?: string | null;
  sessionId?: string;
  artifactDir?: string;
  logPath?: string;
}

export type ExecuteBetResult = ExecuteBetResponse & { wasReplay: boolean };

export async function fetchBbaStats(
  companyId: string,
  options: { windowDays?: number; signal?: AbortSignal } = {},
): Promise<BbaStatsSummary> {
  const params = new URLSearchParams();
  if (options.windowDays) params.set("windowDays", String(options.windowDays));
  const qs = params.toString();
  const url = `/api/companies/${encodeURIComponent(companyId)}/bba-memory/stats-summary${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { credentials: "include", signal: options.signal });
  if (!res.ok) throw new Error(`fetchBbaStats failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<BbaStatsSummary>;
}

export async function fetchRecentBbaRuns(
  companyId: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<RecentRunsResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const url = `/api/companies/${encodeURIComponent(companyId)}/bba-memory/recent-runs${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { credentials: "include", signal: options.signal });
  if (!res.ok) {
    throw new Error(`fetchRecentBbaRuns failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<RecentRunsResponse>;
}

export async function executeBbaBet(
  companyId: string,
  payload: ExecuteBetRequest,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<ExecuteBetResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const res = await fetch(
    `/api/companies/${encodeURIComponent(companyId)}/betting-browser-automation/execute`,
    {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    },
  );

  if (!res.ok) throw new Error(`executeBbaBet failed: ${res.status} ${res.statusText}`);
  const wasReplay = res.headers.get("X-Idempotent-Replay") === "true";
  const body = await res.json() as ExecuteBetResponse;
  return { ...body, wasReplay };
}
