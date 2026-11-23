import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, endSession } from "@/lib/auth";
import { handle, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = (req: NextRequest) => handle(async () => {
  sameOrigin(req);
  await endSession(await db(), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
