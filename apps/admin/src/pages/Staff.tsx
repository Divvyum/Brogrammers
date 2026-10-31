import { useState } from "react";
import type { StaffRole } from "@hackos/shared";
import { DataTable, Dialog, Field, Loader, PageIntro, Panel, ReasonDialog, Status } from "../components/common";
import { useSession } from "../auth/Session";
import { useEvent } from "../lib/event";
import { useAction, useApi } from "../lib/hooks";
import { label } from "../lib/format";

// Staff management (plan A3): create, list, change role, disable; volunteer PINs.

interface StaffRow extends Record<string, unknown> {
  uid: string;
  name: string;
  email: string | null;
  role: StaffRole;
  disabled: boolean;
  hasPin: boolean;
}

export function Staff() {
  const { role } = useSession();
  const { eventId } = useEvent();
  const isSuper = role === "superadmin";
  const roles: StaffRole[] = isSuper ? ["organizer", "volunteer", "mentor", "judge"] : ["volunteer", "mentor", "judge"];
  const list = useApi<{ items: StaffRow[] }>(eventId ? `/staff${isSuper ? `?eventId=${eventId}` : ""}` : null);
  const { run, busy } = useAction();
  const [form, setForm] = useState({ name: "", email: "", role: roles[0] as StaffRole });
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [pin, setPin] = useState<{ name: string; pin: string } | null>(null);
  const [pending, setPending] = useState<null | { kind: "role"; role: StaffRole } | { kind: "disable" }>(null);
  const [filter, setFilter] = useState<"all" | StaffRole>("all");

  const create = async () => {
    const r = await run("POST", "/staff", { ...form, eventId: isSuper ? eventId : undefined }, `${form.name} added as ${form.role}`);
    if (r) setForm({ ...form, name: "", email: "" });
  };

  return (
    <div>
      <PageIntro eyebrow="PEOPLE" title="Staff" subtitle="Organizers, volunteers, mentors and judges for this event." />
      <Panel title="Add staff" className="staff-create">
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email (their Google account)">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              {roles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <button className="primary" disabled={busy}>
            Add
          </button>
        </form>
      </Panel>

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All roles</option>
          {["organizer", "volunteer", "mentor", "judge"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <Loader query={list}>
        {(d) => (
          <DataTable
            rows={d.items.filter((s) => filter === "all" || s.role === filter)}
            rowKey={(r) => r.uid}
            onRow={setSelected}
            columns={[
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "role", label: "Role", render: (r) => label(r.role) },
              { key: "hasPin", label: "Scanner PIN", render: (r) => (r.role === "volunteer" ? (r.hasPin ? "Issued" : "Not issued") : "—") },
              { key: "disabled", label: "Status", render: (r) => <Status value={r.disabled ? "disabled" : "active"} /> },
            ]}
          />
        )}
      </Loader>

      {selected && !pending && (
        <Dialog title={selected.name} onClose={() => setSelected(null)}>
          <p className="muted">
            {selected.email} · {label(selected.role)}
          </p>
          <div className="button-row">
            {selected.role === "volunteer" && (
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const r = await run<{ pin: string }>("POST", `/staff/${selected.uid}/pin`, {});
                  if (r) setPin({ name: selected.name, pin: r.pin });
                }}
              >
                {selected.hasPin ? "Issue new PIN" : "Issue scanner PIN"}
              </button>
            )}
            {roles
              .filter((r) => r !== selected.role)
              .map((r) => (
                <button key={r} className="secondary" onClick={() => setPending({ kind: "role", role: r })}>
                  Make {r}
                </button>
              ))}
            <button className="secondary danger-text" onClick={() => setPending({ kind: "disable" })}>
              {selected.disabled ? "Re-enable" : "Disable"}
            </button>
          </div>
        </Dialog>
      )}
      {selected && pending?.kind === "role" && (
        <ReasonDialog
          title={`Change ${selected.name} to ${pending.role}`}
          description="The new role applies the next time they sign in."
          busy={busy}
          onClose={() => {
            setPending(null);
            setSelected(null);
          }}
          onConfirm={(reason) => run("PATCH", `/staff/${selected.uid}/role`, { role: pending.role, reason }, "Role changed")}
        />
      )}
      {selected && pending?.kind === "disable" && (
        <ReasonDialog
          title={selected.disabled ? `Re-enable ${selected.name}` : `Disable ${selected.name}`}
          description={selected.disabled ? "They can sign in again." : "They are signed out everywhere and can't sign in or use the scanner."}
          busy={busy}
          onClose={() => {
            setPending(null);
            setSelected(null);
          }}
          onConfirm={(reason) => run("POST", `/staff/${selected.uid}/disable`, { disabled: !selected.disabled, reason }, "Saved")}
        />
      )}
      {pin && (
        <Dialog title={`Scanner PIN for ${pin.name}`} onClose={() => setPin(null)}>
          <p className="big-code">{pin.pin}</p>
          <p className="hint">Shown once. Give it to the volunteer privately; issuing a new PIN replaces this one.</p>
        </Dialog>
      )}
    </div>
  );
}
