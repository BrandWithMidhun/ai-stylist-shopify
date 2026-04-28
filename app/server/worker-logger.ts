// Phase 1 (PR-B): structured JSON logger for the catalog sync worker.
//
// Tiny stdout JSON emitter — no library, no formatting magic. Railway's
// log viewer parses each line as JSON automatically. Every line carries
// service + level + ts + msg plus whatever context the caller passes.
//
// PII discipline (brief §15): never log product titles, customer emails,
// or any merchant data. Stick to GIDs, counts, durations, throttle
// status. The logger does not enforce this — the call sites do.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getMinLevel(): LogLevel {
  // eslint-disable-next-line no-undef
  const raw = (process.env.WORKER_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function emit(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[getMinLevel()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: "worker",
    msg,
    ...(ctx ?? {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};
