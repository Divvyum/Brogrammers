import { useState, type MouseEvent } from "react";
import { EventContent, type MapMarker } from "@hackos/shared";
import { Field, ListInput, PageIntro, Panel } from "../components/common";
import { api } from "../api/client";
import { useEvent } from "../lib/event";
import { errorMessage, useAction } from "../lib/hooks";
import { useToast } from "../ui/ToastContext";

// What participants see in the student app: venue and help details, rules,
// prizes, alumni and the venue map. Saved on the event as `content`.

const LAYERS: { id: MapMarker["layer"]; label: string; color: string }[] = [
  { id: "rooms", label: "Room", color: "#6366f1" },
  { id: "food", label: "Food", color: "#f59e0b" },
  { id: "wash", label: "Washroom", color: "#14b8a6" },
  { id: "mentor", label: "Mentor desk", color: "#ec4899" },
  { id: "gate", label: "Gate / help", color: "#ef4444" },
];
const TONES = ["amber", "slate", "rose", "indigo"] as const;

export function Content() {
  const { base, event } = useEvent();
  const { run, busy } = useAction();
  const { show } = useToast();
  const saved = EventContent.parse((event as { content?: unknown } | undefined)?.content ?? {});
  const [c, setC] = useState<EventContent>(saved);
  const [loadedFor, setLoadedFor] = useState(event?.id);
  // Reload the form when the organizer switches events.
  if (event?.id !== loadedFor) {
    setLoadedFor(event?.id);
    setC(saved);
  }
  const [layer, setLayer] = useState<MapMarker["layer"]>("rooms");
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof EventContent>(k: K, v: EventContent[K]) => setC({ ...c, [k]: v });

  const uploadMap = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const sig = await api<Record<string, string | number> & { uploadUrl: string; maxBytes: number }>(`${base}/uploads/sign`, { method: "POST", body: { folder: "venue" } });
      if (file.size > sig.maxBytes) throw new Error(`File is over ${Math.round(sig.maxBytes / 1_048_576)} MB`);
      const form = new FormData();
      form.append("file", file);
      for (const k of ["api_key", "timestamp", "signature", "folder", "allowed_formats"]) form.append(k, String(k === "api_key" ? sig.apiKey : sig[k]));
      const json = (await (await fetch(sig.uploadUrl, { method: "POST", body: form })).json()) as { secure_url?: string; error?: { message: string } };
      if (!json.secure_url) throw new Error(json.error?.message ?? "Upload failed");
      set("map", { ...c.map, imageUrl: json.secure_url });
      show("Map uploaded. Click on it to add markers, then save.", "success");
    } catch (e) {
      show(errorMessage(e), "error");
    } finally {
      setUploading(false);
    }
  };

  const addMarker = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const name = window.prompt(`Label for this ${LAYERS.find((l) => l.id === layer)!.label.toLowerCase()} (use the exact room name for rooms)`)?.trim();
    if (!name) return;
    const x = Math.round(((e.clientX - box.left) / box.width) * 1000) / 10;
    const y = Math.round(((e.clientY - box.top) / box.height) * 1000) / 10;
    set("map", { ...c.map, markers: [...c.map.markers, { layer, label: name.slice(0, 40), x, y }] });
  };

  const save = () => {
    const parsed = EventContent.safeParse(c);
    if (!parsed.success) return show(parsed.error.issues[0]?.message ?? "Check the form", "error");
    void run("PUT", `${base}/content`, parsed.data, "Saved. Participants see it now.");
  };

  return (
    <div>
      <PageIntro
        eyebrow="OVERVIEW"
        title="Participant page"
        subtitle="Venue, help contacts, rules, prizes, alumni and the venue map shown in the student app."
        actions={
          <button className="primary" disabled={busy || !base} onClick={save}>
            Save changes
          </button>
        }
      />

      <div className="split-panels">
        <Panel title="Venue and help">
          <div className="form-grid tight">
            <Field label="Venue">
              <input value={c.venue} onChange={(e) => set("venue", e.target.value)} placeholder="e.g. TSEC, Bandra West, Mumbai" />
            </Field>
            <Field label="Help phone" hint="Venue doctor or emergency number on the help desk">
              <input value={c.helpPhone} onChange={(e) => set("helpPhone", e.target.value)} placeholder="+91 22 0000 0000" />
            </Field>
            <Field label="Organizers' WhatsApp" hint="Digits with country code, e.g. 919820000000">
              <input value={c.whatsappNumber} inputMode="numeric" onChange={(e) => set("whatsappNumber", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Full rules (PDF link)">
              <input type="url" value={c.rulesUrl} onChange={(e) => set("rulesUrl", e.target.value)} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Tagline on the Event page">
            <textarea value={c.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="48 hours to build solutions for real problems…" />
          </Field>
          <Field label="Extra eligibility rules" hint="Shown under the rules from Event setup">
            <ListInput value={c.rules} onChange={(v) => set("rules", v)} placeholder="Valid college ID at check-in" />
          </Field>
        </Panel>

        <Panel
          title="Prizes"
          actions={
            <button className="secondary" onClick={() => set("prizes", [...c.prizes, { place: "", prize: "", tone: "indigo" }])}>
              + Prize
            </button>
          }
        >
          {c.prizes.length === 0 && <p className="hint">No prizes yet. Participants see “Prizes will be announced soon”.</p>}
          <table className="edit-table">
            <tbody>
              {c.prizes.map((p, i) => (
                <tr key={i}>
                  <td><input aria-label="Place" value={p.place} placeholder="1st" onChange={(e) => set("prizes", c.prizes.map((x, j) => (j === i ? { ...x, place: e.target.value } : x)))} /></td>
                  <td><input aria-label="Prize" value={p.prize} placeholder="₹1,00,000 + internships" onChange={(e) => set("prizes", c.prizes.map((x, j) => (j === i ? { ...x, prize: e.target.value } : x)))} /></td>
                  <td>
                    <select aria-label="Colour" value={p.tone} onChange={(e) => set("prizes", c.prizes.map((x, j) => (j === i ? { ...x, tone: e.target.value as (typeof TONES)[number] } : x)))}>
                      {TONES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td><button className="text-button danger-text" onClick={() => set("prizes", c.prizes.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel
        title="Venue map"
        actions={
          <label className="secondary">
            {uploading ? "Uploading…" : c.map.imageUrl ? "Replace image" : "Upload map image"}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading} onChange={(e) => void uploadMap(e.target.files?.[0])} />
          </label>
        }
      >
        {!c.map.imageUrl ? (
          <p className="hint">Upload a floor plan or campus map (PNG or JPG, up to 5 MB), then click on it to place rooms, food, washrooms, mentor desks and gates.</p>
        ) : (
          <>
            <div className="chip-list" style={{ marginBottom: 12 }}>
              <span className="hint">Click the map to add:</span>
              {LAYERS.map((l) => (
                <button key={l.id} className={`chip ${layer === l.id ? "on" : ""}`} onClick={() => setLayer(l.id)}>
                  <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: l.color, marginRight: 6 }} />
                  {l.label}
                </button>
              ))}
            </div>
            <div style={{ position: "relative", cursor: "crosshair", borderRadius: 16, overflow: "hidden", border: "1px solid var(--line)" }} onClick={addMarker}>
              <img src={c.map.imageUrl} alt="Venue map" style={{ display: "block", width: "100%" }} />
              {c.map.markers.map((m, i) => (
                <span key={i} title={m.label} style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 14, background: LAYERS.find((l) => l.id === m.layer)?.color, border: "3px solid #fff", boxShadow: "0 2px 6px #0003" }} />
                  <b style={{ fontSize: 12, background: "#fffd", color: "#141a46", padding: "1px 6px", borderRadius: 6 }}>{m.label}</b>
                </span>
              ))}
            </div>
            {c.map.markers.length > 0 && (
              <ul className="member-list">
                {c.map.markers.map((m, i) => (
                  <li key={i}>
                    <span>
                      <b>{m.label}</b> <span className="muted">· {LAYERS.find((l) => l.id === m.layer)?.label}</span>
                    </span>
                    <button className="text-button danger-text" onClick={() => set("map", { ...c.map, markers: c.map.markers.filter((_, j) => j !== i) })}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="Alumni"
        actions={
          <button className="secondary" onClick={() => set("alumni", [...c.alumni, { name: "", year: "", now: "", url: "" }])}>
            + Alumnus
          </button>
        }
      >
        {c.alumni.length === 0 && <p className="hint">Winners and finalists from past editions, shown under Community → Alumni.</p>}
        <table className="edit-table">
          {c.alumni.length > 0 && (
            <thead>
              <tr><th>Name</th><th>Edition and result</th><th>Now</th><th>Profile link</th><th /></tr>
            </thead>
          )}
          <tbody>
            {c.alumni.map((a, i) => {
              const edit = (k: keyof typeof a) => (e: { target: { value: string } }) => set("alumni", c.alumni.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
              return (
                <tr key={i}>
                  <td><input aria-label="Name" value={a.name} onChange={edit("name")} /></td>
                  <td><input aria-label="Edition" value={a.year} onChange={edit("year")} placeholder="HACKOS 2025 · Winner" /></td>
                  <td><input aria-label="Now" value={a.now} onChange={edit("now")} placeholder="SDE at Microsoft" /></td>
                  <td><input aria-label="Profile link" type="url" value={a.url ?? ""} onChange={edit("url")} placeholder="https://linkedin.com/in/…" /></td>
                  <td><button className="text-button danger-text" onClick={() => set("alumni", c.alumni.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
