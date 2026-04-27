// Polls GET /api/catalog/sync/:jobId every 2 seconds and exposes the
// current status + a rolling ETA. Cancels on unmount / jobId change.
// Calls onSuccess / onFailure exactly once on terminal status.
//
// Phase 1 (PR-A): the underlying API now reads CatalogSyncJob from DB,
// so job rows persist beyond the in-process 60-second retention window.
// The legacy "treat 404 as success" quirk is removed — a 404 now means
// the job ID was never created or is from another shop, which is a
// real failure case the merchant should see, not silent success.

import { useEffect, useRef, useState } from "react";
import {
  estimateRemaining,
  pushSample,
  type Sample,
} from "../lib/catalog/eta";

export type JobSnapshot = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  total: number;
  failed: number;
  error: string | null;
  startedAt: string;
};

export type SyncJobProgress = {
  snapshot: JobSnapshot | null;
  etaSeconds: number | null;
  etaLabel: string;
};

export type UseSyncJobProgressOptions = {
  onSuccess?: () => void;
  onFailure?: (error: string | null) => void;
  intervalMs?: number;
};

const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 100;

export function useSyncJobProgress(
  jobId: string | null,
  options: UseSyncJobProgressOptions = {},
): SyncJobProgress {
  const { onSuccess, onFailure, intervalMs = 2000 } = options;
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const firedRef = useRef<"none" | "success" | "failure">("none");

  // Hold callbacks in refs so the polling effect does NOT re-subscribe each
  // render. Without this, inline arrows in the caller create a new reference
  // on every render, the effect tears down + re-creates, and each re-create
  // fires an immediate poll — producing the 404 polling storm we hit before.
  const onSuccessRef = useRef(onSuccess);
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onFailureRef.current = onFailure;
  });

  useEffect(() => {
    if (!jobId) {
      setSnapshot(null);
      samplesRef.current = [];
      firedRef.current = "none";
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let consecutiveFailures = 0;
    const startedAt = Date.now();

    const stop = () => {
      if (interval !== null) {
        // eslint-disable-next-line no-undef
        clearInterval(interval);
        interval = null;
      }
    };

    const finishSuccess = () => {
      if (firedRef.current !== "none") return;
      firedRef.current = "success";
      onSuccessRef.current?.();
    };

    const finishFailure = (error: string | null) => {
      if (firedRef.current !== "none") return;
      firedRef.current = "failure";
      onFailureRef.current?.(error);
    };

    const poll = async () => {
      if (cancelled) return;

      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        stop();
        finishFailure("Sync polling timed out — please refresh");
        return;
      }

      try {
        const res = await fetch(`/api/catalog/sync/${jobId}`);
        if (cancelled) return;

        if (res.status === 404) {
          // CatalogSyncJob rows persist in DB — a 404 means an invalid
          // jobId (never created, deleted, or belongs to another shop).
          // Surface as failure rather than silently succeeding.
          stop();
          finishFailure("Sync job not found");
          return;
        }

        if (!res.ok) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            stop();
            finishFailure("Sync polling failed — please refresh");
          }
          return;
        }

        consecutiveFailures = 0;
        const body = (await res.json()) as JobSnapshot;
        if (cancelled) return;
        samplesRef.current = pushSample(samplesRef.current, {
          timestamp: Date.now(),
          progress: body.progress,
        });
        setSnapshot(body);
        if (body.status === "succeeded") {
          stop();
          finishSuccess();
        } else if (body.status === "failed") {
          stop();
          finishFailure(body.error ?? null);
        }
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stop();
          finishFailure("Sync polling failed — please refresh");
        }
      }
    };

    void poll();
    // eslint-disable-next-line no-undef
    interval = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, intervalMs]);

  const total = snapshot?.total ?? 0;
  const eta = estimateRemaining(samplesRef.current, total);

  return {
    snapshot,
    etaSeconds: eta.seconds,
    etaLabel: eta.label,
  };
}
