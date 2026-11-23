// When the AP drops happen.
// "daily": every day at 22:00 New York time (DST-safe).
// "interval": every N minutes from an anchor time (for playtests).

export const TZ = "America/New_York";
export const DAILY_HOUR = 22;

export type Schedule = { mode: "daily" | "interval"; intervalMin: number; anchor: Date | null };

const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

// The New York offset from UTC at an instant, in minutes (for example -300 in winter, -240 in summer).
function offsetMin(at: Date): number {
  const name = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -v : v;
}

function nyDate(at: Date): { y: number; m: number; d: number } {
  const p = Object.fromEntries(dateFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

// The instant of a New York wall-clock time on a New York calendar date.
export function nyWallTime(y: number, m: number, d: number, hour: number): Date {
  const wall = Date.UTC(y, m - 1, d, hour);
  let t = wall - offsetMin(new Date(wall)) * 60000;
  t = wall - offsetMin(new Date(t)) * 60000; // a second pass gets the DST change days right
  return new Date(t);
}

// The first 22:00 New York time that is strictly after `after`.
export function nextDaily(after: Date): Date {
  const { y, m, d } = nyDate(after);
  for (let add = 0; add < 3; add++) {
    const day = new Date(Date.UTC(y, m - 1, d + add));
    const t = nyWallTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), DAILY_HOUR);
    if (t.getTime() > after.getTime()) return t;
  }
  throw new Error("nextDaily: no time found");
}

// The first AP drop that is strictly after `after`.
export function nextTick(s: Schedule, after: Date): Date {
  if (s.mode === "interval") {
    const anchor = (s.anchor ?? after).getTime();
    const step = Math.max(1, s.intervalMin) * 60000;
    const k = Math.max(1, Math.floor((after.getTime() - anchor) / step) + 1);
    return new Date(anchor + k * step);
  }
  return nextDaily(after);
}
