/**
 * Types of the private operator-console API (/api/operator/*), shared by the
 * Worker (server/operator) and the console SPA (src/operator). Not part of
 * the public API contract (shared/api.ts, openapi.json).
 */

export const OPERATOR_CSRF_HEADER = 'x-csrf-token';

export interface OperatorStatusResponse {
  /** bootstrap = first-run wizard pending; ready = AuthKit sign-in. */
  phase: 'bootstrap' | 'ready';
  /** Encrypted settings cannot be decrypted (root secret changed / env key missing). Sign-in needs recovery first. */
  encryptionLocked: boolean;
}

export interface OperatorIdentity {
  id: string;
  email: string;
}

export interface SessionResponse {
  kind: 'setup' | 'full';
  csrfToken: string;
  expiresAt: number;
  operator: OperatorIdentity | null;
}

export type SetupStep = 'encryption' | 'encryption_confirm' | 'workos' | 'identity';

export interface SetupStateResponse {
  step: SetupStep;
  encryption: { initialized: boolean; confirmed: boolean; source: 'generated' | 'passphrase' | null };
  workos: { configured: boolean; clientId: string | null; apiKeyLast4: string | null; redirectUri: string };
  /** Dev builds only: the server talks to a local WorkOS emulator (`workos dev`). */
  workosEmulator: string | null;
}

export interface RecoveryKeyResponse {
  /** Shown once; never retrievable again. */
  recoveryKey: string;
  pending?: boolean;
}

export interface StatPair {
  total: number;
  recent: number;
}

export interface LatencyStats {
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface SeriesPoint {
  t: number;
  count: number;
  errors: number;
  p95Ms: number | null;
}

export interface OverviewResponse {
  generatedAt: number;
  workspaces: StatPair & { active7d: number; suspended: number };
  invoices: StatPair & { byCreator: { user: StatPair; agent: StatPair } };
  /** Saved clients (counts only; never names or contact data). */
  clients: StatPair;
  agents: { active: number; revoked: number; pendingRegistrations: number };
  api: { last24h: LatencyStats; last7d: LatencyStats };
  requestsHourly: SeriesPoint[];
  workspacesDaily: { day: string; n: number }[];
  invoicesDaily: { day: string; n: number }[];
}

export interface MetricRow {
  metric: string;
  service: string;
  group: string;
  name: string;
  count: number;
  errors: number;
  clientErrors: number;
  authFailures: number;
  rateLimited: number;
  maintenance: number;
  errorRate: number;
  avgMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface TelemetryResponse {
  range: '1h' | '24h' | '7d';
  generatedAt: number;
  /** `errors` excludes deliberate maintenance-mode 503s, counted in `maintenance`. */
  totals: LatencyStats & { authFailures: number; rateLimited: number; clientErrors: number; maintenance: number };
  groups: (LatencyStats & { group: string; service: string })[];
  metrics: MetricRow[];
  series: SeriesPoint[];
  registrationFunnel: { registered: number; approved: number; redeemed: number; denied: number; expired: number; pending: number };
  recentErrors: { at: number; metric: string; status: number; code: string | null; ray: string | null }[];
  d1: { ok: boolean; latencyMs: number | null; sizeBytes: number | null; migration: string | null; error?: string };
  notes: string[];
}

export interface WorkspaceItem {
  id: string;
  createdAt: string;
  lastActivityAt: number | null;
  invoiceCount: number;
  agentCount: number;
  clientCount: number;
  suspended: boolean;
  suspendedAt: number | null;
  suspensionReason: string | null;
}

export interface WorkspacesResponse {
  workspaces: WorkspaceItem[];
  next: string | null;
}

export interface AgentItem {
  id: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentsResponse {
  agents: AgentItem[];
  next: string | null;
}

export interface SettingItem {
  key: string;
  group: string;
  label: string;
  description: string;
  type: 'string' | 'boolean' | 'integer' | 'url' | 'enum' | 'secret';
  secret: boolean;
  options?: string[];
  min?: number;
  max?: number;
  value?: unknown;
  defaultValue?: unknown;
  source: 'database' | 'environment' | 'default';
  isSet?: boolean;
  last4?: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface SettingsResponse {
  settings: SettingItem[];
  configVersion: number;
  propagationSeconds: number;
  encryptionLocked: boolean;
}

export interface DeploymentRun {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  headSha: string | null;
  headBranch: string | null;
  event: string | null;
  title: string | null;
  actor: string | null;
}

export interface DeploymentsResponse {
  configured: boolean;
  missing: string[];
  repository: string | null;
  workflow: string | null;
  ref: string | null;
  runs: DeploymentRun[];
  runsError: string | null;
  version: { id: string | null; tag: string | null; timestamp: string | null };
  build: { sha: string | null; time: string | null };
  configVersion: number;
  propagationSeconds: number;
}

export interface AuditItem {
  id: number;
  at: number;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuditResponse {
  entries: AuditItem[];
  next: string | null;
}

export interface OperatorItem {
  id: string;
  email: string;
  workosUserId: string | null;
  addedAt: number;
  addedBy: string | null;
  lastSignInAt: number | null;
  pending: boolean;
}

export interface SessionItem {
  id: string;
  kind: 'setup' | 'full';
  email: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface EncryptionStatusResponse {
  initialized: boolean;
  confirmed: boolean;
  mode: 'wrapped' | 'env' | null;
  state: 'uninitialized' | 'unlocked' | 'locked';
  problem: 'root_secret_changed' | 'env_key_missing' | 'env_key_mismatch' | 'corrupt' | null;
  envKeyPresent: boolean;
  envKeyMatches: boolean;
  pendingRewrap: boolean;
  pendingMasterRotation: boolean;
  masterKeyVersion: number;
  masterKeySource: 'generated' | 'passphrase' | null;
  masterKeyCreatedAt: number | null;
  dekVersion: number;
  dekRotatedAt: number | null;
  kdf: { algorithm: 'PBKDF2-SHA-256'; iterations: number } | null;
  cipher: 'AES-256-GCM';
}

export interface SecurityResponse {
  operators: OperatorItem[];
  sessions: SessionItem[];
  encryption: EncryptionStatusResponse;
}
