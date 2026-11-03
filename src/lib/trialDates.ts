// Client-safe trial date helpers. Dates are plain YYYY-MM-DD strings and
// a trial's end date is its last day. The UI counts days from the
// viewer's local date; the server cron uses the UTC date.

export const DEFAULT_TRIAL_DAYS = 30;

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function todayLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function defaultTrialEnd(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + DEFAULT_TRIAL_DAYS);
  return todayLocal(d);
}

export function isTrialExpired(
  trialEndsAt: string | null,
  today = todayLocal(),
): boolean {
  return trialEndsAt !== null && trialEndsAt < today;
}

// Whole days from today to the last trial day. 0 on the last day,
// negative once it has ended.
export function trialDaysLeft(trialEndsAt: string, today = todayLocal()): number {
  return Math.round(
    (Date.parse(trialEndsAt) - Date.parse(today)) / 86_400_000,
  );
}
