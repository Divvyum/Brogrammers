import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import QRCode from "qrcode";
import QrScanner from "qr-scanner";
import { auth } from "./firebase";
import { api } from "./api";
import { enrollId, loadId, respondToChallenge } from "./device-id";
import "./app.css";

type View = "home" | "team" | "journey" | "id" | "event" | "submit" | "results" | "profile";
const nav: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "team", label: "Team", icon: "◉" },
  { id: "journey", label: "Journey", icon: "↗" },
  { id: "id", label: "My ID", icon: "▣" },
  { id: "event", label: "Event", icon: "◇" },
  { id: "submit", label: "Submit", icon: "↑" },
  { id: "results", label: "Results", icon: "★" },
  { id: "profile", label: "Profile", icon: "○" },
];
const steps = [
  "Registered",
  "Eligible",
  "Team locked",
  "Travel booked",
  "Enrolled",
  "Checked in",
  "Submitted",
  "Results",
];

function Card({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header>
          <h2>{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
function Pill({ children, tone = "green" }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
function Button({
  children,
  secondary,
  onClick,
}: {
  children: ReactNode;
  secondary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`button ${secondary ? "secondary" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

type Me = {
  uid: string;
  profile: { name?: string } | null;
  registration: { status?: string; enrollment?: { status?: string } } | null;
};

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined)
    return (
      <div className="login-page">
        <p>Loading HACKOS…</p>
      </div>
    );
  return user ? <Dashboard user={user} /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await setPersistence(auth, browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <b>H</b>
          <span>
            <strong>HACKOS</strong>
            <small>Participant portal</small>
          </span>
        </div>
        <h1>Sign in</h1>
        <p>Your session securely supplies a Firebase bearer token to participant API requests.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <Button>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}

function Dashboard({ user }: { user: User }) {
  const [view, setView] = useState<View>("home");
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch((e) => notify(e.message));
  }, []);
  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(""), 1800);
  };
  return (
    <div className={`app ${dark ? "dark" : ""}`}>
      <aside>
        <div className="brand">
          <b>H</b>
          <span>
            <strong>HACKOS</strong>
            <small>Participant portal</small>
          </span>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => setView(n.id)}
            >
              <i>{n.icon}</i>
              {n.label}
            </button>
          ))}
        </nav>
        <footer>● Signed in as {me?.profile?.name ?? user.email}</footer>
      </aside>
      <main>
        <div className="top">
          <span>
            <small>HACKOS 2026 · Bengaluru</small>
            <h1>{nav.find((n) => n.id === view)?.label}</h1>
          </span>
          <div>
            <button onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button>
            <button className="avatar" onClick={() => setView("profile")}>
              AM
            </button>
          </div>
        </div>
        <div className="session">
          <b>Authenticated session</b> {user.email} ·{" "}
          {me?.registration?.status ?? "loading profile"}{" "}
          <button onClick={() => signOut(auth)}>Sign out</button>
        </div>
        <div className="content">
          {view === "home" && <Home go={setView} notify={notify} />}
          {view === "team" && <Team notify={notify} />}
          {view === "journey" && <Journey notify={notify} />}
          {view === "id" && <DigitalId notify={notify} />}
          {view === "event" && <Event notify={notify} />}
          {view === "submit" && <Submit notify={notify} />}
          {view === "results" && <Results notify={notify} />}
          {view === "profile" && <Profile dark={dark} setDark={setDark} notify={notify} />}
        </div>
      </main>
      <div className="mobile-nav">
        {nav.slice(0, 5).map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={view === n.id ? "active" : ""}
          >
            <i>{n.icon}</i>
            {n.label}
          </button>
        ))}
      </div>
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function Home({ go, notify }: { go: (v: View) => void; notify: (s: string) => void }) {
  return (
    <>
      <section className="hero">
        <div>
          <Pill>Eligible</Pill>
          <h2>Good morning, Aarav.</h2>
          <p>Your team is locked. Book your arrival slot to keep things moving.</p>
          <Button onClick={() => go("journey")}>Book arrival slot →</Button>
        </div>
        <div className="count">
          <b>4</b>
          <span>days to HACKOS</span>
          <small>18 Nov · 9:00 AM</small>
        </div>
      </section>
      <Card title="Your hackathon journey" action={<small>4 of 8 complete</small>}>
        <div className="steps">
          {steps.map((s, i) => (
            <div className={i < 4 ? "done" : i === 4 ? "current" : ""} key={s}>
              <b>{i < 4 ? "✓" : i + 1}</b>
              <small>{s}</small>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid two">
        <Card title="Next up">
          <div className="next">
            <b>
              18<small>NOV</small>
            </b>
            <span>
              <strong>Participant check-in</strong>
              <small>Main gate · 8:00–9:30 AM</small>
            </span>
          </div>
          <button className="link" onClick={() => go("event")}>
            View full schedule →
          </button>
        </Card>
        <Card title="Quick actions">
          <div className="quick">
            <button onClick={() => go("id")}>
              ▣<small>My digital ID</small>
            </button>
            <button onClick={() => go("team")}>
              ◉<small>Team hub</small>
            </button>
            <button onClick={() => notify("Help ticket draft opened")}>
              ?<small>Get help</small>
            </button>
          </div>
        </Card>
      </div>
      <Card title="Latest announcements">
        <article>
          <Pill tone="red">Important</Pill>
          <span>
            <b>Bring a government-issued ID</b>
            <p>Required at the main gate along with your digital HACKOS ID.</p>
          </span>
        </article>
        <article>
          <Pill tone="blue">Track</Pill>
          <span>
            <b>AI track briefing updated</b>
            <p>Briefing moves to Auditorium B at 10:15 AM.</p>
          </span>
        </article>
      </Card>
    </>
  );
}

function Team({ notify }: { notify: (s: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <section className="headline">
        <div>
          <Pill tone="blue">Team locked</Pill>
          <h2>Pixel Pioneers</h2>
          <p>AI for Social Impact · 4/4 members</p>
        </div>
        <div className="code">
          <small>INVITE CODE</small>
          <b>PX8QK21A</b>
          <button onClick={() => notify("Invite code copied")}>Copy</button>
        </div>
      </section>
      <div className="grid two">
        <Card title="Members">
          {[
            ["AM", "Aarav Mehta", "Leader · Frontend"],
            ["SK", "Sara Khan", "AI / ML"],
            ["RJ", "Rohan Jain", "Backend"],
            ["NP", "Niya Patel", "Design"],
          ].map((m) => (
            <div className="person" key={m[1]}>
              <i>{m[0]}</i>
              <span>
                <b>{m[1]}</b>
                <small>{m[2]}</small>
              </span>
              <em>●</em>
            </div>
          ))}
        </Card>
        <Card title="Team readiness">
          {[
            ["Profiles complete", 100, "4/4"],
            ["Digital IDs enrolled", 75, "3/4"],
            ["Arrival slots booked", 50, "2/4"],
          ].map((x) => (
            <div className="meter" key={x[0]}>
              <span>
                {x[0]} <b>{x[2]}</b>
              </span>
              <progress value={x[1]} max="100" />
            </div>
          ))}
        </Card>
      </div>
      <Card title="Smart matching & replacement">
        <div className="toggle">
          <span>
            <b>Open to replacement opportunities</b>
            <p>Help another team if a seat opens.</p>
          </span>
          <button className={open ? "switch on" : "switch"} onClick={() => setOpen(!open)}>
            <i />
          </button>
        </div>
        <div className="person">
          <i className="purple">VI</i>
          <span>
            <b>Vivaan Iyer</b>
            <small>Python · Computer Vision · Same track</small>
          </span>
          <Button secondary onClick={() => notify("Connection request sent")}>
            Connect
          </Button>
        </div>
      </Card>
    </>
  );
}

function Journey({ notify }: { notify: (s: string) => void }) {
  return (
    <>
      <section className="headline">
        <div>
          <small>YOUR JOURNEY</small>
          <h2>Pune → Bengaluru</h2>
          <p>Train · Arrives 18 Nov, 6:20 AM</p>
        </div>
        <Button secondary onClick={() => notify("Travel editor opened")}>
          Edit plan
        </Button>
      </section>
      <div className="grid two">
        <Card title="JourneyLink circle">
          <Pill tone="blue">5 travellers matched</Pill>
          <h3>Pune Morning Crew</h3>
          <p>Meet at Platform 2 near Coach B4. Carpool enabled.</p>
          <div className="faces">
            <i>AM</i>
            <i>SK</i>
            <i>VI</i>
            <i>+2</i>
          </div>
          <div className="chat">
            <p>
              <b>Sara:</b> I’ll carry a blue HACKOS sign 👋
            </p>
            <p>
              <b>Vivaan:</b> Sharing a cab from the station?
            </p>
            <input
              placeholder="Message the circle…"
              onKeyDown={(e) => e.key === "Enter" && notify("Demo message added")}
            />
          </div>
        </Card>
        <Card title="Arrival slot">
          <div className="slot selected">
            <span>
              <b>7:30–8:00 AM</b>
              <small>18 seats remaining</small>
            </span>
            <Pill>Selected</Pill>
          </div>
          <div className="slot">
            <span>
              <b>8:00–8:30 AM</b>
              <small>5 seats remaining</small>
            </span>
            <button onClick={() => notify("Slot changed")}>Choose</button>
          </div>
          <div className="room">
            <small>PRE-ALLOTTED ROOM</small>
            <b>Auditorium B · Seat B-14</b>
            <span>AI track · Ground floor</span>
          </div>
        </Card>
      </div>
    </>
  );
}

function DigitalId({ notify }: { notify: (s: string) => void }) {
  const [enrolled, setEnrolled] = useState(false);
  const [backup, setBackup] = useState("");
  const [show, setShow] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    loadId().then((id) => {
      setEnrolled(!!id);
      setBackup(id?.backupCode ?? "");
    });
  }, []);
  const enroll = async () => {
    try {
      const id = await enrollId();
      setEnrolled(true);
      setBackup(id.backupCode);
      notify("This device is enrolled");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed");
    }
  };
  return (
    <div className="id-grid">
      <section className="id-card">
        <div>
          <b className="logo">H</b>
          <strong>HACKOS 2026</strong>
          <Pill>{enrolled ? "Valid" : "Not enrolled"}</Pill>
        </div>
        <i className="photo">ID</i>
        <h2>Digital check-in</h2>
        <p>
          Scan a fresh challenge from the volunteer scanner. A new signed response QR is generated
          every time.
        </p>
        {response ? <ResponseQr text={response} /> : <div className="qr">▦</div>}
        <small>
          {response ? "Show this response to the volunteer scanner" : "No active response QR"}
        </small>
      </section>
      <div>
        <Card title="Digital ID status">
          <div className="status">
            <span>Device enrolled</span>
            <Pill tone={enrolled ? "green" : "amber"}>{enrolled ? "Active" : "Required"}</Pill>
          </div>
          <div className="status">
            <span>Private signing key</span>
            <b>{enrolled ? "Saved on this device" : "Not created"}</b>
          </div>
        </Card>
        {backup && (
          <Card title="Backup code">
            <button className="backup" onClick={() => setShow(!show)}>
              {show ? backup : "••••-••••"}
              <small>Tap to {show ? "hide" : "reveal"}</small>
            </button>
          </Card>
        )}
        {!enrolled ? (
          <Button onClick={enroll}>Enroll this device</Button>
        ) : (
          <Button
            onClick={() => {
              setResponse("");
              setScanning(true);
            }}
          >
            Scan challenge & generate QR
          </Button>
        )}
        {error && <p className="login-error">{error}</p>}
        {scanning && (
          <ChallengeCamera
            onClose={() => setScanning(false)}
            onResult={(text) => {
              setResponse(text);
              setScanning(false);
            }}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

function ResponseQr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current)
      void QRCode.toCanvas(ref.current, text, { width: 280, margin: 2, errorCorrectionLevel: "M" });
  }, [text]);
  return <canvas ref={ref} className="response-qr" aria-label="Signed check-in response QR" />;
}
function ChallengeCamera({
  onClose,
  onResult,
  onError,
}: {
  onClose: () => void;
  onResult: (text: string) => void;
  onError: (text: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [detected, setDetected] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const scanner = new QrScanner(
      ref.current,
      async (result) => {
        await scanner.stop();
        setDetected(result.data);
      },
      { preferredCamera: "environment", highlightScanRegion: true },
    );
    void scanner.start().catch((e) => onError(e.message));
    return () => scanner.destroy();
  }, [onResult, onError]);
  const submit = async () => {
    if (!detected || submitting) return;
    setSubmitting(true);
    try {
      onResult(await respondToChallenge(detected));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Invalid challenge");
      setDetected("");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="camera-modal">
      <div>
        <h2>Scan volunteer challenge</h2>
        <p>
          {detected
            ? "Challenge detected. Submit it to generate your signed response QR."
            : "Point the camera at the volunteer QR. Detection is automatic."}
        </p>
        <video ref={ref} />
        <div className="camera-actions">
          <Button secondary onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>
            {submitting ? "Generating…" : detected ? "Submit scanned QR" : "Waiting for QR…"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Event({ notify }: { notify: (s: string) => void }) {
  return (
    <>
      <div className="tabs">
        <b>Schedule</b>
        <span>Announcements</span>
        <span>Problems</span>
        <span>Mentors</span>
      </div>
      <div className="grid event">
        <Card title="Today’s schedule">
          <div className="timeline">
            {[
              ["08:00", "Check-in & breakfast", "Main entrance"],
              ["10:15", "Opening & problem release", "Auditorium B · Now"],
              ["11:00", "Build sprint begins", "Team rooms"],
              ["14:00", "Mentor office hours", "Mentor bay"],
            ].map((x, i) => (
              <div className={i === 1 ? "now" : ""} key={x[0]}>
                <time>{x[0]}</time>
                <i />
                <span>
                  <b>{x[1]}</b>
                  <small>{x[2]}</small>
                </span>
              </div>
            ))}
          </div>
        </Card>
        <div>
          <Card title="Mentor booking">
            <p>
              <b>Dr. Maya Rao</b> · AI systems
            </p>
            <div className="slot">
              <span>
                <b>2:30–2:45 PM</b>
                <small>Available</small>
              </span>
              <button onClick={() => notify("Mentor slot booked")}>Book</button>
            </div>
          </Card>
          <Card title="Event tools">
            <div className="tools">
              <button onClick={() => notify("Progress saved")}>↗ Post progress update</button>
              <button onClick={() => notify("Help ticket created")}>? Create help ticket</button>
              <button onClick={() => notify("Food pass opened")}>▦ Show food pass</button>
              <button onClick={() => notify("Venue map opened")}>⌖ Open venue map</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Submit({ notify }: { notify: (s: string) => void }) {
  const [sent, setSent] = useState(false);
  return (
    <>
      <section className="headline">
        <div>
          <small>SUBMISSION DEADLINE</small>
          <h2>18:42:16</h2>
          <p>remaining · 19 Nov, 6:00 PM</p>
        </div>
        <Pill tone="amber">Draft</Pill>
      </section>
      <Card title="Project submission">
        <label>
          Presentation (PDF or PPT)
          <div className="drop">
            ↑<b>Drop your deck here</b>
            <small>PDF, PPT or PPTX · max 10 MB</small>
            <button onClick={() => notify("File picker opened")}>Choose file</button>
          </div>
        </label>
        <div className="form">
          <label>
            Demo video URL
            <input defaultValue="https://youtu.be/hackos-demo" />
          </label>
          <label>
            GitHub repository
            <input defaultValue="https://github.com/pixel-pioneers/hackos" />
          </label>
        </div>
        <div className="submit">
          <p>Server time controls the deadline. Every update creates a version.</p>
          <Button
            onClick={() => {
              setSent(true);
              notify("Demo submission created");
            }}
          >
            Submit project
          </Button>
        </div>
      </Card>
      <Card title="Version history">
        {sent && (
          <div className="version">
            <i>v2</i>
            <span>
              <b>Submission received</b>
              <small>Receipt DEMO-9F2K · just now</small>
            </span>
            <Pill>Current</Pill>
          </div>
        )}
        <div className="version">
          <i>v1</i>
          <span>
            <b>Initial draft</b>
            <small>Receipt HX-84F2 · yesterday</small>
          </span>
          <Pill tone="blue">Saved</Pill>
        </div>
      </Card>
    </>
  );
}

function Results({ notify }: { notify: (s: string) => void }) {
  return (
    <>
      <section className="winner">
        <b>★</b>
        <span>
          <small>FINAL RESULT</small>
          <h2>Pixel Pioneers placed #3</h2>
          <p>AI for Social Impact · 87.4 points</p>
        </span>
        <Button secondary onClick={() => notify("Certificate download simulated")}>
          Download certificate
        </Button>
      </section>
      <div className="grid two">
        <Card title="Score breakdown">
          {[
            ["Innovation", 92],
            ["Impact", 89],
            ["Technical", 84],
            ["Presentation", 86],
          ].map((x) => (
            <div className="score" key={x[0]}>
              <span>{x[0]}</span>
              <progress value={x[1]} max="100" />
              <b>{x[1]}</b>
            </div>
          ))}
          <blockquote>
            “Strong validation and a polished demo.”<small>— Judge feedback</small>
          </blockquote>
        </Card>
        <Card title="RewardLink">
          <Pill tone="amber">Processing</Pill>
          <h3>₹15,000 Track Prize</h3>
          <p>Sponsor verification complete. Payment expected by 30 Nov.</p>
          <div className="reward">
            <i />
            <i />
            <i className="pending" />
            <i />
          </div>
          <Button secondary onClick={() => notify("Complaint form opened")}>
            Report an issue
          </Button>
        </Card>
      </div>
      <Card title="Community Connect">
        <div className="person">
          <i className="purple">RM</i>
          <span>
            <b>Riya Menon</b>
            <small>Winner · Climate track · React, IoT</small>
          </span>
          <Button secondary onClick={() => notify("Connection request sent")}>
            Connect
          </Button>
        </div>
      </Card>
    </>
  );
}

function Profile({
  dark,
  setDark,
  notify,
}: {
  dark: boolean;
  setDark: (v: boolean) => void;
  notify: (s: string) => void;
}) {
  return (
    <div className="grid profile">
      <Card title="Profile">
        <div className="profile-head">
          <i className="avatar">AM</i>
          <span>
            <h2>Aarav Mehta</h2>
            <p>aarav@example.com · +91 •••••• 4821</p>
          </span>
        </div>
        <div className="form">
          <label>
            College
            <input defaultValue="Pune Institute of Technology" />
          </label>
          <label>
            Year
            <input defaultValue="3" />
          </label>
          <label>
            GitHub
            <input defaultValue="aarav-builds" />
          </label>
          <label>
            Skills
            <input defaultValue="React, TypeScript, UI Design" />
          </label>
        </div>
        <Button onClick={() => notify("Profile saved locally")}>Save changes</Button>
      </Card>
      <div>
        <Card title="Preferences">
          <div className="toggle">
            <span>
              <b>Dark mode</b>
              <p>Use the low-light theme.</p>
            </span>
            <button className={dark ? "switch on" : "switch"} onClick={() => setDark(!dark)}>
              <i />
            </button>
          </div>
          <div className="toggle">
            <span>
              <b>Push notifications</b>
              <p>Schedule and emergency alerts.</p>
            </span>
            <button className="switch on">
              <i />
            </button>
          </div>
        </Card>
        <Card title="Device & account">
          <div className="tools">
            <button onClick={() => notify("ID reissue opened")}>↻ Reissue digital ID</button>
            <button onClick={() => notify("Signed out in demo")}>→ Sign out</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
