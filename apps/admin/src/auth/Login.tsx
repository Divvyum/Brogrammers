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
import { Gauge, Gavel, ScanLine, UsersRound } from "lucide-react";
import { AuraLogo, Brand } from "../components/AuraLogo";

const POINTS = [
  { icon: Gauge, text: "Live dashboard for the whole event" },
  { icon: UsersRound, text: "Eligibility, teams, waitlist and rescue" },
  { icon: ScanLine, text: "Offline gate scanner with digital IDs" },
  { icon: Gavel, text: "Judging, results and reward tracking" },
];

// Sign-in (plan A2): Google, email link, and the volunteer scanner login
// (event code + PIN). The emulator password form shows in development only.

const USING_EMULATORS = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";

/** The newest email sign-in link the Auth emulator generated for this address. */
async function emulatorSignInLink(email: string): Promise<string | undefined> {
  const res = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${import.meta.env.VITE_FIREBASE_PROJECT_ID}/oobCodes`);
  const { oobCodes = [] } = (await res.json()) as { oobCodes?: { email: string; requestType: string; oobLink: string }[] };
  return oobCodes.filter((c) => c.email.toLowerCase() === email.toLowerCase() && c.requestType === "EMAIL_SIGNIN").at(-1)?.oobLink;
}

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
  /** Local emulator only: it sends no real email, so we show the link it generated. */
  const [devLink, setDevLink] = useState("");

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
        <div className="art-brand">
          <div className="logo-tile">
            <AuraLogo size={36} />
          </div>
          <span>AURA</span>
        </div>
        <div className="art-body">
          <span className="art-kicker">Admin · Organizers, volunteers, mentors and judges</span>
          <h1>Run the whole hackathon from one place.</h1>
          <p>Registrations, teams, arrival, event day, judging and rewards, with a gate scanner that keeps working when the venue Wi-Fi doesn’t.</p>
          <ul className="art-points">
            {POINTS.map((p) => (
              <li key={p.text}>
                <span>
                  <p.icon size={19} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="art-footer">© 2026 AURA · Admin</p>
      </div>
      <div className="login-box">
        <div className="brand">
          <Brand sub="Admin" />
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
            if (USING_EMULATORS) {
              setDevLink((await emulatorSignInLink(email)) ?? "");
              setNotice("Local emulator: no email is sent. Use the button below to open the sign-in link.");
            } else {
              setNotice("Sign-in link sent. Open it on this device to continue.");
            }
          })}
        >
          <label>
            Email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.com" required />
          </label>
          <button className="primary full" disabled={busy}>
            Send sign-in link
          </button>
        </form>
        {devLink && (
          <a className="secondary full dev-link" href={devLink}>
            Open sign-in link (local emulator)
          </a>
        )}

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
