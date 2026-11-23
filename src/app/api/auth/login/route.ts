import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { createSession, login } from "@/lib/auth";
import { handle, readBody, sameOrigin, setSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  const b = await readBody(req);
  const d = await db();
  const user = await login(d, b.username, b.password);
  const token = await createSession(d, user.id);
  return setSession(NextResponse.json({ ok: true }), token);
});
