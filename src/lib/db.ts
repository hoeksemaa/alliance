// One small database layer for two drivers:
// - production: Postgres (Neon) through `pg`, when DATABASE_URL is set;
// - local development and tests: PGlite, a Postgres that runs inside Node (PGLITE_DIR = a folder, or in memory).
import { SCHEMA } from "./schema";

export type Row = Record<string, any>;
export interface Q {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

export async function openPg(url: string): Promise<Db> {
  const { Pool } = (await import("pg")).default;
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000 });
  const run = async <T extends Row>(c: { query: Function }, text: string, params?: unknown[]) =>
    ((await c.query(text, params)) as { rows: T[] }).rows;
  return {
    query: (text, params) => run(pool, text, params),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn({ query: (text, params) => run(c, text, params) });
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    query: async (text, params) => (await pg.query(text, params as any[])).rows as any[],
    tx: (fn) => pg.transaction((t) => fn({ query: async (text, params) => (await t.query(text, params as any[])).rows as any[] })),
  };
}

// Make the tables if they do not exist. The advisory lock stops two new server instances from doing this at the same time.
export async function migrate(d: Db): Promise<void> {
  await d.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(812734)");
    for (const stmt of SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
  });
}

// One shared connection per server process (kept on globalThis so that hot reload in development does not open more).
const g = globalThis as unknown as { __allianceDb?: Promise<Db> };
export function db(): Promise<Db> {
  if (!g.__allianceDb) {
    g.__allianceDb = (async () => {
      const url = process.env.DATABASE_URL;
      if (!url && process.env.VERCEL) throw new Error("DATABASE_URL is not set.");
      const d = url ? await openPg(url) : await openPglite(process.env.PGLITE_DIR || ".data/pglite");
      await migrate(d);
      return d;
    })();
    g.__allianceDb.catch(() => { g.__allianceDb = undefined; });
  }
  return g.__allianceDb;
}
