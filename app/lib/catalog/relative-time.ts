// Tiny relative-time formatter. Avoids a date-fns dependency for this single
// use case (Last synced 15 minutes ago). Client-safe (no prisma imports).

export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const deltaSec = Math.max(0, Math.round((now - then) / 1000));
  if (deltaSec < 45) return "just now";
  if (deltaSec < 90) return "a minute ago";
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 45) return `${deltaMin} minutes ago`;
  if (deltaMin < 90) return "an hour ago";
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 22) return `${deltaHr} hours ago`;
  if (deltaHr < 36) return "a day ago";
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay < 26) return `${deltaDay} days ago`;
  const deltaWk = Math.round(deltaDay / 7);
  return `${deltaWk} weeks ago`;
}
