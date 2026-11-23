"use client";
import { useEffect, useState } from "react";

type Mode = "login" | "register";

// Sign in, or make an account. One account works on many devices: each device stays signed in.
export default function AuthForm({ mode }: { mode: Mode }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [needsInvite, setNeedsInvite] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "register") return;
    fetch("/api/auth/register", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setNeedsInvite(!!d.needsInvite))
      .catch(() => setNeedsInvite(true));
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, invite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const first = mode === "register" && needsInvite === false;
  return (
    <div className="scroll">
      <div className="card-page">
        <div className="logo">Alliance</div>
        <form className="panel pad" onSubmit={submit}>
          <h1 className="banner">{mode === "login" ? "Sign in" : "Make an account"}</h1>
          {first && <p className="note">You are the first player. Your account will be the admin account.</p>}
          <label className="field">
            <span>Username</span>
            <input className="input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              required minLength={2} maxLength={16} pattern="[A-Za-z0-9_]+" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" name="password" type="password" required minLength={mode === "register" ? 8 : 1} maxLength={200}
              autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {mode === "register" && needsInvite && (
            <label className="field">
              <span>Invite code</span>
              <input className="input" name="invite" autoComplete="off" autoCapitalize="none" spellCheck={false} required
                value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Get it from the admin" />
            </label>
          )}
          {mode === "register" && <p className="note">Use 2 to 16 letters, digits or _ for the username. Use 8 or more characters for the password.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className={`btn wide c-move${busy ? "" : " tilt-r"}`} disabled={busy} aria-busy={busy}>
            <span className="lbl">{mode === "login" ? "Sign in" : "Make my account"}</span>
          </button>
        </form>
        <section className="panel pad">
          <p className="note">{mode === "login" ? "New to the game?" : "Do you have an account?"}</p>
          <a className="btn wide c-ink" href={mode === "login" ? "/register" : "/login"}>
            <span className="lbl">{mode === "login" ? "Make an account" : "Sign in"}</span>
          </a>
        </section>
      </div>
    </div>
  );
}
