// The game screen: "no game", the lobby (flag picker), and the board with its HUD, action panel, sheets and tour.
// Plain JS, ported from the final design draft (design/draft-1.html), so the animations stay imperative.
// The server sends a "view" (only what this player may see: see src/lib/view.ts); this file draws it and sends actions.

const N = 20;
const COLS = "ABCDEFGHIJKLMNOPQRST";
const HOLD_MS = 520;
const POLL_MS = 5000;
const COST = { move: 1, attack: 1, give: 1, extend: 2 }; // "attack" is the Shoot action
const DIR_NAME = { "0,-1": "up", "0,1": "down", "-1,0": "left", "1,0": "right" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const img = (code, cls) => `<img class="flag-img${cls ? " " + cls : ""}" src="/flags/${esc(code)}.svg" alt="">`;
const who = (t) => `${esc(t.player)}<span class="cty"> · ${esc(t.country)}</span>`;
const coord = (x, y) => COLS[x] + (y + 1);
const inBoard = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
// Range: the square of size R around the tank, plus one more square straight out from the middle of each side.
const inRange = (cx, cy, x, y, R) => {
  const dx = Math.abs(cx - x), dy = Math.abs(cy - y);
  return Math.max(dx, dy) <= R || ((dx === 0 || dy === 0) && dx + dy <= R + 1);
};
// a glossy heart: full = red with a dark edge and a shine; empty = a hollow slot
const heartSvg = (full) => `<svg viewBox="-.5 -.5 21 19" aria-hidden="true"><path d="M10 17 C4 12.5 1 9.5 1 5.8 C1 3 3.2 1 5.6 1 C7.6 1 9 2.2 10 3.8 C11 2.2 12.4 1 14.4 1 C16.8 1 19 3 19 5.8 C19 9.5 16 12.5 10 17 Z" fill="${full ? "var(--heart)" : "var(--panel-2)"}" stroke="${full ? "var(--heart-edge)" : "var(--edge-lip)"}" stroke-width="1.8" stroke-linejoin="round"/>${full ? `<ellipse cx="5.8" cy="5.6" rx="2" ry="1.3" fill="#fff" opacity=".7" transform="rotate(-35 5.8 5.6)"/>` : ""}</svg>`;
// Only touch the DOM when the markup really changed (keeps scroll positions, focus and running animations).
const setHtml = (el, html) => { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } };

class SignedOut extends Error {}
async function api(path, body) {
  const res = await fetch(path, body === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { location.href = "/login"; throw new SignedOut(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

const NONE_HTML = `
<div class="scroll"><div class="card-page">
  <div class="logo">Alliance</div>
  <section class="panel pad">
    <h2 class="banner">No game yet</h2>
    <p class="note" id="none-note"></p>
    <div class="stack" id="none-actions"></div>
  </section>
</div></div>`;

const LOBBY_HTML = `
<div class="scroll"><div class="card-page wide">
  <div class="logo">Alliance</div>
  <section class="panel pad">
    <h2 class="banner">🏳️ Pick your flag</h2>
    <p class="note" id="lobby-note"></p>
    <input class="input" id="flag-search" type="search" placeholder="Search for a country" autocomplete="off" aria-label="Search for a country">
    <div class="flag-grid" id="flag-grid"></div>
  </section>
  <section class="panel pad">
    <h2 class="banner">Players</h2>
    <div class="jurors" id="lobby-players"></div>
    <p class="note">The admin starts the game when everyone has joined. This page updates by itself.</p>
    <p class="form-error" id="lobby-error" hidden></p>
    <div class="btn-row" id="lobby-actions"></div>
  </section>
</div></div>`;

const GAME_HTML = `
<div class="app" id="app">
  <header class="hud" id="hud" aria-label="Your tank"><div class="hud-in">
    <div class="me" id="me"><img class="flag-img flag-card" id="me-flag" alt=""><span class="hearts" id="hearts"></span></div>
    <div class="stat" id="stat-ap"><span>AP:</span><b class="num n-ap" id="ap"></b></div>
    <div class="stat" id="stat-rng"><span>Range:</span><b class="num n-rng" id="rng"></b></div>
    <div class="timer" id="timer"><span id="timer-label">Next AP</span><b id="cd">--:--:--</b></div>
  </div></header>
  <div class="stage">
    <div class="chart" id="chart">
      <div class="cols" id="cols"></div>
      <div class="rows" id="rows"></div>
      <div class="board" id="board" aria-label="Board">
        <div class="gridlines"></div>
        <svg class="zone" id="zone" aria-hidden="true"></svg>
        <div class="pieces" id="pieces"></div>
        <svg class="lines" id="lines" aria-hidden="true"></svg>
        <div class="fx" id="fx" aria-hidden="true"></div>
      </div>
    </div>
  </div>
  <footer class="footer">
    <nav class="tabs" id="tabs" aria-label="Menu">
      <button type="button" class="tab" data-tab="actions" aria-expanded="false"><span class="ico" aria-hidden="true">⚔️</span><span class="t">Actions</span></button>
      <button type="button" class="tab" data-tab="news" aria-expanded="false"><span class="ico" aria-hidden="true">📰</span><span class="t">News</span><span class="badge" data-badge="news" hidden></span></button>
      <button type="button" class="tab" data-tab="you" aria-expanded="false"><span class="ico" aria-hidden="true">📬</span><span class="t">You</span><span class="badge" data-badge="you" hidden></span></button>
      <button type="button" class="tab" data-tab="jury" aria-expanded="false"><span class="ico" aria-hidden="true">⚖️</span><span class="t">Jury</span></button>
      <button type="button" class="tab" data-tab="settings" aria-expanded="false"><span class="ico" aria-hidden="true">⚙️</span><span class="t">Settings</span></button>
      <button type="button" class="tab" data-tour><span class="ico" aria-hidden="true">❓</span><span class="t">Tour</span></button>
    </nav>
  </footer>
  <section class="tray panel" id="tray" aria-label="Actions" inert></section>
</div>
<div id="sheet-root">
  <div class="scrim" id="scrim"></div>
  <section class="sheet panel" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="sheet-head"><h2 class="banner" id="sheet-title"></h2></div>
    <div class="sheet-body" id="sheet-body"></div>
    <div class="sheet-foot"><button type="button" class="btn nav c-cancel" data-close><span class="lbl">✕ Close</span></button></div>
  </section>
</div>
<div class="tour" id="tour" hidden>
  <div class="spot" id="spot"></div>
  <div class="tour-card panel" id="tour-card" role="dialog" aria-modal="true" aria-live="polite"></div>
</div>`;

export function mountGame(root, { countries }) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const html = document.documentElement;
  const $ = (id) => root.querySelector("#" + id);

  let V = null;            // the last view from the server
  let skew = 0;            // server clock minus local clock, in ms
  let screen = "";         // "none" | "lobby" | "game"
  let dead = false;        // unmounted
  let busy = false;        // an action is on its way to the server
  let polling = false;
  let tickPolled = "";     // the AP drop we already asked the server about
  let ro = null;           // ResizeObserver for the board
  let shown = "";          // which action panel is on screen (to deal it in once)
  let prevStats = null;
  let search = "";
  const S = { panel: null, pick: null, sel: null, move: null, sheet: null, newSince: 0 };
  let T = null;            // the tour
  let H = null;            // a press-and-hold in progress

  // ---------- derived state ----------
  const mine = () => V.myTank;
  const isJuror = () => !!(V.myTank && !V.myTank.alive);
  const isSpectator = () => !V.myTank;
  const over = () => !!V.game && V.game.status === "finished";
  const living = () => V.board;
  const myPiece = () => (V.myTank && V.myTank.alive ? V.board.find((t) => t.id === V.myTank.id) || null : null);
  const at = (x, y) => living().find((t) => t.x === x && t.y === y);
  const inReach = () => {
    const m = myPiece();
    return m ? living().filter((t) => t.id !== m.id && inRange(m.x, m.y, t.x, t.y, V.myTank.range)) : [];
  };
  const canAct = () => !!myPiece() && !over();
  const myVote = () => (V.jury && V.myTank ? (V.jury.votes.find((v) => v.juror === V.myTank.id) || {}).target ?? null : null);
  const voteCounts = () => {
    const c = {};
    for (const v of (V.jury && V.jury.votes) || []) c[v.target] = (c[v.target] || 0) + 1;
    return c;
  };
  const clearAim = () => { S.panel = null; S.pick = null; S.sel = null; S.move = null; };
  const trayOpen = () => !!S.panel;
  const dropWord = () => (V.game && V.game.apMode === "interval" ? `every ${V.game.intervalMin} min` : "at 22:00 New York time");

  // ---------- unread counts (kept per device) ----------
  const seenGet = (k) => { try { const v = localStorage.getItem("alliance-seen-" + k); return v === null ? null : Number(v); } catch (_) { return 0; } };
  const seenSet = (k, id) => { try { localStorage.setItem("alliance-seen-" + k, String(id)); } catch (_) {} };
  const listOf = (k) => (k === "news" ? V.news : V.log);
  const maxId = (list) => list.reduce((m, e) => Math.max(m, e.id), 0);
  const unread = (k) => { const s = seenGet(k) ?? 0; return listOf(k).filter((e) => e.id > s).length; };
  const initSeen = () => { for (const k of ["news", "you"]) if (seenGet(k) === null) seenSet(k, maxId(listOf(k))); };

  // ---------- data in, screens out ----------
  function apply(view, animate) {
    const prev = V;
    V = view;
    skew = Date.parse(view.serverNow) - Date.now();
    initSeen();
    draw();
    if (animate && prev && prev.game && screen === "game" && prev.game.status !== "lobby") diffAnimate(prev, view);
  }
  async function refresh() {
    try { apply(await api("/api/state"), false); } catch (e) { if (!(e instanceof SignedOut)) console.warn(e); }
  }
  async function poll() {
    if (polling || busy || H || dead || document.hidden) return;
    polling = true;
    try {
      const v = await api("/api/state");
      if (!busy && !H && !dead) apply(v, true);
    } catch (_) { /* a network hiccup: the next poll tries again */ } finally { polling = false; }
  }
  function draw() {
    if (!V.game) { setScreen("none"); renderNone(); }
    else if (V.game.status === "lobby") { setScreen("lobby"); renderLobby(); }
    else { setScreen("game"); render(); }
  }
  function setScreen(name) {
    if (screen === name) return;
    if (ro) { ro.disconnect(); ro = null; }
    screen = name; T = null; H = null; shown = ""; prevStats = null;
    clearAim(); S.sheet = null;
    root.innerHTML = name === "game" ? GAME_HTML : name === "lobby" ? LOBBY_HTML : NONE_HTML;
    if (name === "game") initGame();
  }

  // ---------- shared buttons ----------
  async function signOut() {
    try { await api("/api/auth/logout", {}); } catch (_) {}
    location.href = "/login";
  }
  const accountButtons = () =>
    (V.me.admin ? `<button type="button" class="btn small c-ink" data-go="/admin"><span class="lbl">⚙️ Admin page</span></button>` : "") +
    `<button type="button" class="btn small c-back tilt-r" data-signout><span class="lbl">Sign out</span></button>`;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go], [data-signout], [data-flag], [data-leave]");
    if (!b || b.disabled) return;
    if (b.dataset.go) location.href = b.dataset.go;
    else if (b.hasAttribute("data-signout")) signOut();
    else if (b.dataset.flag) lobbyPost({ flag: b.dataset.flag });
    else if (b.hasAttribute("data-leave")) lobbyPost({ leave: true });
  });

  // ---------- no game ----------
  function renderNone() {
    setHtml($("none-note"), V.me.admin
      ? "Open a new game on the admin page. Then share the invite code with your friends."
      : "The admin has not opened a game yet. This page updates by itself.");
    setHtml($("none-actions"), accountButtons());
  }

  // ---------- lobby ----------
  async function lobbyPost(body) {
    const err = $("lobby-error");
    try {
      busy = true;
      apply(await api("/api/join", body), false);
      if (err) err.hidden = true;
    } catch (e) {
      if (err && !(e instanceof SignedOut)) { err.textContent = e.message; err.hidden = false; }
    } finally { busy = false; }
  }
  function renderLobby() {
    const my = V.myTank;
    setHtml($("lobby-note"), my
      ? `Your flag: <b>${esc(my.country)}</b>. You can change it until the game starts.`
      : "Each flag belongs to one player. Pick yours to join the game.");
    const owner = new Map(V.players.map((p) => [p.flag, p]));
    const q = search.trim().toLowerCase();
    const list = countries.filter(([code, name]) => !q || name.toLowerCase().includes(q) || code === q);
    setHtml($("flag-grid"), list.length ? list.map(([code, name]) => {
      const o = owner.get(code), isMine = my && my.flag === code;
      return `<button type="button" class="flag-pick${isMine ? " mine" : ""}" data-flag="${code}" aria-pressed="${!!isMine}" ${o && !isMine ? "disabled" : ""}>${img(code)}<span>${esc(name)}</span>${o ? `<small>${isMine ? "You" : esc(o.player)}</small>` : ""}</button>`;
    }).join("") : `<div class="chip">No country matches “${esc(search)}”.</div>`);
    setHtml($("lobby-players"), V.players.length
      ? V.players.map((p) => `<span class="mini">${img(p.flag)}${esc(p.player)}</span>`).join("")
      : `<div class="chip">Nobody has joined yet.</div>`);
    setHtml($("lobby-actions"), (my ? `<button type="button" class="btn small c-back" data-leave><span class="lbl">Leave the game</span></button>` : "") + accountButtons());
  }
  root.addEventListener("input", (e) => {
    if (e.target.id === "flag-search") { search = e.target.value; renderLobby(); }
  });

  // ---------- the game screen ----------
  function initGame() {
    $("cols").innerHTML = [...COLS].map((c) => `<span>${c}</span>`).join("");
    $("rows").innerHTML = Array.from({ length: N }, (_, i) => `<span>${i + 1}</span>`).join("");
    const board = $("board"), app = $("app");
    const align = () => {
      const a = app.getBoundingClientRect(), b = board.getBoundingClientRect();
      app.style.setProperty("--gx", (b.left - a.left).toFixed(1) + "px");
      app.style.setProperty("--gw", b.width.toFixed(1) + "px");
    };
    ro = new ResizeObserver(() => { align(); renderShapes(); placeTour(); });
    ro.observe(board); ro.observe(app);
    initBoardInput(board);
    initTray($("tray"));
    $("tabs").addEventListener("click", (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) return t.dataset.tab === "actions" ? openMenu() : openSheet(t.dataset.tab);
      if (e.target.closest("[data-tour]")) startTour();
    });
    $("scrim").addEventListener("click", closeSheet);
    $("sheet").addEventListener("click", (e) => {
      const q = (s) => e.target.closest(s);
      let b;
      if (q("[data-close]")) closeSheet();
      else if ((b = q("[data-theme-set]"))) setMode(b.dataset.themeSet);
    });
    $("tour").addEventListener("click", (e) => {
      const q = (s) => e.target.closest(s);
      if (q("[data-tour-next]")) { if (T.i === STEPS.length - 1) endTour(); else { T.i++; renderTour(); } }
      else if (q("[data-tour-back]")) { T.i--; renderTour(); }
      else if (q("[data-tour-skip]")) endTour();
    });
    align();
  }

  function normalize() {
    if (S.panel === "target" && !living().some((t) => t.id === S.sel)) { S.sel = null; S.panel = S.pick ? "pick" : null; }
    if (S.panel && S.panel !== "menu" && (over() || isSpectator())) clearAim();
    if (S.panel && !isJuror() && !canAct() && S.panel !== "menu") clearAim();
  }
  function render() { normalize(); renderHud(); renderBoard(); renderTray(); renderTabs(); renderSheet(); tick(); }

  // ---------- range outline ----------
  function outline(cx, cy, R, cell) {
    const inside = (x, y) => inBoard(x, y) && inRange(cx, cy, x, y, R);
    const next = new Map();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) next.set(`${x},${y}`, [x + 1, y]);
      if (!inside(x + 1, y)) next.set(`${x + 1},${y}`, [x + 1, y + 1]);
      if (!inside(x, y + 1)) next.set(`${x + 1},${y + 1}`, [x, y + 1]);
      if (!inside(x - 1, y)) next.set(`${x},${y + 1}`, [x, y]);
    }
    let d = "";
    while (next.size) {
      const start = next.keys().next().value;
      let k = start, pts = [];
      do { pts.push(k.split(",").map(Number)); const n = next.get(k); next.delete(k); k = n.join(","); } while (k !== start && next.has(k));
      pts = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
      });
      d += "M" + pts.map(([x, y]) => `${(x * cell).toFixed(1)} ${(y * cell).toFixed(1)}`).join(" L") + " Z ";
    }
    return d;
  }
  function renderShapes() {
    if (screen !== "game" || !V) return;
    const W = $("board").clientWidth || 360, cell = W / N;
    const boil = still.matches ? "" : `<animate attributeName="seed" values="1;2;3;4;5;6" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/>`;
    const defs = `<defs><filter id="boil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="${(0.9 / cell).toFixed(4)}" numOctaves="1" seed="1">${boil}</feTurbulence><feDisplacementMap in="SourceGraphic" scale="${Math.min(3.2, cell / 7).toFixed(2)}" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
    let zone = "", lines = "";
    const m = myPiece();
    if (m) {
      const R = V.myTank.range;
      const now = outline(m.x, m.y, R, cell);
      let prev = null, kind = "";
      if (S.panel === "move" && S.move) { prev = outline(S.move.x, S.move.y, R, cell); kind = "move"; }
      else if (S.panel === "extend") { prev = outline(m.x, m.y, R + 1, cell); kind = "extend"; }
      zone = `<path d="${kind === "move" ? prev : now}"/>`;
      lines = `<path class="now ${prev ? "faint" : ""}" d="${now}" filter="url(#boil)"/>` + (prev ? `<path class="preview ${kind}" d="${prev}" filter="url(#boil)"/>` : "");
    }
    for (const id of ["zone", "lines"]) $(id).setAttribute("viewBox", `0 0 ${W} ${W}`);
    setHtml($("zone"), zone);
    setHtml($("lines"), defs + lines);
  }

  // ---------- board ----------
  const pos = (x, y) => `left:${x * 5}%;top:${y * 5}%`;
  function renderBoard() {
    const counts = isJuror() ? voteCounts() : {};
    const sel = S.panel === "target" ? living().find((t) => t.id === S.sel) : null;
    const cands = canAct() && S.panel === "pick" ? new Set(inReach().map((t) => t.id)) : null;
    const m = myPiece();
    let h = "";
    for (const t of living()) {
      const c = ["piece"];
      if (m && t.id === m.id) c.push("you");
      if (cands && cands.has(t.id)) c.push("cand", S.pick);
      if (sel && t.id === sel.id) {
        c.push("picked");
        if (isJuror()) c.push("vote");
        else if (m && !inRange(m.x, m.y, t.x, t.y, V.myTank.range)) c.push("far");
      }
      const badge = counts[t.id] ? `<span class="votes">${counts[t.id]}</span>` : "";
      const nm = `<span class="nm ${t.y === N - 1 ? "up" : ""} ${t.x === 0 ? "l" : t.x === N - 1 ? "r" : ""}">${esc(t.player)}</span>`;
      h += `<span class="${c.join(" ")}" data-id="${t.id}" style="${pos(t.x, t.y)}">${img(t.flag)}${nm}${badge}</span>`;
    }
    if (m && S.panel === "move" && S.move) h += `<span class="piece ghost" style="${pos(S.move.x, S.move.y)}">${img(m.flag)}</span>`;
    setHtml($("pieces"), h);
    renderShapes();
  }

  // ---------- effects ----------
  function fx(kind, x, y, text, color, extra) {
    if (still.matches || screen !== "game") return;
    const d = document.createElement("div");
    d.className = "fx-" + kind + (extra ? " " + extra : "");
    d.style.left = (kind === "tag" ? Math.min(Math.max(x + 0.5, 3.5), 16.5) : x + 0.5) * 5 + "%";
    d.style.top = (kind === "tag" ? Math.max(0.8, y - 0.4) : y + 0.5) * 5 + "%";
    if (color) d.style.setProperty("--c", color);
    if (text) d.textContent = text;
    $("fx").appendChild(d);
    setTimeout(() => d.remove(), kind === "tag" ? 1700 : 1200);
  }
  const cpct = (v) => (v + 0.5) * 5;
  const pieceEl = (id) => $("pieces").querySelector(`[data-id="${id}"]`);
  function addFx(cls, x, y, color) {
    const d = document.createElement("div");
    d.className = cls;
    d.style.left = cpct(x) + "%"; d.style.top = cpct(y) + "%";
    if (color) d.style.setProperty("--c", color);
    $("fx").appendChild(d);
    return d;
  }
  // Shoot and Give AP: the tank kicks back, a muzzle flash, then a tracer flies straight and fast to the target.
  function shot(from, to, color, done) {
    if (still.matches || screen !== "game") return done();
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const gun = pieceEl(from.id);
    if (gun) gun.animate([{ transform: "none" }, { transform: `translate(${-ux * 22}%, ${-uy * 22}%)`, offset: 0.25 }, { transform: "none" }], { duration: 260, easing: "ease-out" });
    const flash = addFx("fx-muzzle", from.x + ux * 0.6, from.y + uy * 0.6, color);
    setTimeout(() => flash.remove(), 260);
    const d = addFx("fx-tracer", from.x + ux * 0.5, from.y + uy * 0.5, color);
    d.style.transformOrigin = "0 0";
    d.style.transform = `rotate(${Math.atan2(dy, dx)}rad) translate(-100%, -50%)`;
    d.animate([{ left: d.style.left, top: d.style.top }, { left: cpct(to.x) + "%", top: cpct(to.y) + "%" }],
      { duration: 70 + dist * 18, easing: "linear" }).onfinish = () => { d.remove(); done(); };
  }
  function burst(x, y, color, big) {
    if (still.matches || screen !== "game") return;
    const d = addFx("fx-burst" + (big ? " big" : ""), x, y, color);
    setTimeout(() => d.remove(), 800);
  }
  function bump(id) {
    const el = pieceEl(id);
    if (el && !still.matches) el.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.34, 1.56, .64, 1)" });
  }
  function rattle(id) {
    const el = pieceEl(id);
    if (el && !still.matches) el.animate([{ translate: "0 0" }, { translate: "-16% 0" }, { translate: "13% 0" }, { translate: "-8% 0" }, { translate: "4% 0" }, { translate: "0 0" }], { duration: 380, easing: "ease-out" });
  }
  function slide(id, x0, y0, x1, y1) {
    const el = pieceEl(id);
    if (el && !still.matches) el.animate([{ transform: `translate(${(x0 - x1) * 100}%, ${(y0 - y1) * 100}%)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2, .9, .3, 1.15)" });
  }
  function pulse(x, y, R, color) {
    if (still.matches || screen !== "game") return;
    const d = addFx("fx-pulse", x, y, color);
    d.animate([{ width: "5%", opacity: 1 }, { width: (2 * R + 1) * 5 + "%", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.2, .8, .3, 1)" }).onfinish = () => d.remove();
  }
  function vanish(t) {
    if (still.matches || screen !== "game") return;
    const d = addFx("fx-vanish", t.x, t.y, "");
    d.innerHTML = img(t.flag);
    d.animate([
      { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1 },
      { transform: "translate(-50%, -50%) scale(1.35) rotate(-14deg)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -50%) scale(0) rotate(170deg)", opacity: 0 },
    ], { duration: 600, easing: "cubic-bezier(.5, 0, .75, 0)" }).onfinish = () => d.remove();
  }
  function debris(x, y, color) {
    if (still.matches || screen !== "game") return;
    for (let i = 0; i < 12; i++) {
      const d = addFx("fx-bit", x, y, i % 3 ? color : "#ffffff");
      const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.5, far = 20 + Math.random() * 26;
      d.animate([
        { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${(Math.cos(a) * far).toFixed(1)}px), calc(-50% + ${(Math.sin(a) * far).toFixed(1)}px)) rotate(${Math.round((Math.random() - 0.5) * 600)}deg)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 300, easing: "cubic-bezier(.15, .7, .3, 1)" }).onfinish = () => d.remove();
    }
  }
  function destroyedFx(t) {
    vanish(t); burst(t.x, t.y, "var(--attack)", true); debris(t.x, t.y, "var(--attack)");
  }
  const vibe = () => { if (navigator.vibrate) try { navigator.vibrate(18); } catch (_) {} };
  function squish(kind) {
    const b = root.querySelector(`[data-hold="${kind}"]`);
    if (b) { b.classList.remove("press"); void b.offsetWidth; b.classList.add("press"); }
  }
  // Other players' moves and deaths arrive with the poll: animate them too.
  function diffAnimate(prev, next) {
    const before = new Map(prev.board.map((t) => [t.id, t]));
    for (const t of next.board) {
      const p = before.get(t.id);
      if (p && (p.x !== t.x || p.y !== t.y)) slide(t.id, p.x, p.y, t.x, t.y);
    }
    for (const p of prev.board) if (!next.board.some((t) => t.id === p.id)) destroyedFx(p);
    const a = prev.myTank, b = next.myTank, m = myPiece();
    if (a && b && m && b.alive && b.hearts < a.hearts) { rattle(m.id); fx("text", m.x, m.y, "Hit!", "var(--attack)"); }
  }

  // ---------- HUD (read-only) ----------
  const popIf = (el, changed) => { if (changed) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); } };
  function hudFloat(el, text) {
    if (still.matches) return;
    const f = document.createElement("i");
    f.className = "hud-float";
    f.textContent = text;
    el.parentElement.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }
  function renderHud() {
    const t = mine();
    const flag = $("me-flag");
    flag.hidden = !t;
    if (t && flag.getAttribute("src") !== `/flags/${t.flag}.svg`) { flag.src = `/flags/${t.flag}.svg`; flag.alt = `Your flag: ${t.country}`; }
    setHtml($("hearts"), !t ? `<span class="watch">Watching</span>`
      : !t.alive ? `<span class="dead">Destroyed</span>`
      : [0, 1, 2].map((i) => heartSvg(i < t.hearts)).join(""));
    const showStats = !!t && t.alive;
    $("stat-ap").hidden = !showStats;
    $("stat-rng").hidden = !showStats;
    if (showStats) {
      $("ap").textContent = t.ap;
      $("rng").textContent = t.range;
      if (prevStats) {
        popIf($("ap"), prevStats.ap !== t.ap);
        popIf($("rng"), prevStats.range !== t.range);
        if (t.ap !== prevStats.ap) hudFloat($("ap"), (t.ap > prevStats.ap ? "+" : "−") + Math.abs(t.ap - prevStats.ap));
      }
      prevStats = { ap: t.ap, range: t.range };
    }
    $("timer-label").textContent = over() ? (V.game.winner ? "Winner" : "Game over") : isJuror() ? "Vote closes" : "Next AP";
  }
  function tick() {
    if (screen !== "game" || !V || !V.game) return;
    const cd = $("cd");
    if (over()) { cd.textContent = V.game.winner ? V.game.winner.player : "No winner"; return; }
    if (!V.game.nextTickAt) { cd.textContent = "--:--:--"; return; }
    let left = Math.max(0, Math.round((Date.parse(V.game.nextTickAt) - (Date.now() + skew)) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    cd.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
    // The AP drop is due: ask the server (once), which applies it.
    if (left === 0 && tickPolled !== V.game.nextTickAt) { tickPolled = V.game.nextTickAt; setTimeout(poll, 1200); }
  }

  // ---------- action panel ----------
  // Text rule: show only what the screen does not already show (AP and range are in the HUD; the board shows positions).
  const holdBtn = (kind, label, cost, ok, tilt) =>
    `<button type="button" class="btn hold c-${kind} ${tilt ? "tilt-r" : ""}" data-hold="${kind}" ${ok ? "" : "disabled"}><span class="fill"></span><span class="lbl">${label}</span><span class="cost">${cost}</span></button>`;
  const pickRow = (list, empty) => list.length
    ? `<div class="pick-row">${list.map((t) => `<button type="button" class="pick" data-target="${t.id}" aria-label="${esc(t.player)}, ${esc(t.country)}">${img(t.flag)}<span>${esc(t.player)}</span></button>`).join("")}</div>`
    : `<div class="chip">${empty}</div>`;
  const nav = (back) => `<div class="tray-nav">${back ? `<button type="button" class="btn nav c-back" data-back><span class="lbl">‹ Back</span></button>` : ""}<button type="button" class="btn nav c-cancel" data-cancel><span class="lbl">✕ Cancel</span></button></div>`;
  const lead = (k, ico) => `<span class="lead c-${k}" aria-hidden="true">${ico}</span>`;
  function renderTray() {
    const sel = living().find((t) => t.id === S.sel);
    const key = S.panel ? `${S.panel}:${S.pick || ""}:${S.panel === "target" ? S.sel : ""}` : "";
    const fresh = !!key && shown !== key;
    const dl = fresh ? " deal" : "";
    const headRow = (first, title, meta, metaCls) =>
      `<div class="tray-head${dl}">${first}<div><div class="title">${title}</div>${meta ? `<div class="meta ${metaCls || ""}">${meta}</div>` : ""}</div></div>`;
    let head = "", actions = "", back = false, hand = false, open = !!S.panel;
    const ap = V.myTank ? V.myTank.ap : 0;
    if (S.panel && over()) {
      actions = `<div class="chip">🏆 The game is over. The News has the whole story.</div>`;
    } else if (S.panel && isSpectator()) {
      actions = `<div class="chip">You are not in this game. You can watch the board and the News.</div>`;
    } else if (isJuror()) {
      const voted = myVote();
      if (S.panel === "target" && sel) {
        const n = voteCounts()[sel.id] || 0;
        head = headRow(img(sel.flag, "flag-card"), who(sel), `${n} ${n === 1 ? "vote" : "votes"} tonight`);
        actions = voted === sel.id
          ? `<div class="chip">✓ Your vote</div>`
          : `<button type="button" class="btn c-vote" data-vote><span class="lbl">🗳️ Vote</span><span class="cost">free</span></button>`;
        back = true;
      } else if (S.panel) {
        const v = living().find((t) => t.id === voted);
        head = headRow(lead("vote", "🗳️"), "Pick a tank to vote for", v ? `your vote: ${esc(v.player)}` : "");
        actions = pickRow(living(), "No living tanks.");
      }
    } else if (S.panel === "menu") {
      hand = true;
      const card = (k, ico, label, cost, i) => `<button type="button" class="btn card c-${k}" style="--i:${i}" data-open="${k}" ${ap >= cost ? "" : "disabled"}><span class="tag">${cost} AP</span><span class="ti" aria-hidden="true">${ico}</span><span class="tl">${label}</span></button>`;
      actions = card("move", "🧭", "Move", 1, 0) + card("attack", "💥", "Shoot", 1, 1) + card("give", "🎁", "Give AP", 1, 2) + card("extend", "📡", "Extend", 2, 3);
    } else if (S.panel === "move") {
      const m = myPiece(), aimed = !!S.move;
      const d = aimed && m ? `${S.move.x - m.x},${S.move.y - m.y}` : "";
      const arrow = (dir, ch, name) => `<button type="button" class="btn arrow ${d === dir ? "on" : ""}" data-dir="${dir}" aria-label="Aim ${name}">${ch}</button>`;
      head = headRow(lead("move", "🧭"), aimed ? `Destination: ${coord(S.move.x, S.move.y)}` : "Pick a direction");
      actions = `<div class="dpad">${arrow("-1,0", "←", "left")}${arrow("0,-1", "↑", "up")}${arrow("0,1", "↓", "down")}${arrow("1,0", "→", "right")}</div>` + holdBtn("move", "Move", "1 AP", aimed && ap >= COST.move);
      back = true;
    } else if (S.panel === "pick") {
      head = headRow(lead(S.pick, S.pick === "attack" ? "💥" : "🎁"), S.pick === "attack" ? "Pick a tank to shoot" : "Pick a tank to give 1 AP");
      actions = pickRow(inReach(), "No tank is in range.");
      back = true;
    } else if (S.panel === "target" && sel) {
      const m = myPiece();
      const inR = !!m && inRange(m.x, m.y, sel.x, sel.y, V.myTank.range);
      const ok = inR && ap >= 1;
      head = headRow(img(sel.flag, "flag-card"), who(sel), inR ? "" : "out of range", "bad");
      const atk = holdBtn("attack", "💥 Shoot", "1 AP", ok), give = holdBtn("give", "🎁 Give", "1 AP", ok, true);
      actions = S.pick === "attack" ? atk : S.pick === "give" ? give : atk + give;
      back = true;
    } else if (S.panel === "extend") {
      head = headRow(lead("extend", "📡"), `Range ${V.myTank.range} → ${V.myTank.range + 1}`, "the long-dash line shows the new range");
      actions = holdBtn("extend", "📡 Extend", "2 AP", ap >= COST.extend);
      back = true;
    } else open = false;
    const tray = $("tray");
    tray.classList.toggle("open", open);
    tray.inert = !open;
    const cls = hand ? "tray-actions hand" + (fresh ? " dealt" : "") : "tray-actions" + dl;
    if (open) setHtml(tray, `${head}<div class="${cls}">${actions}</div>${nav(back)}`);
    shown = open ? key : "";
  }

  function openMenu() { S.panel = "menu"; S.pick = null; S.sel = null; S.move = null; S.sheet = null; render(); }
  function openAction(k) {
    if (!canAct()) return;
    S.sheet = null; S.sel = null; S.move = null; S.pick = null;
    if (k === "move") S.panel = "move";
    else if (k === "extend") S.panel = "extend";
    else { S.panel = "pick"; S.pick = k; }
    render();
  }
  function goBack() {
    if (S.panel === "target" && S.pick) { S.panel = "pick"; S.sel = null; render(); }
    else openMenu();
  }
  function aimDir(dx, dy) {
    const m = myPiece();
    if (!m || over()) return;
    const x = m.x + dx, y = m.y + dy;
    if (!inBoard(x, y)) { fx("tag", m.x, m.y, "Edge of the board", ""); return; }
    const t = at(x, y);
    if (t) { fx("tag", x, y, `${t.player} is in the way`, ""); return; }
    S.panel = "move"; S.pick = null; S.sel = null; S.sheet = null;
    S.move = { x, y };
    render();
  }
  function selectTank(t) {
    if (!t || isSpectator() || over()) return;
    const m = myPiece();
    if (m && t.id === m.id) { if (S.panel) { clearAim(); render(); } else openMenu(); return; }
    if (!isJuror() && !m) return;
    S.panel = "target"; S.move = null; S.sheet = null;
    if (S.pick && !inReach().some((r) => r.id === t.id)) S.pick = null;
    S.sel = t.id;
    render();
  }

  // board shortcuts: tap a tank (generous radius) to target it; tap or swipe anywhere else to aim a move; tap your own tank for all actions
  function initBoardInput(board) {
    let down = null;
    board.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; try { board.setPointerCapture(e.pointerId); } catch (_) {} });
    board.addEventListener("pointercancel", () => { down = null; });
    board.addEventListener("pointerup", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.hypot(dx, dy) > 22) {
        if (!canAct()) return;
        if (Math.abs(dx) > Math.abs(dy)) aimDir(Math.sign(dx), 0); else aimDir(0, Math.sign(dy));
        return;
      }
      const r = board.getBoundingClientRect(), cell = board.clientWidth / N;
      const px = (e.clientX - r.left - board.clientLeft) / cell, py = (e.clientY - r.top - board.clientTop) / cell;
      let best = null, bd = 0.9;
      for (const t of living()) {
        const d = Math.hypot(px - (t.x + 0.5), py - (t.y + 0.5));
        if (d < bd) { bd = d; best = t; }
      }
      if (best) return selectTank(best);
      if (!canAct()) { if (trayOpen()) { clearAim(); render(); } return; }
      const m = myPiece();
      const gx = Math.floor(px) - m.x, gy = Math.floor(py) - m.y;
      if (!gx && !gy) return;
      if (Math.abs(gx) === Math.abs(gy)) { fx("tag", Math.floor(px), Math.floor(py), "Moves go up, down, left or right", ""); return; }
      if (Math.abs(gx) > Math.abs(gy)) aimDir(Math.sign(gx), 0); else aimDir(0, Math.sign(gy));
    });
  }

  // ---------- sending actions ----------
  async function send(body) {
    try { return { ok: true, data: await api("/api/action", body) }; }
    catch (e) { return { ok: false, error: e instanceof SignedOut ? "" : e.message }; }
  }
  async function failed(msg) {
    await refresh();
    if (!msg) return;
    const box = trayOpen() ? $("tray").querySelector(".tray-head > div:last-child") : null;
    if (box) {
      let m = box.querySelector(".meta");
      if (!m) { m = document.createElement("div"); box.appendChild(m); }
      m.className = "meta bad"; m.textContent = msg;
      $("tray").__html = null;
    } else {
      const p = myPiece();
      fx("tag", p ? p.x : 9, p ? p.y : 9, msg, "");
    }
  }
  async function perform(kind) {
    if (busy || !canAct()) return;
    const m = myPiece(), t0 = V.myTank;
    if (kind === "move") {
      if (S.panel !== "move" || !S.move || t0.ap < COST.move) return;
      const { x, y } = S.move, dir = DIR_NAME[`${x - m.x},${y - m.y}`];
      busy = true; squish(kind); vibe();
      const r = await send({ kind: "move", dir });
      busy = false;
      if (!r.ok) return failed(r.error);
      S.move = null; // the Move panel stays open, ready for the next step
      apply(r.data.view, false);
      slide(m.id, m.x, m.y, x, y);
      setTimeout(() => { const p = myPiece(); if (p) fx("ring", p.x, p.y, "", "var(--move)"); }, 200);
    } else if (kind === "extend") {
      if (S.panel !== "extend" || t0.ap < COST.extend) return;
      busy = true; squish(kind); vibe();
      const r = await send({ kind: "extend" });
      busy = false;
      if (!r.ok) return failed(r.error);
      S.panel = null;
      apply(r.data.view, false);
      const p = myPiece();
      if (p) { pulse(p.x, p.y, V.myTank.range, "var(--extend-ink)"); fx("text", p.x, p.y, `Range ${V.myTank.range}`, "var(--extend-deep)"); }
    } else if (kind === "attack" || kind === "give") {
      const t = living().find((x) => x.id === S.sel);
      if (S.panel !== "target" || !t || t0.ap < 1 || !inRange(m.x, m.y, t.x, t.y, t0.range)) return;
      busy = true;
      t0.ap -= 1; renderHud(); renderTray(); // show the spent AP at once; the server's answer replaces it
      squish(kind); vibe();
      const color = kind === "attack" ? "var(--attack)" : "var(--give-ink)";
      const [r] = await Promise.all([
        send({ kind: kind === "attack" ? "shoot" : "give", target: t.id }),
        new Promise((done) => shot(m, t, color, done)),
      ]);
      busy = false;
      if (!r.ok) return failed(r.error);
      const e = r.data.effect;
      if (kind === "give") {
        apply(r.data.view, false);
        burst(t.x, t.y, color); bump(t.id); fx("text", t.x, t.y, "+1 AP", "var(--give-deep)");
      } else if (e.destroyed) {
        if (S.sel === t.id) { S.sel = null; S.panel = S.pick && !e.won ? "pick" : null; }
        apply(r.data.view, false);
        destroyedFx(t);
        fx("text", t.x, t.y, e.won ? "You won!" : "Destroyed", "var(--attack)", "big");
      } else {
        apply(r.data.view, false);
        burst(t.x, t.y, color); rattle(t.id); fx("text", t.x, t.y, "Hit!", "var(--attack)");
      }
    }
  }
  async function vote() {
    const t = living().find((x) => x.id === S.sel);
    if (busy || !t || !isJuror()) return;
    busy = true;
    const r = await send({ kind: "vote", target: t.id });
    busy = false;
    if (!r.ok) return failed(r.error);
    apply(r.data.view, false);
    burst(t.x, t.y, "var(--vote)"); bump(t.id); fx("text", t.x, t.y, "+1 vote", "var(--vote)");
  }

  // press-and-hold on buttons that spend AP
  function initTray(tray) {
    tray.addEventListener("pointerdown", (e) => {
      const b = e.target.closest("[data-hold]");
      if (!b || b.disabled || busy) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
      b.classList.add("holding");
      const kind = b.dataset.hold;
      H = { b, t: setTimeout(() => { H = null; b.classList.remove("holding"); perform(kind); }, HOLD_MS) };
    });
    const endHold = () => {
      if (!H) return;
      clearTimeout(H.t);
      const b = H.b; H = null;
      b.classList.remove("holding");
      b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake");
      const box = tray.querySelector(".tray-head > div:last-child");
      if (box) {
        let m = box.querySelector(".meta");
        if (!m) { m = document.createElement("div"); box.appendChild(m); }
        m.className = "meta warn";
        m.textContent = "Keep holding until the bar fills.";
        tray.__html = null;
      }
    };
    tray.addEventListener("pointerup", endHold);
    tray.addEventListener("pointercancel", endHold);
    tray.addEventListener("contextmenu", (e) => { if (e.target.closest(".btn")) e.preventDefault(); });
    tray.addEventListener("keydown", (e) => {
      const b = e.target.closest("[data-hold]");
      if (b && !b.disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); perform(b.dataset.hold); }
    });
    tray.addEventListener("click", (e) => {
      const q = (s) => e.target.closest(s);
      let b;
      if (q("[data-cancel]")) { clearAim(); render(); }
      else if (q("[data-back]")) goBack();
      else if ((b = q("[data-open]"))) openAction(b.dataset.open);
      else if ((b = q("[data-dir]"))) { const [dx, dy] = b.dataset.dir.split(",").map(Number); aimDir(dx, dy); }
      else if ((b = q("[data-target]"))) selectTank(living().find((t) => t.id === Number(b.dataset.target)));
      else if (q("[data-vote]")) vote();
    });
  }

  // ---------- tabs + sheets ----------
  const SHEETS = {
    news: { ico: "📰", title: "News" },
    you: { ico: "📬", title: "You" },
    jury: { ico: "⚖️", title: "Jury" },
    settings: { ico: "⚙️", title: "Settings" },
  };
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const stamp = (e) => `${V.game && V.game.apMode === "interval" ? "Round" : "Day"} ${e.round + 1} · ${timeFmt.format(new Date(e.at))}`;
  const logList = (rows) => rows.length
    ? `<div class="well"><ul class="log">${rows.map((e) => `<li class="${e.id > S.newSince ? "new" : ""}"><time>${stamp(e)}</time><span>${esc(e.text)}</span></li>`).join("")}</ul></div>`
    : `<div class="chip">Nothing yet.</div>`;
  function renderTabs() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-expanded", b.dataset.tab === "actions" ? !!S.panel : S.sheet === b.dataset.tab));
    const act = root.querySelector('[data-tab="actions"]');
    act.querySelector(".ico").textContent = isJuror() && !over() ? "🗳️" : "⚔️";
    act.querySelector(".t").textContent = isJuror() && !over() ? "Vote" : "Actions";
    for (const k of ["news", "you"]) {
      const b = root.querySelector(`[data-badge="${k}"]`);
      const n = S.sheet === k ? 0 : unread(k);
      b.textContent = n > 99 ? "99+" : n || "";
      b.hidden = !n;
    }
  }
  function renderSheet() {
    $("sheet-root").classList.toggle("sheet-open", !!S.sheet);
    if (!S.sheet) return;
    const s = SHEETS[S.sheet];
    setHtml($("sheet-title"), `<span aria-hidden="true">${s.ico}</span>${s.title}`);
    let body = "";
    if (S.sheet === "news") {
      body = `<p class="note">Public events. All players see these.</p>${logList(V.news)}`;
    } else if (S.sheet === "you") {
      body = isSpectator()
        ? `<p class="note">You are not in this game, so you have no private events.</p>`
        : `<p class="note">Private events. Only you see these.</p>${logList(V.log)}`;
    } else if (S.sheet === "jury") {
      const myId = V.myTank && V.myTank.id;
      const jurors = V.jurors.length
        ? `<div class="jurors">${V.jurors.map((t) => `<span class="mini">${img(t.flag)}${esc(t.player)}${t.id === myId ? " (you)" : ""}</span>`).join("")}</div>`
        : `<div class="chip">No tank is destroyed yet.</div>`;
      let tally = `<p class="note">Only jurors see the votes.</p>`;
      if (isJuror() && !over()) {
        const byTarget = new Map();
        for (const v of V.jury.votes) byTarget.set(v.target, [...(byTarget.get(v.target) || []), v.juror]);
        const rows = [...byTarget.entries()].sort((a, b) => b[1].length - a[1].length).map(([tid, voters]) => {
          const t = living().find((x) => x.id === tid);
          if (!t) return "";
          const n = voters.length;
          const faces = voters.map((j) => { const jt = V.jurors.find((x) => x.id === j); return jt ? img(jt.flag) : ""; }).join("");
          return `<div>${img(t.flag)}<span class="who">${esc(t.player)}</span><span class="voters" title="Voters">${faces}</span>${n >= 3 ? `<i class="gain">+1 AP</i>` : ""}<b class="vc">${n} ${n === 1 ? "vote" : "votes"}</b></div>`;
        }).join("");
        tally = `<section><h3>Tonight's votes · jurors only</h3>${rows ? `<div class="well tally">${rows}</div>` : `<div class="chip">No votes yet tonight.</div>`}</section>`;
      }
      body = `<section><h3>Jurors</h3>${jurors}</section>
        <p class="note">A destroyed tank joins the jury. Each night, each juror votes for one living tank. At the next AP drop, a tank with 3 or more votes gets 1 extra AP.</p>
        ${tally}`;
    } else if (S.sheet === "settings") {
      const dark = html.dataset.mode === "dark";
      body = `<section><h3>Theme</h3><div class="btn-row">
          <button type="button" class="btn small ${dark ? "c-back" : "c-ink"}" data-theme-set="light" aria-pressed="${!dark}"><span class="lbl">☀️ Light</span></button>
          <button type="button" class="btn small ${dark ? "c-ink" : "c-back"} tilt-r" data-theme-set="dark" aria-pressed="${dark}"><span class="lbl">🌙 Dark</span></button>
        </div></section>
        <section><h3>Account</h3><p class="note" style="margin-bottom:10px">Signed in as <b>${esc(V.me.username)}</b>.</p><div class="btn-row">${accountButtons()}</div></section>`;
    }
    setHtml($("sheet-body"), body);
  }
  function openSheet(k) {
    clearAim();
    S.sheet = S.sheet === k ? null : k;
    if (S.sheet === "news" || S.sheet === "you") {
      S.newSince = seenGet(S.sheet) ?? 0;
      seenSet(S.sheet, maxId(listOf(S.sheet)));
    }
    render();
    if (S.sheet) $("sheet").querySelector("[data-close]").focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!S.sheet) return;
    if (S.sheet === "news" || S.sheet === "you") seenSet(S.sheet, maxId(listOf(S.sheet)));
    S.sheet = null; S.newSince = 0;
    render();
  }
  function setMode(m) {
    html.dataset.mode = m;
    try { localStorage.setItem("alliance-mode", m); } catch (_) {}
    window.dispatchEvent(new Event("alliance-theme"));
    renderSheet();
  }

  // ---------- tour ----------
  const STEPS = [
    { el: "#chart", title: "The board", text: () => "This is the battlefield. Each flag is a tank, with its player's name below it." + (myPiece() ? " The dashed line shows your range: the squares you can shoot or give AP to." : "") },
    { el: '[data-tab="actions"]', title: "Actions",
      text: () => isJuror() ? "Your tank is destroyed, so your only action is the jury vote. Tap here, then pick a tank."
        : "All your actions are here: move, shoot, give AP and extend range. Each card shows its cost. To confirm an action that spends AP, press and hold its button until the bar fills." },
    { el: "#chart", title: "Shortcuts",
      text: () => isJuror() ? "Tap a tank on the board to vote for it."
        : "Tap the board to skip a step. Tap or swipe toward a square to aim a move. Tap a tank to shoot it or give it AP. Tap your own tank to see all actions." },
    { el: "#hud", title: "Your tank", text: () => `Your hearts, AP and range, and the time until the next AP. Each living tank gets 1 AP ${dropWord()}. Only you see your hearts, AP and range.`, pad: 4 },
    { el: '[data-tab="news"]', title: "News", text: () => "Public events that all players see: moves, destroyed tanks and AP drops." },
    { el: '[data-tab="you"]', title: "You", text: () => "Private events that only you see. A hit or a gift never shows who sent it. If your tank is destroyed, you learn who did it." },
    { el: '[data-tab="jury"]', title: "Jury", text: () => "Destroyed tanks join the jury. Each night, a tank with 3 or more jury votes gets 1 extra AP." },
    { el: '[data-tab="settings"]', title: "Settings", text: () => "Light or dark mode, and your account." },
    { el: "[data-tour]", title: "Tour", text: () => "Tap here at any time to see this tour again." },
  ];
  function startTour() { clearAim(); S.sheet = null; render(); T = { i: 0 }; $("tour").hidden = false; renderTour(); }
  function endTour() { T = null; $("tour").hidden = true; }
  function renderTour() {
    if (!T) return;
    const st = STEPS[T.i], last = T.i === STEPS.length - 1;
    const skip = last ? "" : `<button type="button" class="btn small c-cancel" data-tour-skip><span class="lbl">✕ Skip</span></button>`;
    const back = T.i ? `<button type="button" class="btn small c-back" data-tour-back><span class="lbl">‹ Back</span></button>` : "";
    const next = `<button type="button" class="btn small c-move grow tilt-r" data-tour-next><span class="lbl">${last ? "Done ✓" : "Next ›"}</span></button>`;
    const card = $("tour-card");
    card.innerHTML = `<div class="tour-top"><h4 class="banner">${st.title}</h4><div class="tour-dots" aria-label="Step ${T.i + 1} of ${STEPS.length}">${STEPS.map((_, i) => `<i class="${i === T.i ? "on" : ""}"></i>`).join("")}</div></div>
      <p>${st.text()}</p><div class="row">${skip}${back}${next}</div>`;
    placeTour();
    card.querySelector("[data-tour-next]").focus({ preventScroll: true });
  }
  function placeTour() {
    if (!T || screen !== "game") return;
    const st = STEPS[T.i], el = root.querySelector(st.el);
    if (!el) return;
    const r = el.getBoundingClientRect(), pad = st.pad ?? 6;
    const spot = $("spot"), card = $("tour-card");
    Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
    const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
    let top;
    if (vh - (r.bottom + pad) >= ch + 24) top = r.bottom + pad + 12;
    else if (r.top - pad >= ch + 24) top = r.top - pad - 12 - ch;
    else top = Math.max(16, (vh - ch) / 2);
    const left = Math.min(Math.max(r.left + r.width / 2 - cw / 2, 16), vw - 16 - cw);
    Object.assign(card.style, { left: left + "px", top: top + "px" });
  }

  // ---------- page-wide listeners ----------
  const onDocPointer = (e) => {
    if (screen !== "game" || !trayOpen() || T) return;
    if (e.target.closest("#tray, #board, #sheet-root, #tour")) return;
    clearAim(); render();
  };
  const onKey = (e) => {
    if (screen !== "game" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (T) {
      if (e.key === "Escape") { e.preventDefault(); endTour(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (T.i < STEPS.length - 1) { T.i++; renderTour(); } }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (T.i > 0) { T.i--; renderTour(); } }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); if (S.sheet) closeSheet(); else { clearAim(); render(); } return; }
    if (S.sheet) return;
    if (e.key === "a" || e.key === "A") { openMenu(); return; }
    if (!canAct()) return;
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (dir) { e.preventDefault(); aimDir(...dir); return; }
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
    if (e.key === "Enter") { if (S.panel === "move") perform("move"); else if (S.panel === "extend") perform("extend"); }
    else if (e.key === "e" || e.key === "E") openAction("extend");
    else if ((e.key === "f" || e.key === "F") && S.panel === "target") perform("attack");
    else if ((e.key === "g" || e.key === "G") && S.panel === "target") perform("give");
  };
  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener("pointerdown", onDocPointer);
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  addEventListener("resize", placeTour);
  const clock = setInterval(tick, 1000);
  const poller = setInterval(poll, POLL_MS);
  refresh();

  return () => {
    dead = true;
    clearInterval(clock); clearInterval(poller);
    if (ro) ro.disconnect();
    document.removeEventListener("pointerdown", onDocPointer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
    removeEventListener("resize", placeTour);
    root.innerHTML = "";
  };
}
