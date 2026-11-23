import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { freshGame } from "@/lib/game";
import { buildView } from "@/lib/view";
import { handle, noStore, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

// The signed-in player's view of the game. The page polls this every few seconds.
// Any AP drops that are due happen here first, so no cron job is needed.
export const GET = (req: NextRequest) => handle(async () => {
  const d = await db();
  const view = await d.tx(async (q) => {
    const user = await requireUser(q, req);
    const now = new Date();
    return buildView(q, user, await freshGame(q, now), now);
  });
  return NextResponse.json(view, noStore);
});
