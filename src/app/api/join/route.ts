import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { currentGame, joinGame, leaveGame } from "@/lib/game";
import { buildView } from "@/lib/view";
import { handle, noStore, readBody, requireUser, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

// In the lobby: join with a flag ({ flag }), change flag, or leave ({ leave: true }).
export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  const b = await readBody(req);
  const d = await db();
  const view = await d.tx(async (q) => {
    const user = await requireUser(q, req);
    const now = new Date();
    if (b.leave === true) await leaveGame(q, now, user);
    else await joinGame(q, now, user, b.flag);
    return buildView(q, user, await currentGame(q), now);
  });
  return NextResponse.json(view, noStore);
});
