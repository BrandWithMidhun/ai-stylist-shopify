// In-memory job registry for batch AI tagging, rule application, and
// taxonomy re-matching.
//
// Single Node-process Map. Railway deploys the app as a single web service,
// so one process owns the state. If the process restarts mid-job the job is
// lost — batch tagging is tolerant (user can re-run); the other two are
// pure-DB ops that re-run cheaply.
//
// Phase 1 (PR-A): the "sync" kind moved to a DB-backed model in
// app/lib/catalog/sync-jobs.server.ts so the future Phase 8 dashboard can
// read sync state, the worker (PR-B) can survive restarts, and the
// catch-up cron (PR-D) can enqueue runs durably. The other kinds stay
// here — they're Phase 2 territory.

export type JobKind = "batch_tag" | "rematch_taxonomy" | "apply_rules";

// Only batch_tag carries the 5-minute cooldown (it hits Anthropic).
// rematch_taxonomy and apply_rules are pure DB ops with no upstream
// rate limit; we still dedupe concurrent runs but skip the cooldown.
const COOLDOWN_KINDS: ReadonlySet<JobKind> = new Set(["batch_tag"]);

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type Job = {
  id: string;
  kind: JobKind;
  shopDomain: string;
  status: JobStatus;
  progress: number;
  total: number;
  failed: number;
  error?: string;
  startedAt: Date;
  finishedAt?: Date;
};

const JOBS = new Map<string, Job>();
type ActiveByKind = Partial<Record<JobKind, string>>;
type LastByKind = Partial<Record<JobKind, Date>>;
const ACTIVE_BY_SHOP = new Map<string, ActiveByKind>();
const LAST_COMPLETED_BY_SHOP = new Map<string, LastByKind>();

const RATE_LIMIT_MS = 5 * 60 * 1000; // 1 per shop per 5 minutes
const RETENTION_MS = 60 * 1000; // keep finished jobs readable for 60s

export type RateLimitCheck =
  | { ok: true }
  | { ok: false; reason: "already_running" | "too_soon"; retryAfterSeconds: number };

export function checkRateLimit(
  shopDomain: string,
  kind: JobKind,
): RateLimitCheck {
  const active = ACTIVE_BY_SHOP.get(shopDomain)?.[kind];
  if (active && JOBS.get(active)?.status === "running") {
    return { ok: false, reason: "already_running", retryAfterSeconds: 30 };
  }
  if (COOLDOWN_KINDS.has(kind)) {
    const last = LAST_COMPLETED_BY_SHOP.get(shopDomain)?.[kind];
    if (last) {
      const elapsed = Date.now() - last.getTime();
      if (elapsed < RATE_LIMIT_MS) {
        return {
          ok: false,
          reason: "too_soon",
          retryAfterSeconds: Math.ceil((RATE_LIMIT_MS - elapsed) / 1000),
        };
      }
    }
  }
  return { ok: true };
}

export function startJob(
  shopDomain: string,
  kind: JobKind,
  jobId: string,
): Job {
  const job: Job = {
    id: jobId,
    kind,
    shopDomain,
    status: "running",
    progress: 0,
    total: 0,
    failed: 0,
    startedAt: new Date(),
  };
  JOBS.set(jobId, job);
  const active = ACTIVE_BY_SHOP.get(shopDomain) ?? {};
  active[kind] = jobId;
  ACTIVE_BY_SHOP.set(shopDomain, active);
  return job;
}

export function setJobTotal(jobId: string, total: number): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.total = total;
}

export function incrementJobProgress(
  jobId: string,
  delta = 1,
  failedDelta = 0,
): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.progress += delta;
  job.failed += failedDelta;
}

export function completeJob(jobId: string): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.status = "succeeded";
  job.finishedAt = new Date();
  clearActive(job);
  markCompleted(job);
  scheduleRetention(jobId);
}

export function failJob(jobId: string, error: unknown): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.finishedAt = new Date();
  job.error = error instanceof Error ? error.message : String(error);
  clearActive(job);
  markCompleted(job);
  scheduleRetention(jobId);
}

function clearActive(job: Job): void {
  const active = ACTIVE_BY_SHOP.get(job.shopDomain);
  if (!active) return;
  if (active[job.kind] === job.id) {
    active[job.kind] = undefined;
  }
}

function markCompleted(job: Job): void {
  const map = LAST_COMPLETED_BY_SHOP.get(job.shopDomain) ?? {};
  map[job.kind] = job.finishedAt ?? new Date();
  LAST_COMPLETED_BY_SHOP.set(job.shopDomain, map);
}

function scheduleRetention(jobId: string): void {
  // eslint-disable-next-line no-undef
  setTimeout(() => {
    JOBS.delete(jobId);
  }, RETENTION_MS);
}

export function getJob(jobId: string): Job | undefined {
  return JOBS.get(jobId);
}

export function getActiveJobId(
  shopDomain: string,
  kind: JobKind,
): string | undefined {
  return ACTIVE_BY_SHOP.get(shopDomain)?.[kind];
}
