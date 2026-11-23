import { NextResponse, type NextRequest } from "next/server";
import { db, type Q } from "@/lib/db";
import { newInviteCode } from "@/lib/auth";
import { countryName } from "@/lib/countries";
import { GameError } from "@/lib/errors";
import { createGame, endGame, freshGame, nextTickAt, removeFromLobby, setSchedule, startGame, tanksOf } from "@/lib/game";
import { handle, noStore, readBody, requireUser, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

// The admin page data. It shows no hidden values (hearts, range, AP): the admin is often a player too.
async function adminView(q: Q, now: Date) {
  const g = await freshGame(q, now);
  const [s] = await q.query<{ invite_code: string }>("SELECT invite_code FROM settings WHERE id = 1");
  const users = await q.query<{ id: number; username: string; role: string }>("SELECT id, username, role FROM users ORDER BY id");
  const tanks = g ? await tanksOf(q, g.id) : [];
  return {
    inviteCode: s?.invite_code ?? "",
    users,
    game: g && {
      status: g.status, apMode: g.ap_mode, intervalMin: g.ap_interval_min, round: g.round,
      nextTickAt: nextTickAt(g)?.toISOString() ?? null,
    },
    players: tanks.map((t) => ({ id: t.id, player: t.username, flag: t.flag, country: countryName(t.flag), alive: t.alive })),
  };
}

export const GET = (req: NextRequest) => handle(async () => {
  const d = await db();
  const out = await d.tx(async (q) => {
    await requireUser(q, req, true);
    return adminView(q, new Date());
  });
  return NextResponse.json(out, noStore);
});

export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  const b = await readBody(req);
  const d = await db();
  const out = await d.tx(async (q) => {
    await requireUser(q, req, true);
    const now = new Date();
    switch (b.op) {
      case "create": await createGame(q, { mode: b.mode ?? "daily", intervalMin: b.intervalMin }); break;
      case "start": await startGame(q, now); break;
      case "schedule": await setSchedule(q, now, { mode: b.mode, intervalMin: b.intervalMin }); break;
      case "end": await endGame(q, now); break;
      case "remove": await removeFromLobby(q, now, b.tankId); break;
      case "invite": await q.query("UPDATE settings SET invite_code = $1 WHERE id = 1", [newInviteCode()]); break;
      default: throw new GameError("Unknown admin action.");
    }
    return adminView(q, now);
  });
  return NextResponse.json(out, noStore);
});
