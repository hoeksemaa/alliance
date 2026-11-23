"use client";
import { useCallback, useEffect, useState } from "react";

type AdminData = {
  inviteCode: string;
  users: Array<{ id: number; username: string; role: string }>;
  game: null | { status: "lobby" | "active" | "finished"; apMode: "daily" | "interval"; intervalMin: number; round: number; nextTickAt: string | null };
  players: Array<{ id: number; player: string; flag: string; country: string; alive: boolean }>;
};

const STATUS = { lobby: "Open for players", active: "Running", finished: "Over" };

// The admin page: open, start and end the game, set the AP drop timing, and share the invite code.
// It shows no hearts, range or AP, because the admin is often a player too.
export default function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"daily" | "interval">("daily");
  const [minutes, setMinutes] = useState("60");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const take = useCallback((d: AdminData) => {
    setData(d);
    if (d.game) { setMode(d.game.apMode); setMinutes(String(d.game.intervalMin)); }
  }, []);

  useEffect(() => {
    fetch("/api/admin", { cache: "no-store" }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      take(d);
    }).catch((e) => setError(e.message || "Could not load the admin data."));
  }, [take]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
      take(d);
      setConfirmEnd(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const g = data?.game;
  const open = g && g.status !== "finished";
  const schedule = { mode, intervalMin: Number(minutes) };
  const when = g?.nextTickAt ? new Date(g.nextTickAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="scroll">
      <div className="card-page wide">
        <div className="logo">Alliance</div>
        <div className="btn-row">
          <a className="btn small c-ink" href="/"><span className="lbl">‹ Back to the game</span></a>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data ? (
          <section className="panel pad"><p className="note">Loading…</p></section>
        ) : (
          <>
            <section className="panel pad">
              <h1 className="banner">⚙️ The game</h1>
              {!g || g.status === "finished" ? (
                <>
                  <p className="note">{g ? "The last game is over. Open a new game for the next round of play." : "There is no game yet."} Players can join after you open it.</p>
                  <ScheduleFields mode={mode} minutes={minutes} setMode={setMode} setMinutes={setMinutes} />
                  <button type="button" className="btn wide c-move tilt-r" disabled={busy} onClick={() => post({ op: "create", ...schedule })}>
                    <span className="lbl">Open a new game</span>
                  </button>
                </>
              ) : (
                <>
                  <p className="note">
                    Status: <b>{STATUS[g.status]}</b>
                    {g.status === "active" && <> · {g.apMode === "interval" ? "Round" : "Day"} {g.round + 1}{when && <> · next AP drop: <b>{when}</b></>}</>}
                  </p>
                  {g.status === "lobby" && (
                    <button type="button" className="btn wide c-move tilt-r" disabled={busy || data.players.length < 2} onClick={() => post({ op: "start" })}>
                      <span className="lbl">▶ Start the game ({data.players.length} {data.players.length === 1 ? "player" : "players"})</span>
                    </button>
                  )}
                  {g.status === "lobby" && data.players.length < 2 && <p className="note">At least 2 players must join before you can start.</p>}
                </>
              )}
            </section>

            {open && (
              <section className="panel pad">
                <h2 className="banner">⏱️ AP drops</h2>
                <p className="note">
                  {g.apMode === "daily" ? "Now: each living tank gets 1 AP at 22:00 New York time." : `Now: each living tank gets 1 AP every ${g.intervalMin} ${g.intervalMin === 1 ? "minute" : "minutes"}.`}
                  {" "}A change starts the count again from now. Use short intervals only for tests.
                </p>
                <ScheduleFields mode={mode} minutes={minutes} setMode={setMode} setMinutes={setMinutes} />
                <button type="button" className="btn wide c-extend" disabled={busy} onClick={() => post({ op: "schedule", ...schedule })}>
                  <span className="lbl">Save the AP timing</span>
                </button>
              </section>
            )}

            {g && (
              <section className="panel pad">
                <h2 className="banner">🏳️ Players</h2>
                {data.players.length === 0 ? <div className="chip">Nobody has joined yet.</div> : (
                  <div>
                    {data.players.map((p) => (
                      <div className="admin-row" key={p.id}>
                        <img className="flag-img" src={`/flags/${p.flag}.svg`} alt="" />
                        <span className="grow">{p.player} · {p.country}</span>
                        {g.status !== "lobby" && <span className={`tag-chip${p.alive ? "" : " dead"}`}>{p.alive ? "Alive" : "Jury"}</span>}
                        {g.status === "lobby" && (
                          <button type="button" className="btn small c-cancel" disabled={busy} onClick={() => post({ op: "remove", tankId: p.id })}>
                            <span className="lbl">Remove</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="panel pad">
              <h2 className="banner">🎟️ Invite code</h2>
              <p className="note">New players need this code to make an account. Make a new code to stop the old code.</p>
              <div className="code">{data.inviteCode}</div>
              <button type="button" className="btn wide c-ink" disabled={busy} onClick={() => post({ op: "invite" })}>
                <span className="lbl">Make a new code</span>
              </button>
            </section>

            <section className="panel pad">
              <h2 className="banner">👥 Accounts</h2>
              <div>
                {data.users.map((u) => (
                  <div className="admin-row" key={u.id}>
                    <span className="grow">{u.username}</span>
                    {u.role === "admin" && <span className="tag-chip">Admin</span>}
                  </div>
                ))}
              </div>
            </section>

            {open && (
              <section className="panel pad">
                <h2 className="banner">End the game</h2>
                <p className="note">The game stops at once. Nobody wins. You cannot undo this.</p>
                {confirmEnd ? (
                  <div className="btn-row">
                    <button type="button" className="btn small c-back" disabled={busy} onClick={() => setConfirmEnd(false)}><span className="lbl">Keep playing</span></button>
                    <button type="button" className="btn small c-cancel" disabled={busy} onClick={() => post({ op: "end" })}><span className="lbl">Yes, end the game</span></button>
                  </div>
                ) : (
                  <button type="button" className="btn wide c-cancel" disabled={busy} onClick={() => setConfirmEnd(true)}>
                    <span className="lbl">End the game</span>
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleFields(p: { mode: "daily" | "interval"; minutes: string; setMode: (m: "daily" | "interval") => void; setMinutes: (s: string) => void }) {
  return (
    <div className="seg2">
      <button type="button" className={`btn small ${p.mode === "daily" ? "c-ink" : "c-back"}`} aria-pressed={p.mode === "daily"} onClick={() => p.setMode("daily")}>
        <span className="lbl">Daily at 22:00</span>
      </button>
      <button type="button" className={`btn small ${p.mode === "interval" ? "c-ink" : "c-back"}`} aria-pressed={p.mode === "interval"} onClick={() => p.setMode("interval")}>
        <span className="lbl">Every N minutes</span>
      </button>
      {p.mode === "interval" && (
        <label className="field" style={{ gridAutoFlow: "column", alignItems: "center" }}>
          <input className="input" type="number" min={1} max={1440} value={p.minutes} onChange={(e) => p.setMinutes(e.target.value)} aria-label="Minutes between AP drops" />
          <span>min</span>
        </label>
      )}
    </div>
  );
}
