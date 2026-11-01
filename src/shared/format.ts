// How money and days are written, by the client and in notifications.

/** US cents as dollars: "$5" for whole dollars, "$5.50" otherwise. */
export function money(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/**
 * A calendar date, "YYYY-MM-DD", as "Thu Oct 22". It's a day, not an instant,
 * so it's formatted as written and never shifted into another timezone.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return formatDay(new Date(Date.UTC(year, month - 1, day)).toISOString(), "UTC");
}

/** An instant, as an ISO string, as its day in `timeZone` (the profile's): "Thu Oct 22", like `formatDate`. */
export function formatDay(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("month")} ${part("day")}`;
}
