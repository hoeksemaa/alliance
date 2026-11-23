import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openPg, openPglite, type Db } from "../src/lib/db";
import { createSession, login, register, signupNeeds, userForToken, type User } from "../src/lib/auth";
import { act, createGame, currentGame, endGame, freshGame, joinGame, setSchedule, startGame, tanksOf } from "../src/lib/game";
import { buildView } from "../src/lib/view";

let d: Db;
const T0 = new Date("2026-01-10T12:00:00Z"); // 07:00 in New York; the first AP drop is at 2026-01-11T03:00Z
const at = (min: number) => new Date(T0.getTime() + min * 60000);

async function users(n: number): Promise<User[]> {
  const out: User[] = [];
  out.push(await d.tx((q) => register(q, "admin", "password1", "")));
  const [{ invite_code }] = await d.query("SELECT invite_code FROM settings");
  for (let i = 1; i < n; i++) out.push(await d.tx((q) => register(q, `p${i}`, "password1", invite_code)));
  return out;
}

// Puts tanks on chosen squares, so a test can control who is in range.
async function place(spots: Array<[number, number]>) {
  const g = (await currentGame(d))!;
  const ts = await tanksOf(d, g.id);
  for (const [i, t] of ts.entries()) await d.query("UPDATE tanks SET x = $2, y = $3 WHERE id = $1", [t.id, spots[i][0], spots[i][1]]);
  return ts;
}
const tank = async (userId: number) => (await d.query("SELECT * FROM tanks WHERE user_id = $1", [userId]))[0];
const setAp = (userId: number, ap: number) => d.query("UPDATE tanks SET ap = $2 WHERE user_id = $1", [userId, ap]);

async function startWith(n: number) {
  const us = await users(n);
  await d.tx((q) => createGame(q));
  const flags = ["us", "jp", "ng", "ch", "fr", "de", "it", "se"];
  for (const [i, u] of us.entries()) await d.tx((q) => joinGame(q, T0, u, flags[i]));
  await d.tx((q) => startGame(q, T0));
  return us;
}

// By default the tests use an in-memory PGlite. Set PG_TEST_URL to run them through the `pg` driver (as on Vercel) instead.
// That database is wiped before each test, so never point it at real data.
const PG_TEST_URL = process.env.PG_TEST_URL;
let shared: Db | undefined;
beforeEach(async () => {
  if (PG_TEST_URL) {
    d = shared ??= await openPg(PG_TEST_URL);
    await d.query("DROP SCHEMA IF EXISTS public CASCADE");
    await d.query("CREATE SCHEMA public");
  } else {
    d = await openPglite();
  }
  await migrate(d);
});

describe("accounts", () => {
  it("makes the first account the admin, and needs the invite code after that", async () => {
    const admin = await d.tx((q) => register(q, "Sam", "password1", ""));
    expect(admin.role).toBe("admin");
    await expect(d.tx((q) => register(q, "Maya", "password1", "wrong"))).rejects.toThrow(/invite code/);
    const [{ invite_code }] = await d.query("SELECT invite_code FROM settings");
    const maya = await d.tx((q) => register(q, "Maya", "password1", invite_code));
    expect(maya.role).toBe("player");
    await expect(d.tx((q) => register(q, "maya", "password1", invite_code))).rejects.toThrow(/taken/);
  });
  it("asks the first account for SETUP_CODE when it is set", async () => {
    process.env.SETUP_CODE = "Lantern-42";
    try {
      expect(await signupNeeds(d)).toEqual({ needsInvite: true, setup: true });
      await expect(d.tx((q) => register(q, "Stranger", "password1", ""))).rejects.toThrow(/setup code/);
      const admin = await d.tx((q) => register(q, "Sam", "password1", " lantern-42 "));
      expect(admin.role).toBe("admin");
      expect(await signupNeeds(d)).toEqual({ needsInvite: true, setup: false });
    } finally {
      delete process.env.SETUP_CODE;
    }
  });
  it("signs in with the right password only, and sessions find the user", async () => {
    await d.tx((q) => register(q, "Sam", "password1", ""));
    await expect(login(d, "sam", "nope-nope")).rejects.toThrow(/not correct/);
    const u = await login(d, "SAM", "password1");
    const token = await createSession(d, u.id);
    expect((await userForToken(d, token))?.username).toBe("Sam");
    expect(await userForToken(d, "made-up")).toBeNull();
  });
});

describe("lobby", () => {
  it("gives each flag to one player only, and lets a player change flag", async () => {
    const [a, b] = await users(2);
    await d.tx((q) => createGame(q));
    await d.tx((q) => joinGame(q, T0, a, "fr"));
    await expect(d.tx((q) => joinGame(q, T0, b, "fr"))).rejects.toThrow(/Another player/);
    await d.tx((q) => joinGame(q, T0, a, "jp"));
    await d.tx((q) => joinGame(q, T0, b, "fr"));
    await expect(d.tx((q) => joinGame(q, T0, b, "zz"))).rejects.toThrow(/Pick a flag/);
  });
  it("needs 2 players to start, then places every tank with 3 hearts, range 2 and 0 AP", async () => {
    const [a, b] = await users(2);
    await d.tx((q) => createGame(q));
    await d.tx((q) => joinGame(q, T0, a, "us"));
    await expect(d.tx((q) => startGame(q, T0))).rejects.toThrow(/At least 2/);
    await d.tx((q) => joinGame(q, T0, b, "jp"));
    await d.tx((q) => startGame(q, T0));
    expect(await currentGame(d)).toMatchObject({ status: "active", round: 0 });
    for (const u of [a, b]) expect(await tank(u.id)).toMatchObject({ hearts: 3, range: 2, ap: 0, alive: true });
    expect((await tank(a.id)).x).not.toBeNull();
  });
});

describe("AP drops", () => {
  it("gives each living tank 1 AP at 22:00 New York time, once per day", async () => {
    const [a] = await startWith(3);
    expect((await tank(a.id)).ap).toBe(0);
    await d.tx((q) => freshGame(q, at(60)));
    expect((await tank(a.id)).ap).toBe(0);
    await d.tx((q) => freshGame(q, new Date("2026-01-11T03:00:00Z")));
    expect((await tank(a.id)).ap).toBe(1);
    await d.tx((q) => freshGame(q, new Date("2026-01-11T05:00:00Z")));
    expect((await tank(a.id)).ap).toBe(1);
    await d.tx((q) => freshGame(q, new Date("2026-01-14T04:00:00Z"))); // three more nights
    expect((await tank(a.id)).ap).toBe(4);
    expect((await currentGame(d))!.round).toBe(4);
  });
  it("follows the admin's interval setting, from the time of the change", async () => {
    const [a] = await startWith(2);
    await d.tx((q) => setSchedule(q, at(5), { mode: "interval", intervalMin: 10 }));
    await d.tx((q) => freshGame(q, at(14)));
    expect((await tank(a.id)).ap).toBe(0);
    await d.tx((q) => freshGame(q, at(36)));
    expect((await tank(a.id)).ap).toBe(3); // at 15, 25 and 35
  });
});

describe("actions", () => {
  it("moves one square for 1 AP, but not off the board or onto a tank", async () => {
    const [a, b] = await startWith(2);
    await place([[0, 0], [1, 0]]);
    await expect(d.tx((q) => act(q, at(1), a, { kind: "move", dir: "down" }))).rejects.toThrow(/1 AP/);
    await setAp(a.id, 5);
    await expect(d.tx((q) => act(q, at(1), a, { kind: "move", dir: "up" }))).rejects.toThrow(/off the board/);
    await expect(d.tx((q) => act(q, at(1), a, { kind: "move", dir: "right" }))).rejects.toThrow(/in the way/);
    const e = await d.tx((q) => act(q, at(1), a, { kind: "move", dir: "down" }));
    expect(e).toEqual({ kind: "move", from: [0, 0], to: [0, 1] });
    expect(await tank(a.id)).toMatchObject({ x: 0, y: 1, ap: 4 });
    void b;
  });
  it("shoots and gives AP only in range, and extends range for 2 AP", async () => {
    const [a, b] = await startWith(2);
    const ts = await place([[5, 5], [5, 9]]); // 4 squares straight down: out of range 2
    await setAp(a.id, 5);
    await expect(d.tx((q) => act(q, at(1), a, { kind: "shoot", target: ts[1].id }))).rejects.toThrow(/out of range/);
    await d.tx((q) => act(q, at(1), a, { kind: "extend" }));
    expect(await tank(a.id)).toMatchObject({ range: 3, ap: 3 });
    await d.tx((q) => act(q, at(2), a, { kind: "give", target: ts[1].id }));
    expect((await tank(b.id)).ap).toBe(1);
    await d.tx((q) => act(q, at(3), a, { kind: "shoot", target: ts[1].id }));
    expect((await tank(b.id)).hearts).toBe(2);
  });
  it("destroys a tank on its last heart, makes it a juror, and ends the game with one tank left", async () => {
    const [a, b, c] = await startWith(3);
    const ts = await place([[5, 5], [6, 5], [15, 15]]);
    await setAp(a.id, 5);
    await d.query("UPDATE tanks SET hearts = 1 WHERE id = $1", [ts[1].id]);
    const e = await d.tx((q) => act(q, at(1), a, { kind: "shoot", target: ts[1].id }));
    expect(e).toMatchObject({ destroyed: true, won: false });
    expect(await tank(b.id)).toMatchObject({ alive: false, killer_tank_id: ts[0].id });
    await expect(d.tx((q) => act(q, at(2), b, { kind: "move", dir: "up" }))).rejects.toThrow(/only vote/);
    await d.query("UPDATE tanks SET x = 7, y = 5, hearts = 1 WHERE id = $1", [ts[2].id]);
    const e2 = await d.tx((q) => act(q, at(3), a, { kind: "shoot", target: ts[2].id }));
    expect(e2).toMatchObject({ destroyed: true, won: true });
    expect(await currentGame(d)).toMatchObject({ status: "finished", winner_tank_id: ts[0].id });
    void c;
  });
});

describe("jury", () => {
  it("gives 1 extra AP at the next drop to a tank with 3 or more votes", async () => {
    const us = await startWith(5);
    const ts = await place([[0, 0], [5, 0], [10, 0], [15, 0], [0, 10]]);
    await d.query("UPDATE tanks SET alive = false, hearts = 0 WHERE id = ANY($1)", [[ts[1].id, ts[2].id, ts[3].id]]);
    for (const juror of us.slice(1, 4)) await d.tx((q) => act(q, at(1), juror, { kind: "vote", target: ts[4].id }));
    await expect(d.tx((q) => act(q, at(1), us[0], { kind: "vote", target: ts[4].id }))).rejects.toThrow(/Only destroyed/);
    await d.tx((q) => freshGame(q, new Date("2026-01-11T03:00:00Z")));
    expect((await tank(us[4].id)).ap).toBe(2); // 1 from the drop + 1 from the jury
    expect((await tank(us[0].id)).ap).toBe(1);
  });
});

describe("fog of war", () => {
  it("never shows another tank's hearts, range or AP, and shows the killer only to the victim", async () => {
    const [a, b, c] = await startWith(3);
    const ts = await place([[5, 5], [6, 5], [15, 15]]);
    await setAp(a.id, 5);
    await d.tx((q) => act(q, at(1), a, { kind: "give", target: ts[1].id }));
    await d.tx((q) => act(q, at(2), a, { kind: "shoot", target: ts[1].id }));
    await d.query("UPDATE tanks SET hearts = 1 WHERE id = $1", [ts[1].id]);
    await d.tx((q) => act(q, at(3), a, { kind: "shoot", target: ts[1].id }));

    const g = await currentGame(d);
    const vb = await buildView(d, b, g, at(4)); // the victim
    const vc = await buildView(d, c, g, at(4)); // a bystander

    expect(vb.myTank?.killer?.player).toBe("admin");
    expect(vc.myTank?.killer).toBeNull();
    expect(vc.myTank?.id).toBe(ts[2].id); // the only hearts, range and AP in the bystander's view are their own
    for (const t of [...vc.board, ...vc.jurors]) expect(t).not.toHaveProperty("hearts");
    for (const t of vc.board) expect(Object.keys(t).sort()).toEqual(["country", "flag", "id", "player", "x", "y"]);
    expect(vc.news.map((e) => e.text).join("\n")).not.toMatch(/admin \(United States\) destroyed|gave|hit/);
    expect(vb.log.map((e) => e.text)).toEqual(expect.arrayContaining([
      "🎁 You got 1 AP from another tank.",
      "💔 You lost a heart.",
      "☠️ admin (United States) destroyed your tank. You are on the jury now.",
    ]));
    expect(vb.log.map((e) => e.text).join("\n")).not.toMatch(/You got 1 AP from admin/);
    expect(vc.log).toEqual([]);
    expect(vc.jury).toBeNull();
    expect(vb.jury).toEqual({ votes: [] });
  });
  it("shows jurors who voted for whom, and shows living players nothing about the jury", async () => {
    const us = await startWith(3);
    const ts = await place([[0, 0], [5, 0], [10, 10]]);
    await d.query("UPDATE tanks SET alive = false, hearts = 0 WHERE id = $1", [ts[1].id]);
    await d.tx((q) => act(q, at(1), us[1], { kind: "vote", target: ts[2].id }));
    const g = await currentGame(d);
    expect((await buildView(d, us[1], g, at(2))).jury).toEqual({ votes: [{ juror: ts[1].id, target: ts[2].id }] });
    expect((await buildView(d, us[2], g, at(2))).jury).toBeNull();
  });
  it("ends a game on the admin's request", async () => {
    await startWith(2);
    await d.tx((q) => endGame(q, at(1)));
    expect((await currentGame(d))!.status).toBe("finished");
  });
});
