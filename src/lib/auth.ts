// Accounts and sessions: username + password (scrypt), one long-lived session cookie per device.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Q } from "./db";
import { GameError } from "./errors";

export const SESSION_COOKIE = "alliance_session";
export const SESSION_DAYS = 400; // browsers cap cookie lifetimes at about 400 days

export type User = { id: number; username: string; role: "admin" | "player" };

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) => scrypt(pw.normalize("NFKC"), salt, 64, SCRYPT, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64");
  const got = await derive(pw, Buffer.from(salt, "base64"));
  return got.length === want.length && timingSafeEqual(got, want);
}

export const USERNAME_RULE = "2–16 letters, digits or _";
export function checkUsername(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) throw new GameError(`Pick a username of ${USERNAME_RULE}.`);
  return name;
}
export function checkPassword(raw: unknown): string {
  const pw = typeof raw === "string" ? raw : "";
  if (pw.length < 8 || pw.length > 200) throw new GameError("Use a password of 8 or more characters.");
  return pw;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newInviteCode = () => randomBytes(4).toString("hex");

async function hasUsers(q: Q): Promise<boolean> {
  const [{ n }] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  return n > 0;
}

// SETUP_CODE (optional): when it is set, the first account (the admin) must give this code.
// It keeps a new site safe: a stranger who finds the site first cannot become the admin.
const setupCode = () => (process.env.SETUP_CODE ?? "").trim().toLowerCase();

// What the sign-up form must ask for: an invite code (later accounts), or the setup code (the first account, if SETUP_CODE is set).
export async function signupNeeds(q: Q): Promise<{ needsInvite: boolean; setup: boolean }> {
  const first = !(await hasUsers(q));
  return { needsInvite: !first || !!setupCode(), setup: first && !!setupCode() };
}

// The first account becomes the admin. Every later account needs the invite code.
export async function register(q: Q, rawName: unknown, rawPw: unknown, rawCode: unknown): Promise<User> {
  const username = checkUsername(rawName);
  const pw = checkPassword(rawPw);
  const passHash = await hashPassword(pw);
  await q.query("LOCK TABLE users IN EXCLUSIVE MODE");
  const first = !(await hasUsers(q));
  const given = typeof rawCode === "string" ? rawCode.trim().toLowerCase() : "";
  if (first && setupCode() && given !== setupCode()) throw new GameError("That setup code is not correct.");
  if (!first) {
    const [s] = await q.query<{ invite_code: string }>("SELECT invite_code FROM settings WHERE id = 1");
    const code = typeof rawCode === "string" ? rawCode.trim().toLowerCase() : "";
    if (!s || !code || code !== s.invite_code) throw new GameError("That invite code is not correct. Ask the admin for the code.");
  }
  const taken = await q.query("SELECT 1 FROM users WHERE username_key = $1", [username.toLowerCase()]);
  if (taken.length) throw new GameError("That username is taken.");
  const [u] = await q.query<User>(
    "INSERT INTO users (username, username_key, pass_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role",
    [username, username.toLowerCase(), passHash, first ? "admin" : "player"],
  );
  if (first) await q.query("INSERT INTO settings (id, invite_code) VALUES (1, $1) ON CONFLICT (id) DO NOTHING", [newInviteCode()]);
  return u;
}

export async function login(q: Q, rawName: unknown, rawPw: unknown): Promise<User> {
  const name = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";
  const pw = typeof rawPw === "string" ? rawPw : "";
  const [u] = await q.query<User & { pass_hash: string }>(
    "SELECT id, username, role, pass_hash FROM users WHERE username_key = $1", [name]);
  // Always run one scrypt, so a wrong username takes as long as a wrong password.
  const ok = await verifyPassword(pw, u?.pass_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u || !ok) throw new GameError("The username or the password is not correct.");
  return { id: u.id, username: u.username, role: u.role };
}

export async function createSession(q: Q, userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await q.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)", [hashToken(token), userId]);
  return token;
}

export async function userForToken(q: Q, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [u] = await q.query<User>(
    `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.created_at > now() - make_interval(days => $2)`,
    [hashToken(token), SESSION_DAYS],
  );
  return u ?? null;
}

export async function endSession(q: Q, token: string | undefined): Promise<void> {
  if (token) await q.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}
