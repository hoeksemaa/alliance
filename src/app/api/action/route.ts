import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { act, currentGame } from "@/lib/game";
import { buildView } from "@/lib/view";
import { handle, noStore, readBody, requireUser, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

// One game action: move, shoot, give, extend or vote. Returns what happened and the new view.
export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  const b = await readBody(req);
  const d = await db();
  const out = await d.tx(async (q) => {
    const user = await requireUser(q, req);
    const now = new Date();
    const effect = await act(q, now, user, b);
    return { effect, view: await buildView(q, user, await currentGame(q), now) };
  });
  return NextResponse.json(out, noStore);
});
