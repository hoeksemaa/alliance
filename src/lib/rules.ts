// Pure game rules. No database here, so the rules are easy to test.

export const N = 20; // the board is N × N
export const START = { hearts: 3, range: 2, ap: 0 } as const;
export const COST = { move: 1, shoot: 1, give: 1, extend: 2 } as const;
export const JURY_THRESHOLD = 3; // a tank with this many jury votes gets 1 extra AP
export const COLS = "ABCDEFGHIJKLMNOPQRST";

export const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
} as const;
export type Dir = keyof typeof DIRS;
export const isDir = (d: unknown): d is Dir => typeof d === "string" && Object.hasOwn(DIRS, d);

export const inBoard = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N;

// Range R: the square of size R around the tank, plus one more square straight out from the middle of each side.
export function inRange(cx: number, cy: number, x: number, y: number, R: number): boolean {
  const dx = Math.abs(cx - x), dy = Math.abs(cy - y);
  return Math.max(dx, dy) <= R || ((dx === 0 || dy === 0) && dx + dy <= R + 1);
}

export const coord = (x: number, y: number): string => COLS[x] + String(y + 1);

// Random start squares: all different, and no tank starts inside another tank's starting range.
// If that is impossible (a very full board), fall back to "all different".
export function placeTanks(count: number, rand: () => number = Math.random): Array<[number, number]> {
  if (count > N * N) throw new Error("Too many tanks for the board.");
  const pick = (spaced: boolean): Array<[number, number]> | null => {
    const out: Array<[number, number]> = [];
    let tries = 0;
    while (out.length < count) {
      if (++tries > 20000) return null;
      const x = Math.floor(rand() * N), y = Math.floor(rand() * N);
      const clash = out.some(([ox, oy]) => (spaced ? inRange(ox, oy, x, y, START.range) : ox === x && oy === y));
      if (!clash) out.push([x, y]);
    }
    return out;
  };
  for (let i = 0; i < 20; i++) {
    const p = pick(true);
    if (p) return p;
  }
  const p = pick(false);
  if (!p) throw new Error("Could not place the tanks.");
  return p;
}
