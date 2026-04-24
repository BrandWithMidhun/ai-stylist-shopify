// Polls GET /api/catalog/sync/:jobId every 2 seconds and exposes the
// current status + a rolling ETA. Cancels on unmount / jobId change.
// Calls onSuccess / onFailure exactly once on terminal status.

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

export function useSyncJobProgress(
  jobId: string | null,
  options: UseSyncJobProgressOptions = {},
): SyncJobProgress {
  const { onSuccess, onFailure, intervalMs = 2000 } = options;
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const firedRef = useRef<"none" | "success" | "failure">("none");

  useEffect(() => {
    if (!jobId) {
      setSnapshot(null);
      samplesRef.current = [];
      firedRef.current = "none";
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (interval !== null) {
        // eslint-disable-next-line no-undef
        clearInterval(interval);
        interval = null;
      }
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/catalog/sync/${jobId}`);
        if (res.status === 404) {
          // Job retention expired — clear the snapshot and stop polling.
          if (!cancelled) setSnapshot(null);
          stop();
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as JobSnapshot;
        if (cancelled) return;
        samplesRef.current = pushSample(samplesRef.current, {
          timestamp: Date.now(),
          progress: body.progress,
        });
        setSnapshot(body);
        if (body.status === "succeeded" && firedRef.current === "none") {
          firedRef.current = "success";
          onSuccess?.();
        }
        if (body.status === "failed" && firedRef.current === "none") {
          firedRef.current = "failure";
          onFailure?.(body.error ?? null);
        }
      } catch {
        // next tick retries
      }
    };

    void poll();
    // eslint-disable-next-line no-undef
    interval = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, intervalMs, onSuccess, onFailure]);

  const total = snapshot?.total ?? 0;
  const eta = estimateRemaining(samplesRef.current, total);

  return {
    snapshot,
    etaSeconds: eta.seconds,
    etaLabel: eta.label,
  };
}
