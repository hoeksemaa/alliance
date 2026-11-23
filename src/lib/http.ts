// Small helpers for the API routes.
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db, type Q } from "./db";
import { GameError } from "./errors";
import { SESSION_COOKIE, SESSION_DAYS, userForToken, type User } from "./auth";

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GameError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on the server. Try again." }, { status: 500 });
  }
}

// A cross-site form can't send our cookie (SameSite=Lax), but check the Origin header as well.
export function sameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new GameError("This request came from another site.", 403);
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function requireUser(q: Q, req: NextRequest, admin = false): Promise<User> {
  const user = await userForToken(q, req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) throw new GameError("Sign in first.", 401);
  if (admin && user.role !== "admin") throw new GameError("Only the admin can do that.", 403);
  return user;
}

export function setSession(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

// For server components (pages): the signed-in user, or null.
export async function pageUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForToken(await db(), token);
}

export const noStore = { headers: { "Cache-Control": "no-store" } };
