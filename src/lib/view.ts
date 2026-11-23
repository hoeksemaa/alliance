// What one player is allowed to see. This is the only place that turns database rows into data for a browser.
// Fog of war (confirmed rules):
// - public: positions, deaths, player names and flags, public News;
// - only the owner: their own hearts, range and AP, and their private log;
// - only the victim: who struck the final blow;
// - only jurors (destroyed tanks): tonight's jury votes, including who voted for whom.
import type { Q } from "./db";
import type { User } from "./auth";
import { countryName } from "./countries";
import { nextTickAt, tanksOf, type GameRow, type TankRow } from "./game";

export type PublicTank = { id: number; flag: string; country: string; player: string };
export type View = {
  serverNow: string;
  me: { username: string; admin: boolean };
  game: null | {
    status: GameRow["status"];
    apMode: GameRow["ap_mode"];
    intervalMin: number;
    round: number;
    nextTickAt: string | null;
    winner: PublicTank | null;
  };
  players: PublicTank[]; // the lobby: who joined, with which flag
  board: Array<PublicTank & { x: number; y: number }>; // living tanks
  jurors: PublicTank[]; // destroyed tanks
  myTank: null | (PublicTank & {
    x: number | null; y: number | null; hearts: number; range: number; ap: number; alive: boolean;
    killer: PublicTank | null;
  });
  news: Array<{ id: number; at: string; round: number; text: string }>;
  log: Array<{ id: number; at: string; round: number; text: string }>;
  jury: null | { votes: Array<{ juror: number; target: number }> };
};

const LIMIT = 200;
const pub = (t: TankRow): PublicTank => ({ id: t.id, flag: t.flag, country: countryName(t.flag), player: t.username });
const ev = (e: { id: number; at: Date; round: number; text: string }) => ({ id: e.id, at: new Date(e.at).toISOString(), round: e.round, text: e.text });

export async function buildView(q: Q, user: User, g: GameRow | null, now: Date): Promise<View> {
  const view: View = {
    serverNow: now.toISOString(),
    me: { username: user.username, admin: user.role === "admin" },
    game: null, players: [], board: [], jurors: [], myTank: null, news: [], log: [], jury: null,
  };
  if (!g) return view;

  const tanks = await tanksOf(q, g.id);
  const mine = tanks.find((t) => t.user_id === user.id) ?? null;
  const winner = g.winner_tank_id ? tanks.find((t) => t.id === g.winner_tank_id) : undefined;
  view.game = {
    status: g.status, apMode: g.ap_mode, intervalMin: g.ap_interval_min, round: g.round,
    nextTickAt: nextTickAt(g)?.toISOString() ?? null,
    winner: winner ? pub(winner) : null,
  };

  if (g.status === "lobby") {
    view.players = tanks.map(pub);
  } else {
    view.board = tanks.filter((t) => t.alive).map((t) => ({ ...pub(t), x: t.x!, y: t.y! }));
    view.jurors = tanks.filter((t) => !t.alive).map(pub);
  }

  if (mine) {
    const killer = mine.killer_tank_id ? tanks.find((t) => t.id === mine.killer_tank_id) : undefined;
    view.myTank = {
      ...pub(mine), x: mine.x, y: mine.y, hearts: mine.hearts, range: mine.range, ap: mine.ap, alive: mine.alive,
      killer: killer ? pub(killer) : null,
    };
    view.log = (await q.query<any>(
      "SELECT id, at, round, text FROM events WHERE game_id = $1 AND audience = 'private' AND tank_id = $2 ORDER BY id DESC LIMIT $3",
      [g.id, mine.id, LIMIT])).map(ev);
    if (g.status === "active" && !mine.alive) {
      view.jury = {
        votes: await q.query<{ juror: number; target: number }>(
          "SELECT juror_tank_id AS juror, target_tank_id AS target FROM votes WHERE game_id = $1 AND round = $2 ORDER BY cast_at",
          [g.id, g.round]),
      };
    }
  }

  view.news = (await q.query<any>(
    "SELECT id, at, round, text FROM events WHERE game_id = $1 AND audience = 'public' ORDER BY id DESC LIMIT $2",
    [g.id, LIMIT])).map(ev);
  return view;
}
