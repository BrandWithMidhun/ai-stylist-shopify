// Phase 1 (PR-B): worker health HTTP endpoint.
//
// Railway's per-service health probe wants something to talk to.
// Without an HTTP server, Railway can still see the process is alive,
// but having a real probe makes the dashboard surface meaningful and
// gives the operator a `curl` target for debugging.
//
// Bound on process.env.PORT (Railway injects this) — falls back to a
// sane default for local runs. The endpoint is deliberately public-
// readable; Railway only routes traffic to it via the internal/private
// service URL unless the operator explicitly exposes it.

import http from "node:http";
import { log } from "./worker-logger";

export type HealthSnapshot = {
  status: "ok" | "starting" | "stopping";
  bootedAt: string;
  uptimeMs: number;
  lastClaimAt: string | null;
  currentJobId: string | null;
  currentPhase: string | null;
  sweepCountAtBoot: number;
};

export type HealthState = {
  status: "ok" | "starting" | "stopping";
  bootedAtMs: number;
  lastClaimAtMs: number | null;
  currentJobId: string | null;
  currentPhase: string | null;
  sweepCountAtBoot: number;
};

export function createHealthState(): HealthState {
  return {
    status: "starting",
    bootedAtMs: Date.now(),
    lastClaimAtMs: null,
    currentJobId: null,
    currentPhase: null,
    sweepCountAtBoot: 0,
  };
}

function snapshot(state: HealthState): HealthSnapshot {
  return {
    status: state.status,
    bootedAt: new Date(state.bootedAtMs).toISOString(),
    uptimeMs: Date.now() - state.bootedAtMs,
    lastClaimAt: state.lastClaimAtMs
      ? new Date(state.lastClaimAtMs).toISOString()
      : null,
    currentJobId: state.currentJobId,
    currentPhase: state.currentPhase,
    sweepCountAtBoot: state.sweepCountAtBoot,
  };
}

export function startHealthServer(state: HealthState): http.Server {
  // eslint-disable-next-line no-undef
  const port = Number(process.env.PORT ?? 8080);
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/" || req.url === "/healthz") {
      res.statusCode = state.status === "stopping" ? 503 : 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(snapshot(state)));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(port, () => {
    log.info("health endpoint listening", { port });
  });
  // Don't keep the event loop alive solely for the HTTP server — when
  // the claim loop exits, we want the process to exit too.
  server.unref();
  return server;
}
