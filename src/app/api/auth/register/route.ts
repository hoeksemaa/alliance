import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, register, signupNeeds } from "@/lib/auth";
import { handle, readBody, sameOrigin, setSession } from "@/lib/http";

export const dynamic = "force-dynamic";

// Does a new account need a code? Later accounts need the invite code; the first account (the admin) needs SETUP_CODE if it is set.
export const GET = () => handle(async () => {
  const d = await db();
  return NextResponse.json(await signupNeeds(d));
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
