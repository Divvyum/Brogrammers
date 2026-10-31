import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { backupCodeHash, b64u } from "@hackos/shared/crypto";
import type { CheckinMethod, CheckinResult, CheckinRejectReason } from "@hackos/shared";
import { QrCamera, QrImage } from "../components/Qr";
import { auth } from "../firebase";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { errorMessage } from "../lib/hooks";
import { fmtTime, initials } from "../lib/format";
import { getMeta, metaKey, requestPersistence, sdb } from "./db";
import { appendLog, confirmSynced, exportLog, loadRoster, syncRoster } from "./store";
import { REJECT_TEXT, verifyResponse, type PendingChallenge, type RosterEntry, type Verdict } from "./verify";

// Offline volunteer check-in scanner (plan A13, Samrat's guide). Works with no
// network once the app and roster are loaded: verification uses only the
// cached roster and the organizer's public key, and check-ins queue in
// Firestore's offline cache until the internet returns.

const CHALLENGE_ROTATE_MS = 20_000;
const EMPTY_ROSTER = new Map<string, RosterEntry>();
type Screen = "home" | "checkin" | "manual" | "log";

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Stable per-phone device ID (the volunteer-login response suggests one). */
function deviceIdFor(eventId: string) {
  const key = `device:${eventId}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = `vd_${b64u.enc(crypto.getRandomValues(new Uint8Array(9)))}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function ScanApp() {
  const { eventId: claimEvent, role, user } = useSession();
  const { eventId: ctxEvent } = useEvent();
  const eventId = role === "volunteer" ? claimEvent : ctxEvent;
  if (!eventId || !user) return <div className="scan-shell"><p>Sign in as a volunteer to use the scanner.</p></div>;
  return <Scanner eventId={eventId} />;
}

function Scanner({ eventId }: { eventId: string }) {
  const online = useOnline();
  const deviceId = useMemo(() => deviceIdFor(eventId), [eventId]);
  const [screen, setScreen] = useState<Screen>("home");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [continuous, setContinuous] = useState(() => localStorage.getItem("scan:continuous") === "1");
  const [teamMode, setTeamMode] = useState(() => localStorage.getItem("scan:team") === "1");
  const pending = useRef(new Map<string, PendingChallenge>());

  const meta = useLiveQuery(
    async () => ({
      version: (await getMeta<number>(metaKey(eventId, "rosterVersion"))) ?? 0,
      lastSync: await getMeta<string>(metaKey(eventId, "lastSync")),
      organizerPubKey: await getMeta<string>(metaKey(eventId, "organizerPubKey")),
    }),
    [eventId],
  );
  const roster = useLiveQuery(() => loadRoster(eventId), [eventId]) ?? EMPTY_ROSTER;
  const log = useLiveQuery(() => sdb.log.where("eventId").equals(eventId).reverse().sortBy("ts"), [eventId]) ?? [];
  const unsynced = log.filter((l) => !l.synced).length;
  const checkedIn = [...roster.values()].filter((r) => r.checkedInAt).length;

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      const r = await syncRoster(eventId);
      const confirmed = await confirmSynced(eventId);
      setMessage(`Roster v${r.version}: ${r.changed} updated${r.removed ? `, ${r.removed} removed` : ""}${confirmed ? ` · ${confirmed} check-ins confirmed` : ""}`);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, [eventId]);

  useEffect(() => {
    void requestPersistence();
  }, []);

  // Sync when the internet comes back, and every 30 seconds while online.
  useEffect(() => {
    if (!online) return;
    const first = setTimeout(() => void sync(), 0);
    const t = setInterval(() => void confirmSynced(eventId), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [online, sync, eventId]);

  useEffect(() => localStorage.setItem("scan:continuous", continuous ? "1" : "0"), [continuous]);
  useEffect(() => localStorage.setItem("scan:team", teamMode ? "1" : "0"), [teamMode]);

  const record = useCallback(
    async (entry: RosterEntry | undefined, pid: string, method: CheckinMethod, result: CheckinResult, extra: { rejectReason?: CheckinRejectReason; overrideNote?: string } = {}) => {
      const ts = new Date().toISOString();
      await appendLog({
        eventId,
        participantId: pid,
        deviceId,
        volunteerUid: auth.currentUser?.uid ?? "unknown",
        ts,
        method,
        result,
        ...extra,
        name: entry?.name,
      });
      if (entry && result === "valid") {
        await sdb.roster.update([eventId, pid], { checkedInAt: ts });
      }
    },
    [eventId, deviceId],
  );

  return (
    <div className="scan-shell">
      <header className="scan-top">
        <button className="text-button" onClick={() => setScreen("home")}>
          ← Scanner
        </button>
        <span className={online ? "pill good" : "pill bad"}>{online ? "Online" : "Offline"}</span>
        <span className="pill">{unsynced ? `${unsynced} to sync` : "All synced"}</span>
      </header>
      {message && (
        <div className="notice" onClick={() => setMessage("")}>
          {message}
        </div>
      )}

      {screen === "home" && (
        <div className="scan-home">
          <div className="scan-stats">
            <div>
              <b>{roster.size}</b>
              <small>in roster (v{meta?.version ?? 0})</small>
            </div>
            <div>
              <b>{checkedIn}</b>
              <small>checked in</small>
            </div>
            <div>
              <b>{unsynced}</b>
              <small>pending sync</small>
            </div>
          </div>
          <p className="hint">
            Last roster sync: {meta?.lastSync ? new Date(meta.lastSync).toLocaleString("en-IN") : "never"} · device {deviceId} · clock {new Date().toLocaleTimeString("en-IN")}
          </p>
          <button className="primary huge" disabled={!roster.size || !meta?.organizerPubKey} onClick={() => setScreen("checkin")}>
            Start check-in
          </button>
          {!roster.size && <p className="notice">Sync the roster while you're online before check-in can start.</p>}
          <button className="secondary huge" disabled={!online || syncing} onClick={sync}>
            {syncing ? "Syncing…" : online ? "Sync now" : "Sync now (offline)"}
          </button>
          <div className="scan-grid">
            <button className="secondary" disabled={!roster.size} onClick={() => setScreen("manual")}>
              Manual / backup code
            </button>
            <button className="secondary" onClick={() => setScreen("log")}>
              Log ({log.length})
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> Continuous scanning (camera reopens automatically)
          </label>
          <label className="check">
            <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} /> Team check-in (show teammates still to scan)
          </label>
          <p className="hint">Open this page once while online so it works offline. <Link to="/">Back to menu</Link></p>
        </div>
      )}

      {screen === "checkin" && meta?.organizerPubKey && (
        <CheckIn
          eventId={eventId}
          deviceId={deviceId}
          organizerPubKey={meta.organizerPubKey}
          roster={roster}
          pending={pending}
          log={log}
          continuous={continuous}
          teamMode={teamMode}
          record={record}
        />
      )}

      {screen === "manual" && <Manual eventId={eventId} roster={roster} log={log} record={record} />}

      {screen === "log" && (
        <div className="scan-log">
          <div className="button-row">
            <button className="secondary" disabled={!online || syncing} onClick={sync}>
              Sync now
            </button>
            <button className="secondary" onClick={() => exportLog(eventId)}>
              Export log (backup)
            </button>
          </div>
          <ul>
            {log.map((l) => (
              <li key={l.id}>
                <span className="mono">{fmtTime(l.ts)}</span>
                <span>
                  <b>{l.name ?? l.participantId}</b>
                  <small>
                    {l.method} · {l.result}
                    {l.rejectReason ? ` · ${l.rejectReason}` : ""}
                    {l.overrideNote ? ` · “${l.overrideNote}”` : ""}
                  </small>
                </span>
                <span className={l.synced ? "pill good" : "pill"}>{l.synced ? "synced" : "pending"}</span>
              </li>
            ))}
            {log.length === 0 && <li className="hint">No check-ins on this phone yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

type Recorder = (entry: RosterEntry | undefined, pid: string, method: CheckinMethod, result: CheckinResult, extra?: { rejectReason?: CheckinRejectReason; overrideNote?: string }) => Promise<void>;

function firstCheckInFrom(roster: Map<string, RosterEntry>, log: { participantId: string; result: string; ts: string }[]) {
  return (pid: string) => {
    const local = log.filter((l) => l.participantId === pid && l.result === "valid").map((l) => l.ts).sort()[0];
    return local ?? roster.get(pid)?.checkedInAt ?? null;
  };
}

function CheckIn({ eventId, deviceId, organizerPubKey, roster, pending, log, continuous, teamMode, record }: {
  eventId: string;
  deviceId: string;
  organizerPubKey: string;
  roster: Map<string, RosterEntry>;
  pending: RefObject<Map<string, PendingChallenge>>;
  log: { participantId: string; result: string; ts: string }[];
  continuous: boolean;
  teamMode: boolean;
  record: Recorder;
}) {
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [scanning, setScanning] = useState(continuous);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [left, setLeft] = useState(CHALLENGE_ROTATE_MS / 1000);
  const busy = useRef(false);

  // A new challenge every 20 seconds; each stays valid for 60, so the queue keeps moving.
  const rotate = useCallback(() => {
    const c: PendingChallenge = { n: b64u.enc(crypto.getRandomValues(new Uint8Array(16))), ts: Date.now(), vid: deviceId, ev: eventId };
    pending.current.set(c.n, c);
    setChallenge(c);
    setLeft(CHALLENGE_ROTATE_MS / 1000);
  }, [deviceId, eventId, pending]);

  useEffect(() => {
    const first = setTimeout(rotate, 0);
    const t = setInterval(rotate, CHALLENGE_ROTATE_MS);
    const tick = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      clearInterval(tick);
    };
  }, [rotate]);

  const onScan = async (raw: string) => {
    if (busy.current || verdict) return;
    busy.current = true;
    try {
      const v = await verifyResponse(raw, { eventId, organizerPubKey, roster, pending: pending.current, now: Date.now(), firstCheckIn: firstCheckInFrom(roster, log) });
      const pid = v.result === "rejected" ? (v.participantId ?? "unknown") : v.entry.participantId;
      await record(v.result === "rejected" ? v.entry : v.entry, pid, "qr", v.result, v.result === "rejected" ? { rejectReason: v.reason } : {});
      navigator.vibrate?.(v.result === "valid" ? 120 : [80, 60, 80]);
      setVerdict(v);
      setScanning(false);
      rotate();
    } finally {
      busy.current = false;
    }
  };

  const next = () => {
    setVerdict(null);
    if (continuous) setScanning(true);
  };

  // Continuous mode: back to scanning automatically after a moment.
  useEffect(() => {
    if (!verdict || !continuous) return;
    const t = setTimeout(next, verdict.result === "valid" ? 2500 : 4000);
    return () => clearTimeout(t);
  });

  if (verdict) return <Result verdict={verdict} roster={roster} teamMode={teamMode} onNext={next} />;

  return (
    <div className="scan-checkin">
      {challenge && (
        <div className="challenge">
          <p>
            <b>1.</b> Participant scans this code with <b>Check in</b> in their app
          </p>
          <QrImage text={JSON.stringify({ t: "chal", ...challenge })} size={300} />
          <small className="muted">New code in {left}s · each code works for 60s</small>
        </div>
      )}
      {scanning ? (
        <>
          <p>
            <b>2.</b> Scan the response code on their phone
          </p>
          <QrCamera onScan={onScan} hint="Point at the participant's response code" />
          {!continuous && (
            <button className="secondary full" onClick={() => setScanning(false)}>
              Show my code again
            </button>
          )}
        </>
      ) : (
        <button className="primary huge" onClick={() => setScanning(true)}>
          2. Scan their response
        </button>
      )}
    </div>
  );
}

function Photo({ entry, size = 140 }: { entry: RosterEntry; size?: number }) {
  const url = useMemo(() => (entry.photo ? URL.createObjectURL(entry.photo) : null), [entry.photo]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url ? (
    <img src={url} alt="" width={size} height={size} className="scan-photo" />
  ) : (
    <div className="scan-photo initials" style={{ width: size, height: size }}>
      {initials(entry.name)}
    </div>
  );
}

function Result({ verdict, roster, teamMode, onNext }: { verdict: Verdict; roster: Map<string, RosterEntry>; teamMode: boolean; onNext: () => void }) {
  const [flagged, setFlagged] = useState(false);
  const entry = verdict.result === "rejected" ? verdict.entry : verdict.entry;
  const teammates =
    teamMode && verdict.result === "valid" && entry?.teamId
      ? [...roster.values()].filter((r) => r.teamId === entry.teamId && r.participantId !== entry.participantId && !r.checkedInAt)
      : [];

  return (
    <div className={`scan-result-screen ${verdict.result}`} onClick={onNext}>
      <div className="verdict">{verdict.result === "valid" ? "VALID" : verdict.result === "duplicate" ? "ALREADY IN" : "REJECTED"}</div>
      {entry && <Photo entry={entry} />}
      {entry && <h2>{entry.name}</h2>}
      {entry && (
        <p className="who">
          {entry.teamName ?? "Solo"} · {entry.college ?? ""}
        </p>
      )}
      {verdict.result === "valid" && entry && (
        <div className="seat">
          <small>ROOM / SEAT</small>
          <b>{entry.seat ?? entry.roomId ?? "Help desk"}</b>
        </div>
      )}
      {verdict.result === "rejected" && <p className="reason">{REJECT_TEXT[verdict.reason]}</p>}
      {verdict.result === "duplicate" && (
        <>
          <p className="reason">First checked in at {fmtTime(verdict.firstAt)}.</p>
          <button
            className="secondary"
            onClick={(e) => {
              e.stopPropagation();
              setFlagged(true);
            }}
            disabled={flagged}
          >
            {flagged ? "Flagged: the organizer will review it" : "Flag for organizer"}
          </button>
        </>
      )}
      {teammates.length > 0 && (
        <div className="teammates">
          <small>STILL TO SCAN FROM THIS TEAM</small>
          {teammates.map((t) => (
            <span key={t.participantId}>{t.name}</span>
          ))}
        </div>
      )}
      <button className="primary huge" onClick={onNext}>
        Next person
      </button>
    </div>
  );
}

function Manual({ eventId, roster, log, record }: { eventId: string; roster: Map<string, RosterEntry>; log: { participantId: string; result: string; ts: string }[]; record: Recorder }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<RosterEntry | null>(null);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const firstAt = firstCheckInFrom(roster, log);
  const matches = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (s.length < 2) return [];
    return [...roster.values()].filter((r) => `${r.name} ${r.teamName ?? ""} ${r.participantId}`.toLowerCase().includes(s)).slice(0, 25);
  }, [q, roster]);

  const finish = async (method: CheckinMethod, note: string) => {
    if (!sel) return;
    const first = firstAt(sel.participantId);
    await record(sel, sel.participantId, method, first ? "duplicate" : "valid", { overrideNote: note });
    setResult(first ? { ok: false, text: `${sel.name} was already checked in at ${fmtTime(first)}. Recorded for the organizer.` } : { ok: true, text: `${sel.name} checked in · ${sel.seat ?? sel.roomId ?? "no seat yet"}` });
    setSel(null);
    setCode("");
    setReason("");
  };

  return (
    <div className="scan-manual">
      <input className="search" autoFocus placeholder="Search name, team or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      {result && <div className={`big-result ${result.ok ? "ok" : "bad"}`}>{result.text}</div>}
      {!sel && (
        <ul className="roster-list">
          {matches.map((r) => (
            <li key={r.participantId}>
              <button onClick={() => (setSel(r), setResult(null))}>
                <Photo entry={r} size={40} />
                <span>
                  <b>{r.name}</b>
                  <small>
                    {r.teamName ?? "Solo"} · {r.checkedInAt ? `in at ${fmtTime(r.checkedInAt)}` : r.status}
                  </small>
                </span>
              </button>
            </li>
          ))}
          {q.length >= 2 && matches.length === 0 && <li className="hint">Nobody matches. Sync the roster if they registered recently.</li>}
        </ul>
      )}
      {sel && (
        <div className="manual-card">
          <Photo entry={sel} size={96} />
          <h3>{sel.name}</h3>
          <p className="muted">
            {sel.teamName ?? "Solo"} · {sel.seat ?? "no seat yet"} {sel.status === "revoked" && <b className="danger-text">· ID REVOKED</b>}
          </p>
          {sel.backupCodeHash && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if ((await backupCodeHash(eventId, code)) === sel.backupCodeHash) {
                  await finish("code", "Backup code verified");
                } else {
                  await record(sel, sel.participantId, "code", "rejected", { overrideNote: "Backup code did not match" });
                  setResult({ ok: false, text: "That backup code doesn't match. Check their ID card, or use a manual check-in with a reason." });
                }
              }}
            >
              <label>
                Backup code from their ID card
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" maxLength={8} />
              </label>
              <button className="primary full" disabled={code.length !== 8}>
                Check in with backup code
              </button>
            </form>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void finish("manual", reason.trim());
            }}
          >
            <label>
              Or check in manually (reason required, e.g. "phone dead, checked college ID")
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button className="secondary full" disabled={reason.trim().length < 3}>
              Manual check-in
            </button>
          </form>
          <button className="text-button" onClick={() => setSel(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
