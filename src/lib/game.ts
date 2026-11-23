// The game itself: lobby, start, AP drops, actions and the jury.
// Every change to a game first locks the game row (SELECT ... FOR UPDATE), so changes never run at the same time.
import type { Q } from "./db";
import { GameError } from "./errors";
import { nextTick, type Schedule } from "./clock";
import { countryName, isCountry } from "./countries";
import { COST, DIRS, JURY_THRESHOLD, START, coord, inBoard, inRange, isDir, placeTanks } from "./rules";
import type { User } from "./auth";

export type GameRow = {
  id: number;
  status: "lobby" | "active" | "finished";
  ap_mode: "daily" | "interval";
  ap_interval_min: number;
  anchor_at: Date | null;
  round: number;
  last_tick_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  winner_tank_id: number | null;
};

export type TankRow = {
  id: number;
  game_id: number;
  user_id: number;
  username: string;
  flag: string;
  x: number | null;
  y: number | null;
  hearts: number;
  range: number;
  ap: number;
  alive: boolean;
  died_at: Date | null;
  killer_tank_id: number | null;
  joined_at: Date;
};

export type Effect =
  | { kind: "move"; from: [number, number]; to: [number, number] }
  | { kind: "shoot"; target: number; destroyed: boolean; won: boolean }
  | { kind: "give"; target: number }
  | { kind: "extend"; range: number }
  | { kind: "vote"; target: number };

export const label = (t: { username: string; flag: string }) => `${t.username} (${countryName(t.flag)})`;

const schedule = (g: GameRow): Schedule => ({ mode: g.ap_mode, intervalMin: g.ap_interval_min, anchor: g.anchor_at });

// The next AP drop comes after the last drop, and never before the last schedule change (anchor_at).
function tickBase(g: GameRow): Date {
  const last = (g.last_tick_at ?? g.started_at ?? g.created_at).getTime();
  return new Date(Math.max(last, g.anchor_at?.getTime() ?? 0));
}
export const nextTickAt = (g: GameRow): Date | null => (g.status === "active" ? nextTick(schedule(g), tickBase(g)) : null);

export async function currentGame(q: Q, lock = false): Promise<GameRow | null> {
  const rows = await q.query<GameRow>(`SELECT * FROM games ORDER BY id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`);
  return rows[0] ?? null;
}

export async function tanksOf(q: Q, gameId: number): Promise<TankRow[]> {
  return q.query<TankRow>(
    "SELECT t.*, u.username FROM tanks t JOIN users u ON u.id = t.user_id WHERE t.game_id = $1 ORDER BY t.id",
    [gameId],
  );
}

async function event(q: Q, g: GameRow, at: Date, text: string, tankId: number | null = null) {
  await q.query(
    "INSERT INTO events (game_id, at, round, audience, tank_id, text) VALUES ($1, $2, $3, $4, $5, $6)",
    [g.id, at, g.round, tankId === null ? "public" : "private", tankId, text],
  );
}

// Apply every AP drop that is due by `now`. The caller holds the game row lock.
// At each drop: the jury votes of the round that ends are counted, then each living tank gets 1 AP.
export async function processTicks(q: Q, g: GameRow, now: Date): Promise<GameRow> {
  for (let i = 0; i < 5000 && g.status === "active"; i++) {
    const at = nextTick(schedule(g), tickBase(g));
    if (at.getTime() > now.getTime()) break;
    const winners = await q.query<{ target: number }>(
      `SELECT v.target_tank_id AS target FROM votes v
         JOIN tanks t ON t.id = v.target_tank_id
         JOIN tanks j ON j.id = v.juror_tank_id
       WHERE v.game_id = $1 AND v.round = $2 AND t.alive AND NOT j.alive
       GROUP BY v.target_tank_id HAVING count(*) >= $3`,
      [g.id, g.round, JURY_THRESHOLD],
    );
    await q.query("UPDATE tanks SET ap = ap + 1 WHERE game_id = $1 AND alive", [g.id]);
    g = { ...g, round: g.round + 1, last_tick_at: at };
    await q.query("UPDATE games SET round = $2, last_tick_at = $3 WHERE id = $1", [g.id, g.round, at]);
    await event(q, g, at, "Each living tank got 1 AP.");
    for (const w of winners) {
      await q.query("UPDATE tanks SET ap = ap + 1 WHERE id = $1", [w.target]);
      await event(q, g, at, "⚖️ The jury gave you 1 extra AP.", w.target);
    }
  }
  return g;
}

// The current game with all due AP drops applied. Run inside a transaction.
export async function freshGame(q: Q, now: Date): Promise<GameRow | null> {
  const g = await currentGame(q);
  if (!g || g.status !== "active" || nextTickAt(g)!.getTime() > now.getTime()) return g;
  const locked = await currentGame(q, true);
  return locked && locked.status === "active" ? processTicks(q, locked, now) : locked;
}

async function openGame(q: Q, now: Date, want?: GameRow["status"]): Promise<GameRow> {
  let g = await currentGame(q, true);
  if (g?.status === "active") g = await processTicks(q, g, now);
  if (!g || (want && g.status !== want)) {
    const msg = { lobby: "There is no game open to join.", active: "There is no game running.", finished: "The game is not over." };
    throw new GameError(want ? msg[want] : "There is no game.");
  }
  return g;
}

// ---------- admin ----------

export type ScheduleInput = { mode: unknown; intervalMin?: unknown };
function checkSchedule(s: ScheduleInput): { mode: GameRow["ap_mode"]; intervalMin: number } {
  if (s.mode !== "daily" && s.mode !== "interval") throw new GameError("Pick daily or interval AP drops.");
  const intervalMin = s.mode === "interval" ? Number(s.intervalMin) : 60;
  if (!Number.isInteger(intervalMin) || intervalMin < 1 || intervalMin > 1440) throw new GameError("The interval must be 1 to 1440 minutes.");
  return { mode: s.mode, intervalMin };
}

export async function createGame(q: Q, s: ScheduleInput = { mode: "daily" }): Promise<GameRow> {
  const g = await currentGame(q, true);
  if (g && g.status !== "finished") throw new GameError("A game is already open. End it first.");
  const { mode, intervalMin } = checkSchedule(s);
  const [row] = await q.query<GameRow>(
    "INSERT INTO games (ap_mode, ap_interval_min) VALUES ($1, $2) RETURNING *", [mode, intervalMin]);
  return row;
}

export async function setSchedule(q: Q, now: Date, s: ScheduleInput): Promise<void> {
  const g = await openGame(q, now);
  if (g.status === "finished") throw new GameError("The game is over.");
  const { mode, intervalMin } = checkSchedule(s);
  await q.query("UPDATE games SET ap_mode = $2, ap_interval_min = $3, anchor_at = $4 WHERE id = $1", [g.id, mode, intervalMin, now]);
}

export async function startGame(q: Q, now: Date, rand: () => number = Math.random): Promise<void> {
  const g = await openGame(q, now, "lobby");
  const tanks = await tanksOf(q, g.id);
  if (tanks.length < 2) throw new GameError("At least 2 players must join before the game can start.");
  const spots = placeTanks(tanks.length, rand);
  for (const [i, t] of tanks.entries()) {
    await q.query("UPDATE tanks SET x = $2, y = $3, hearts = $4, range = $5, ap = $6, alive = true WHERE id = $1",
      [t.id, spots[i][0], spots[i][1], START.hearts, START.range, START.ap]);
  }
  const started = { ...g, status: "active" as const, started_at: now, anchor_at: now, round: 0, last_tick_at: null };
  await q.query("UPDATE games SET status = 'active', started_at = $2, anchor_at = $2, round = 0, last_tick_at = NULL WHERE id = $1", [g.id, now]);
  await event(q, started, now, "The game started. Good luck.");
}

export async function endGame(q: Q, now: Date): Promise<void> {
  const g = await openGame(q, now);
  if (g.status === "finished") throw new GameError("The game is already over.");
  const done = { ...g, status: "finished" as const };
  await q.query("UPDATE games SET status = 'finished', finished_at = $2 WHERE id = $1", [g.id, now]);
  if (g.status === "active") await event(q, done, now, "The admin ended the game.");
}

export async function removeFromLobby(q: Q, now: Date, tankId: unknown): Promise<void> {
  const g = await openGame(q, now, "lobby");
  await q.query("DELETE FROM tanks WHERE game_id = $1 AND id = $2", [g.id, Number(tankId)]);
}

// ---------- players ----------

export async function joinGame(q: Q, now: Date, user: User, rawFlag: unknown): Promise<void> {
  const g = await openGame(q, now, "lobby");
  const flag = typeof rawFlag === "string" ? rawFlag.toLowerCase() : "";
  if (!isCountry(flag)) throw new GameError("Pick a flag from the list.");
  const [owner] = await q.query<{ user_id: number }>("SELECT user_id FROM tanks WHERE game_id = $1 AND flag = $2", [g.id, flag]);
  if (owner && owner.user_id !== user.id) throw new GameError(`Another player has the flag of ${countryName(flag)}.`);
  await q.query(
    `INSERT INTO tanks (game_id, user_id, flag) VALUES ($1, $2, $3)
     ON CONFLICT (game_id, user_id) DO UPDATE SET flag = EXCLUDED.flag`,
    [g.id, user.id, flag],
  );
}

export async function leaveGame(q: Q, now: Date, user: User): Promise<void> {
  const g = await openGame(q, now, "lobby");
  await q.query("DELETE FROM tanks WHERE game_id = $1 AND user_id = $2", [g.id, user.id]);
}

export type ActionInput = { kind?: unknown; dir?: unknown; target?: unknown };

export async function act(q: Q, now: Date, user: User, input: ActionInput): Promise<Effect> {
  let g = await openGame(q, now, "active");
  const tanks = await tanksOf(q, g.id);
  const me = tanks.find((t) => t.user_id === user.id);
  if (!me) throw new GameError("You are not in this game.");
  const living = tanks.filter((t) => t.alive);
  const target = () => {
    const t = living.find((x) => x.id === Number(input.target));
    if (!t) throw new GameError("That tank is not on the board.");
    if (t.id === me.id) throw new GameError("Pick another tank.");
    return t;
  };
  const needAp = (n: number) => {
    if (me.ap < n) throw new GameError(n === 1 ? "You need 1 AP." : `You need ${n} AP.`);
  };
  const reach = (t: TankRow) => {
    if (!inRange(me.x!, me.y!, t.x!, t.y!, me.range)) throw new GameError(`${t.username} is out of range.`);
  };

  if (input.kind === "vote") {
    if (me.alive) throw new GameError("Only destroyed tanks vote. They form the jury.");
    const t = target();
    await q.query(
      `INSERT INTO votes (game_id, round, juror_tank_id, target_tank_id, cast_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, round, juror_tank_id) DO UPDATE SET target_tank_id = EXCLUDED.target_tank_id, cast_at = EXCLUDED.cast_at`,
      [g.id, g.round, me.id, t.id, now],
    );
    return { kind: "vote", target: t.id };
  }
  if (!me.alive) throw new GameError("Your tank is destroyed. You can only vote.");

  switch (input.kind) {
    case "move": {
      if (!isDir(input.dir)) throw new GameError("Pick a direction.");
      needAp(COST.move);
      const [dx, dy] = DIRS[input.dir];
      const x = me.x! + dx, y = me.y! + dy;
      if (!inBoard(x, y)) throw new GameError("That square is off the board.");
      const blocker = living.find((t) => t.x === x && t.y === y);
      if (blocker) throw new GameError(`${blocker.username} is in the way.`);
      await q.query("UPDATE tanks SET x = $2, y = $3, ap = ap - $4 WHERE id = $1", [me.id, x, y, COST.move]);
      const path = `${coord(me.x!, me.y!)} → ${coord(x, y)}`;
      await event(q, g, now, `${label(me)} moved ${path}.`);
      await event(q, g, now, `You moved ${path}.`, me.id);
      return { kind: "move", from: [me.x!, me.y!], to: [x, y] };
    }
    case "shoot": {
      const t = target();
      needAp(COST.shoot);
      reach(t);
      await q.query("UPDATE tanks SET ap = ap - $2 WHERE id = $1", [me.id, COST.shoot]);
      if (t.hearts > 1) {
        await q.query("UPDATE tanks SET hearts = hearts - 1 WHERE id = $1", [t.id]);
        await event(q, g, now, `You hit ${label(t)}.`, me.id);
        await event(q, g, now, "💔 You lost a heart.", t.id);
        return { kind: "shoot", target: t.id, destroyed: false, won: false };
      }
      await q.query("UPDATE tanks SET hearts = 0, alive = false, died_at = $2, killer_tank_id = $3 WHERE id = $1", [t.id, now, me.id]);
      await event(q, g, now, `💥 ${label(t)} was destroyed.`);
      await event(q, g, now, `You destroyed ${label(t)}. They will see your name.`, me.id);
      await event(q, g, now, `☠️ ${label(me)} destroyed your tank. You are on the jury now.`, t.id);
      const won = living.length - 1 <= 1;
      if (won) {
        await q.query("UPDATE games SET status = 'finished', finished_at = $2, winner_tank_id = $3 WHERE id = $1", [g.id, now, me.id]);
        await event(q, g, now, `🏆 ${label(me)} won the game!`);
      }
      return { kind: "shoot", target: t.id, destroyed: true, won };
    }
    case "give": {
      const t = target();
      needAp(COST.give);
      reach(t);
      await q.query("UPDATE tanks SET ap = ap - $2 WHERE id = $1", [me.id, COST.give]);
      await q.query("UPDATE tanks SET ap = ap + 1 WHERE id = $1", [t.id]);
      await event(q, g, now, `You gave 1 AP to ${label(t)}.`, me.id);
      await event(q, g, now, "🎁 You got 1 AP from another tank.", t.id);
      return { kind: "give", target: t.id };
    }
    case "extend": {
      needAp(COST.extend);
      await q.query("UPDATE tanks SET range = range + 1, ap = ap - $2 WHERE id = $1", [me.id, COST.extend]);
      await event(q, g, now, `You extended your range to ${me.range + 1}.`, me.id);
      return { kind: "extend", range: me.range + 1 };
    }
    default:
      throw new GameError("That action does not exist.");
  }
}
