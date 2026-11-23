import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, needsInvite, register } from "@/lib/auth";
import { handle, readBody, sameOrigin, setSession } from "@/lib/http";

export const dynamic = "force-dynamic";

// Does a new account need an invite code? (No, for the very first account: it becomes the admin.)
export const GET = () => handle(async () => {
  const d = await db();
  return NextResponse.json({ needsInvite: await needsInvite(d) });
});

export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  const b = await readBody(req);
  const d = await db();
  const token = await d.tx(async (q) => {
    const user = await register(q, b.username, b.password, b.invite);
    return createSession(q, user.id);
  });
  return setSession(NextResponse.json({ ok: true }), token);
});
