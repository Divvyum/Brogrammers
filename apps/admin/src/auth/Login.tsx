import { useEffect, useState, type FormEvent } from "react";
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
} from "firebase/auth";
import { api } from "../api/client";
import { auth } from "../firebase";
import { errorMessage } from "../lib/hooks";
import { setMeta } from "../scanner/db";

// Sign-in (plan A2): Google, email link, and the volunteer scanner login
// (event code + PIN). The emulator password form shows in development only.

export async function volunteerSignIn(eventCode: string, pin: string) {
  const r = await api<{ token: string; eventId: string; deviceId: string; name: string }>("/auth/volunteer-login", {
    method: "POST",
    body: { eventCode: eventCode.trim().toUpperCase(), pin: pin.trim() },
  });
  // The scanner keeps one device ID per phone; the first login sets it.
  const key = `device:${r.eventId}`;
  if (!localStorage.getItem(key)) localStorage.setItem(key, r.deviceId);
  await setMeta(`${r.eventId}:deviceId`, localStorage.getItem(key));
  await signInWithCustomToken(auth, r.token);
  return r;
}

export function Login() {
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [eventCode, setEventCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    const saved = localStorage.getItem("emailForSignIn") || window.prompt("Confirm your email") || "";
    signInWithEmailLink(auth, saved, window.location.href)
      .then(() => {
        localStorage.removeItem("emailForSignIn");
        window.history.replaceState({}, "", "/");
      })
      .catch((e) => setNotice(errorMessage(e)));
  }, []);

  const attempt = (fn: () => Promise<unknown>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="art-orbit orbit-a" />
        <div className="art-orbit orbit-b" />
        <span className="art-kicker">HACKOS / OPERATIONS</span>
        <h1>
          Everything
          <br />
          in <em>motion.</em>
        </h1>
        <p>One clear view of your event, your people, and the moments that matter.</p>
        <div className="art-footer">
          ADMIN CONTROL ROOM <span>●</span> READY FOR EVENT DAY
        </div>
      </div>
      <div className="login-box">
        <div className="brand">
          <span className="brand-mark">H</span>
          <span>
            HACKOS<small>EVENT CONTROL</small>
          </span>
        </div>
        <h2>Welcome back</h2>
        <p className="muted">Sign in to your event workspace.</p>
        {notice && <div className="notice">{notice}</div>}

        <button className="google-button" disabled={busy} onClick={attempt(() => signInWithPopup(auth, new GoogleAuthProvider()))}>
          <b>G</b> Continue with Google
        </button>

        <div className="or">
          <span />
          or use an email link
          <span />
        </div>
        <form
          onSubmit={attempt(async () => {
            await sendSignInLinkToEmail(auth, email, { url: window.location.origin, handleCodeInApp: true });
            localStorage.setItem("emailForSignIn", email);
            setNotice("Sign-in link sent. Open it on this device to continue.");
          })}
        >
          <label>
            Email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.com" required />
          </label>
          <button className="primary full" disabled={busy}>
            Send sign-in link →
          </button>
        </form>

        <details open={location.pathname.startsWith("/scan")}>
          <summary>Volunteer scanner login</summary>
          <form className="pin-card" onSubmit={attempt(() => volunteerSignIn(eventCode, pin))}>
            <label>
              Event code
              <input value={eventCode} onChange={(e) => setEventCode(e.target.value.toUpperCase())} autoCapitalize="characters" required />
            </label>
            <label>
              6-digit PIN
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6} required />
            </label>
            <button className="secondary full" disabled={busy || pin.length !== 6}>
              Sign in to scanner
            </button>
          </form>
        </details>

        {import.meta.env.DEV && (
          <details className="dev-login">
            <summary>Development only: emulator email and password</summary>
            <form onSubmit={attempt(() => signInWithEmailAndPassword(auth, email, password))}>
              <label>
                Account email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="hackos-dev-123" required />
              </label>
              <button className="secondary full" disabled={busy}>
                Sign in
              </button>
            </form>
          </details>
        )}
        <p className="login-foot">Access is by invitation. Ask your organizer if you can't sign in.</p>
      </div>
    </div>
  );
}
