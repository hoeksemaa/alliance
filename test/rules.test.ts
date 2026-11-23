import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COUNTRIES } from "../src/lib/countries";
import { N, START, inRange, placeTanks } from "../src/lib/rules";
import { nextDaily, nextTick, nyWallTime } from "../src/lib/clock";

describe("range", () => {
  it("is the square of size R plus one square straight out from the middle of each side", () => {
    const cells: string[] = [];
    for (let y = -4; y <= 4; y++) {
      let row = "";
      for (let x = -4; x <= 4; x++) row += inRange(0, 0, x, y, 2) ? "#" : ".";
      cells.push(row);
    }
    expect(cells).toEqual([
      ".........",
      "....#....",
      "..#####..",
      "..#####..",
      ".#######.",
      "..#####..",
      "..#####..",
      "....#....",
      ".........",
    ]);
  });
});

describe("start squares", () => {
  it("are all different and no tank starts in another tank's range", () => {
    for (let run = 0; run < 50; run++) {
      const spots = placeTanks(15);
      expect(new Set(spots.map(([x, y]) => `${x},${y}`)).size).toBe(15);
      for (const [x, y] of spots) {
        expect(x >= 0 && x < N && y >= 0 && y < N).toBe(true);
        const near = spots.filter(([ox, oy]) => (ox !== x || oy !== y) && inRange(ox, oy, x, y, START.range));
        expect(near).toEqual([]);
      }
    }
  });
});

describe("countries", () => {
  it("has 197 unique codes, and flag-icons has a flag for each", () => {
    expect(COUNTRIES.length).toBe(197);
    expect(new Set(COUNTRIES.map(([c]) => c)).size).toBe(197);
    for (const [code] of COUNTRIES) expect(existsSync(`node_modules/flag-icons/flags/4x3/${code}.svg`), code).toBe(true);
  });
});

describe("AP clock", () => {
  it("drops at 22:00 New York time, in winter and in summer", () => {
    expect(nextDaily(new Date("2026-01-10T12:00:00Z")).toISOString()).toBe("2026-01-11T03:00:00.000Z");
    expect(nextDaily(new Date("2026-07-10T12:00:00Z")).toISOString()).toBe("2026-07-11T02:00:00.000Z");
  });
  it("is correct on the days the clocks change", () => {
    expect(nyWallTime(2026, 3, 8, 22).toISOString()).toBe("2026-03-09T02:00:00.000Z");
    expect(nyWallTime(2026, 11, 1, 22).toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });
  it("moves to the next day after 22:00, and is strictly after the given time", () => {
    const at = new Date("2026-01-11T03:00:00Z");
    expect(nextDaily(at).toISOString()).toBe("2026-01-12T03:00:00.000Z");
  });
  it("counts intervals from the anchor", () => {
    const anchor = new Date("2026-01-01T00:00:00Z");
    const s = { mode: "interval" as const, intervalMin: 10, anchor };
    expect(nextTick(s, anchor).toISOString()).toBe("2026-01-01T00:10:00.000Z");
    expect(nextTick(s, new Date("2026-01-01T00:25:00Z")).toISOString()).toBe("2026-01-01T00:30:00.000Z");
    expect(nextTick(s, new Date("2025-12-31T00:00:00Z")).toISOString()).toBe("2026-01-01T00:10:00.000Z");
  });
});
