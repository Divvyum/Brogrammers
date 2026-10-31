import { useState } from "react";
import { DateTimeInput, Field, ListInput, PageIntro } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent, type EventDoc } from "../lib/event";
import { useAction } from "../lib/hooks";
import { fmtDate } from "../lib/format";

// Event setup wizard (plan A4): basics → mode → team rules → tracks and rounds →
// eligibility → deadlines → review. The super admin creates events; organizers edit theirs.

const STEPS = ["Basics", "Mode", "Team rules", "Tracks & rounds", "Eligibility", "Deadlines", "Review"] as const;

interface Draft {
  name: string;
  code: string;
  mode: "online" | "offline" | "hybrid";
  startAt: string;
  endAt: string;
  teamMin: number;
  teamMax: number;
  tracks: string[];
  rounds: { id: string; name: string; startAt: string; endAt: string }[];
  eligibilityRules: { allowedYears: number[]; allowedColleges: string[]; requiredFields: string[] };
  deadlines: { teamLock: string; submission: string };
  leaderboardVisible: boolean;
}

const empty: Draft = {
  name: "",
  code: "",
  mode: "offline",
  startAt: "",
  endAt: "",
  teamMin: 2,
  teamMax: 4,
  tracks: [],
  rounds: [],
  eligibilityRules: { allowedYears: [], allowedColleges: [], requiredFields: [] },
  deadlines: { teamLock: "", submission: "" },
  leaderboardVisible: false,
};

function fromEvent(e: EventDoc): Draft {
  return {
    name: e.name,
    code: e.code,
    mode: e.mode as Draft["mode"],
    startAt: e.startAt,
    endAt: e.endAt,
    teamMin: e.teamMin,
    teamMax: e.teamMax,
    tracks: e.tracks,
    rounds: e.rounds ?? [],
    eligibilityRules: {
      allowedYears: e.eligibilityRules?.allowedYears ?? [],
      allowedColleges: e.eligibilityRules?.allowedColleges ?? [],
      requiredFields: e.eligibilityRules?.requiredFields ?? [],
    },
    deadlines: e.deadlines,
    leaderboardVisible: e.leaderboardVisible,
  };
}

/** Problems that block saving, per step. */
function problems(d: Draft): Partial<Record<(typeof STEPS)[number], string>> {
  const p: Partial<Record<(typeof STEPS)[number], string>> = {};
  if (!d.name.trim()) p.Basics = "Give the event a name.";
  else if (!/^[A-Z0-9]{4,12}$/.test(d.code)) p.Basics = "Code: 4–12 capital letters or digits.";
  else if (!d.startAt || !d.endAt || d.startAt >= d.endAt) p.Basics = "The event must end after it starts.";
  if (d.teamMin < 1 || d.teamMin > d.teamMax) p["Team rules"] = "Minimum must be between 1 and the maximum.";
  if (!d.tracks.length) p["Tracks & rounds"] = "Add at least one track.";
  if (!d.deadlines.teamLock || !d.deadlines.submission) p.Deadlines = "Set both deadlines.";
  return p;
}

export function EventSetup() {
  const { role } = useSession();
  const { event } = useEvent();
  const [newEvent, setNewEvent] = useState(false);
  const creating = newEvent || !event;
  if (role !== "superadmin" && !event) return <div className="panel blank"><h2>No event assigned</h2></div>;
  // Remounting per event resets the form when the event (or its data) arrives.
  return (
    <Wizard
      key={creating ? "new" : event!.id}
      initial={creating ? empty : fromEvent(event!)}
      creating={creating}
      onToggleNew={event ? () => setNewEvent(!newEvent) : undefined}
      onCreated={() => setNewEvent(false)}
    />
  );
}

function Wizard({ initial, creating, onToggleNew, onCreated }: { initial: Draft; creating: boolean; onToggleNew?: () => void; onCreated: () => void }) {
  const { role } = useSession();
  const { event, setEventId } = useEvent();
  const isSuper = role === "superadmin";
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(initial);
  const { run, busy } = useAction();

  const issues = problems(d);
  const name = STEPS[step]!;
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const save = async () => {
    const body = {
      ...d,
      eligibilityRules: {
        allowedYears: d.eligibilityRules.allowedYears.length ? d.eligibilityRules.allowedYears : undefined,
        allowedColleges: d.eligibilityRules.allowedColleges.length ? d.eligibilityRules.allowedColleges : undefined,
        requiredFields: d.eligibilityRules.requiredFields,
      },
    };
    if (creating) {
      const r = await run<{ id: string }>("POST", "/events", body, "Event created");
      if (r) {
        setEventId(r.id);
        onCreated();
      }
    } else if (event) {
      const { code: _code, rounds: _rounds, ...patch } = body;
      await run("PATCH", `/events/${event.id}`, patch, "Event saved");
    }
  };

  return (
    <div>
      <PageIntro
        eyebrow="EVENT"
        title={creating ? "Create an event" : `Edit ${event?.name ?? ""}`}
        subtitle={creating ? "Only the super admin creates events." : `Event code ${event?.code} · volunteers type this with their PIN.`}
        actions={
          isSuper &&
          onToggleNew && (
            <button className="secondary" onClick={onToggleNew}>
              {creating ? "Edit current event instead" : "+ New event"}
            </button>
          )
        }
      />
      <div className="wizard">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <button key={s} className={i === step ? "step-on" : issues[s] ? "step-bad" : ""} onClick={() => setStep(i)}>
              {String(i + 1).padStart(2, "0")}
              <b>{s}</b>
            </button>
          ))}
        </div>

        <div className="form-grid">
          {name === "Basics" && (
            <>
              <Field label="Event name">
                <input value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Event code" hint="Volunteers type this at scanner login. Can't change later.">
                <input value={d.code} disabled={!creating} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Starts">
                <DateTimeInput value={d.startAt} onChange={(v) => set({ startAt: v })} />
              </Field>
              <Field label="Ends">
                <DateTimeInput value={d.endAt} onChange={(v) => set({ endAt: v })} />
              </Field>
            </>
          )}
          {name === "Mode" && (
            <div className="choice-cards">
              {(["offline", "online", "hybrid"] as const).map((m) => (
                <button key={m} type="button" className={d.mode === m ? "choice on" : "choice"} onClick={() => set({ mode: m })}>
                  <b>{m}</b>
                  <small>{m === "offline" ? "Venue, rooms, check-in" : m === "online" ? "No venue" : "Both"}</small>
                </button>
              ))}
            </div>
          )}
          {name === "Team rules" && (
            <>
              <Field label="Minimum team size">
                <input type="number" min={1} value={d.teamMin} onChange={(e) => set({ teamMin: Number(e.target.value) })} />
              </Field>
              <Field label="Maximum team size">
                <input type="number" min={1} value={d.teamMax} onChange={(e) => set({ teamMax: Number(e.target.value) })} />
              </Field>
            </>
          )}
          {name === "Tracks & rounds" && (
            <>
              <Field label="Tracks" hint="Comma separated, e.g. AI, FinTech, Open">
                <ListInput value={d.tracks} onChange={(tracks) => set({ tracks })} />
              </Field>
              <div className="field">
                <span>Judging rounds</span>
                {d.rounds.map((r, i) => (
                  <div key={i} className="inline-row">
                    <input value={r.name} placeholder="Round name" onChange={(e) => set({ rounds: d.rounds.map((x, j) => (j === i ? { ...x, name: e.target.value, id: x.id || `r${i + 1}` } : x)) })} />
                    <DateTimeInput value={r.startAt} onChange={(v) => set({ rounds: d.rounds.map((x, j) => (j === i ? { ...x, startAt: v } : x)) })} />
                    <DateTimeInput value={r.endAt} onChange={(v) => set({ rounds: d.rounds.map((x, j) => (j === i ? { ...x, endAt: v } : x)) })} />
                    <button type="button" className="text-button" onClick={() => set({ rounds: d.rounds.filter((_, j) => j !== i) })}>
                      Remove
                    </button>
                  </div>
                ))}
                {creating && (
                  <button type="button" className="secondary" onClick={() => set({ rounds: [...d.rounds, { id: `r${d.rounds.length + 1}`, name: "", startAt: d.startAt, endAt: d.endAt }] })}>
                    + Add round
                  </button>
                )}
                {!creating && <small className="hint">Rounds are fixed after creation.</small>}
              </div>
            </>
          )}
          {name === "Eligibility" && (
            <>
              <Field label="Allowed years of study" hint="e.g. 1, 2, 3, 4. Empty = any year.">
                <ListInput
                  value={d.eligibilityRules.allowedYears.map(String)}
                  onChange={(v) => set({ eligibilityRules: { ...d.eligibilityRules, allowedYears: v.map(Number).filter((n) => n > 0) } })}
                />
              </Field>
              <Field label="Approved colleges" hint="Others are flagged for review. Empty = any college.">
                <ListInput value={d.eligibilityRules.allowedColleges} onChange={(v) => set({ eligibilityRules: { ...d.eligibilityRules, allowedColleges: v } })} />
              </Field>
              <Field label="Required profile fields" hint="e.g. college, city, githubUsername">
                <ListInput value={d.eligibilityRules.requiredFields} onChange={(v) => set({ eligibilityRules: { ...d.eligibilityRules, requiredFields: v } })} />
              </Field>
            </>
          )}
          {name === "Deadlines" && (
            <>
              <Field label="Team lock" hint="Teams lock automatically at this time.">
                <DateTimeInput value={d.deadlines.teamLock} onChange={(v) => set({ deadlines: { ...d.deadlines, teamLock: v } })} />
              </Field>
              <Field label="Submission deadline" hint="Checked against server time.">
                <DateTimeInput value={d.deadlines.submission} onChange={(v) => set({ deadlines: { ...d.deadlines, submission: v } })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={d.leaderboardVisible} onChange={(e) => set({ leaderboardVisible: e.target.checked })} /> Leaderboard visible to participants
              </label>
            </>
          )}
          {name === "Review" && (
            <div className="review">
              <dl>
                <dt>Name</dt>
                <dd>
                  {d.name} ({d.code})
                </dd>
                <dt>When</dt>
                <dd>
                  {fmtDate(d.startAt)} → {fmtDate(d.endAt)} · {d.mode}
                </dd>
                <dt>Teams</dt>
                <dd>
                  {d.teamMin}–{d.teamMax} people
                </dd>
                <dt>Tracks</dt>
                <dd>{d.tracks.join(", ") || "—"}</dd>
                <dt>Eligibility</dt>
                <dd>
                  Years {d.eligibilityRules.allowedYears.join(", ") || "any"} · colleges {d.eligibilityRules.allowedColleges.length || "any"} · required{" "}
                  {d.eligibilityRules.requiredFields.join(", ") || "nothing"}
                </dd>
                <dt>Deadlines</dt>
                <dd>
                  Team lock {fmtDate(d.deadlines.teamLock)} · submission {fmtDate(d.deadlines.submission)}
                </dd>
              </dl>
              {Object.entries(issues).map(([s, msg]) => (
                <div key={s} className="notice">
                  {s}: {msg}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="wizard-actions">
          <span>{issues[name] ?? ""}</span>
          <div className="button-row">
            <button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button className="primary" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className="primary" disabled={busy || Object.keys(issues).length > 0} onClick={save}>
                {creating ? "Create event" : "Save changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
