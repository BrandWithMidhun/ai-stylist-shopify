// Rolling-average ETA for the catalog sync progress bar.
//
// v1 uses a simple rolling average of the last 10 samples. This is jumpy
// when GraphQL returns pages of 250 at a time, which is acceptable for
// 005c (decision #7). Future work: median + exponential smoothing, or a
// server-side estimate based on total count and last-page duration.

export type Sample = { timestamp: number; progress: number };

export const ETA_MAX_SAMPLES = 10;

export function pushSample(
  samples: readonly Sample[],
  next: Sample,
): Sample[] {
  const out = [...samples, next];
  if (out.length > ETA_MAX_SAMPLES) {
    return out.slice(out.length - ETA_MAX_SAMPLES);
  }
  return out;
}

export function estimateRemaining(
  samples: readonly Sample[],
  total: number,
): { seconds: number | null; label: string } {
  if (samples.length < 2 || total <= 0) {
    return { seconds: null, label: "Calculating…" };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const deltaProgress = last.progress - first.progress;
  const deltaMs = last.timestamp - first.timestamp;
  if (deltaProgress <= 0 || deltaMs <= 0) {
    return { seconds: null, label: "Calculating…" };
  }
  const rate = deltaProgress / deltaMs; // items per ms
  const remainingItems = Math.max(0, total - last.progress);
  const remainingMs = remainingItems / rate;
  const seconds = Math.round(remainingMs / 1000);
  return { seconds, label: formatEtaLabel(seconds) };
}

function formatEtaLabel(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes === 1) return "about a minute";
  return `about ${minutes} minutes`;
}

export function phaseFor(
  progress: number,
  total: number,
  status: "queued" | "running" | "succeeded" | "failed" | null,
): string {
  if (status === "succeeded") return "Finished";
  if (status === "failed") return "Failed";
  if (progress === 0) return "Counting your catalogue";
  if (total > 0 && progress >= total) return "Finalising";
  return "Reading from Shopify";
}
