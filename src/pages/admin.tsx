import { useMemo, useState } from "react";
import { History, KeyRound, Plus, ShieldCheck, Trash2, Users as UsersIcon, X, Eye } from "lucide-react";
import { useApp, fmtDate, timeAgo, uid } from "../store";
import {
  PERMISSION_CATALOG, PERMISSION_CATEGORIES, getRoleProfile, hasPermission, pushAudit,
} from "../rbac";
import type { Role, RoleDef } from "../types";
import { Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, RoleBadge, Select, TextArea, TextInput, tdCls, thCls } from "../ui";
import { AccessDenied } from "./Auth";

const BASE_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "teacher", label: "Teacher" },
  { value: "student", label: "Student" },
  { value: "guardian", label: "Guardian" },
];

/* ================= Role & permission management ================= */
export function RolesPage() {
  const { db, currentUser, update, toast } = useApp();
  const [edit, setEdit] = useState<RoleDef | "new" | null>(null);

  if (!hasPermission(db, currentUser, "roles.manage")) {
    return <AccessDenied required="roles.manage" reason="Only the Super Admin can manage roles and permission sets." />;
  }

  const isSuper = (getRoleProfile(db, currentUser)?.permissions ?? []).includes("*");
  const userCount = (roleId: string) => db.users.filter((u) => u.roleId === roleId).length;

  const blank: RoleDef = { id: "", name: "", description: "", permissions: [], status: "active", system: false, appliesTo: ["teacher"] };
  const draft = edit === "new" ? blank : edit;

  /** System roles: only a super-admin may touch their permission set; they can't be deleted. */
  const canEditPerms = (r: RoleDef) => !r.system || isSuper;

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast("Give the role a name.", "warn"); return; }
    if (draft.permissions.length === 0 && !draft.permissions.includes("*")) { toast("Select at least one permission.", "warn"); return; }
    update((d) => {
      if (draft.id) {
        const i = d.roles.findIndex((r) => r.id === draft.id);
        if (i >= 0) d.roles[i] = { ...draft, name: draft.name.trim() };
        pushAudit(d, currentUser, "role.update", draft.name, `${draft.permissions.length === 1 && draft.permissions[0] === "*" ? "full access" : draft.permissions.length + " permissions"}`);
      } else {
        d.roles.push({ ...draft, id: uid(), name: draft.name.trim(), system: false });
        pushAudit(d, currentUser, "role.create", draft.name);
      }
    });
    toast(draft.id ? "Role updated — permissions apply immediately." : "Role created.");
    setEdit(null);
  };

  const removeRole = (r: RoleDef) => {
    if (r.system) { toast("System roles can't be deleted.", "warn"); return; }
    if (userCount(r.id) > 0) { toast(`Reassign the ${userCount(r.id)} user(s) using this role first.`, "warn"); return; }
    update((d) => { d.roles = d.roles.filter((x) => x.id !== r.id); pushAudit(d, currentUser, "role.delete", r.name); });
    toast("Role deleted.");
  };

  const toggleStatus = (r: RoleDef) => {
    if (r.system && !isSuper) { toast("Only the Super Admin can change a system role.", "warn"); return; }
    update((d) => {
      const x = d.roles.find((y) => y.id === r.id)!;
      x.status = x.status === "active" ? "disabled" : "active";
      pushAudit(d, currentUser, x.status === "active" ? "role.enable" : "role.disable", r.name);
    });
    toast(r.status === "active" ? `${r.name} disabled — its users lose access immediately.` : `${r.name} re-activated.`);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="System" title="Roles & permissions" sub="A role is a named collection of permissions. Assign profiles to users; access updates the moment a set changes.">
        <Btn variant="gold" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> New role</Btn>
      </PageHead>

      <Panel className="anim-rise overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-mist bg-paper/60">
              <tr><th className={thCls()}>Role</th><th className={thCls()}>Users</th><th className={thCls()}>Permissions</th><th className={thCls()}>Status</th><th className={thCls()}></th></tr>
            </thead>
            <tbody className="divide-y divide-mist/70">
              {db.roles.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-pine-50/50">
                  <td className={tdCls()}>
                    <span className="flex items-center gap-2.5">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${r.permissions.includes("*") ? "bg-gold-100 text-gold-600" : "bg-pine-100 text-pine-700"}`}><KeyRound className="h-4 w-4" /></span>
                      <span>
                        <span className="block font-bold text-ink">{r.name}{r.system && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-soft">system</span>}</span>
                        <span className="block max-w-[320px] truncate text-[11px] text-soft">{r.description}</span>
                      </span>
                    </span>
                  </td>
                  <td className={tdCls()}><Chip tone="gray"><UsersIcon className="h-3 w-3" /> {userCount(r.id)}</Chip></td>
                  <td className={tdCls()}>
                    {r.permissions.includes("*") ? <Chip tone="gold">Full access (*)</Chip> : <Chip tone="pine">{r.permissions.length} permissions</Chip>}
                  </td>
                  <td className={tdCls()}>
                    <button onClick={() => toggleStatus(r)} className="cursor-pointer" title="Toggle status">
                      <Chip tone={r.status === "active" ? "pine" : "rust"}>
                        <span className={`h-1.5 w-1.5 rounded-full ${r.status === "active" ? "bg-pine-500 live-dot" : "bg-rust-500"}`} /> {r.status}
                      </Chip>
                    </button>
                  </td>
                  <td className={`${tdCls()} text-right whitespace-nowrap`}>
                    <span className="inline-flex gap-1">
                      <button onClick={() => setEdit({ ...r })} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700" title="Edit role"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => removeRole(r)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600 disabled:opacity-30" disabled={r.system} title={r.system ? "System roles can't be deleted" : "Delete role"}><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {draft && (
        <RoleModal draft={draft} canEditPerms={canEditPerms(draft)} onClose={() => setEdit(null)} onSave={save} setDraft={(p) => setEdit(p)} />
      )}
    </div>
  );
}

function RoleModal({ draft, canEditPerms, onClose, onSave, setDraft }: {
  draft: RoleDef;
  canEditPerms: boolean;
  onClose: () => void;
  onSave: () => void;
  setDraft: (p: RoleDef) => void;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, typeof PERMISSION_CATALOG>();
    for (const c of PERMISSION_CATEGORIES) m.set(c, PERMISSION_CATALOG.filter((p) => p.category === c));
    return m;
  }, []);
  const isFull = draft.permissions.includes("*");

  const togglePerm = (id: string) => {
    if (!canEditPerms) return;
    setDraft({ ...draft, permissions: draft.permissions.includes(id) ? draft.permissions.filter((p) => p !== id) : [...draft.permissions, id] });
  };
  const toggleAll = (cat: string) => {
    if (!canEditPerms) return;
    const ids = PERMISSION_CATALOG.filter((p) => p.category === cat).map((p) => p.id);
    const allOn = ids.every((id) => draft.permissions.includes(id));
    setDraft({ ...draft, permissions: allOn ? draft.permissions.filter((p) => !ids.includes(p)) : [...new Set([...draft.permissions, ...ids])] });
  };

  return (
    <Modal title={draft.id ? `Edit role — ${draft.name}` : "New role"} kicker="Permission collection" onClose={onClose} wide
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={onSave}><ShieldCheck className="h-4 w-4" /> Save role</Btn>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name" required><TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Academic Coordinator" /></Field>
        <Field label="Applies to" required>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {BASE_ROLES.map((br) => {
              const on = draft.appliesTo.includes(br.value);
              return (
                <button key={br.value} onClick={() => setDraft({ ...draft, appliesTo: on ? draft.appliesTo.filter((x) => x !== br.value) : [...draft.appliesTo, br.value] })}
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-all ${on ? "border-pine-700 bg-pine-800 text-pine-50" : "border-mist bg-card text-soft hover:border-pine-400"}`}>
                  {br.label}
                </button>
              );
            })}
          </div>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Description"><TextArea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="!min-h-[56px]" /></Field>
      </div>

      {!canEditPerms && (
        <p className="mt-3 rounded-lg border border-gold-200 bg-gold-100/60 px-3 py-2 text-[11.5px] font-semibold text-gold-700">
          This is a system role — only the Super Admin may change its permission set.
        </p>
      )}

      <div className="mt-4">
        <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Permissions — {draft.permissions.length} selected</p>
        <div className="max-h-[42vh] space-y-3 overflow-y-auto rounded-lg border border-mist p-3">
          {[...grouped.entries()].map(([cat, perms]) => {
            const allOn = perms.every((p) => draft.permissions.includes(p.id));
            return (
              <div key={cat}>
                <button onClick={() => toggleAll(cat)} className="mb-1.5 flex w-full cursor-pointer items-center justify-between rounded-md bg-paper px-2 py-1 text-left transition-colors hover:bg-pine-50">
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-pine-800">{cat}</span>
                  <span className="text-[10.5px] font-semibold text-soft">{perms.filter((p) => draft.permissions.includes(p.id)).length}/{perms.length}</span>
                </button>
                <div className="grid gap-1 sm:grid-cols-2">
                  {perms.map((p) => {
                    const on = draft.permissions.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => togglePerm(p.id)} disabled={!canEditPerms}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-all disabled:cursor-not-allowed ${on ? "border-pine-600 bg-pine-50" : "border-mist bg-card hover:border-pine-300"}`}>
                        <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-pine-700 bg-pine-700 text-white" : "border-mist bg-card"}`}>
                          {on && <X className="hidden" />}<span className={`text-[9px] font-bold ${on ? "" : "text-transparent"}`}>✓</span>
                        </span>
                        <span>
                          <span className="block text-[11.5px] font-semibold leading-tight text-ink">{p.name}</span>
                          <span className="block text-[10px] leading-snug text-soft">{p.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10.5px] text-soft">{isFull ? "This role has full access to every module." : "Grant only what the role needs — least privilege is enforced everywhere."}</p>
      </div>
    </Modal>
  );
}

/* ================= Audit log ================= */
export function AuditPage() {
  const { db, currentUser } = useApp();
  const [q, setQ] = useState("");
  if (!hasPermission(db, currentUser, "audit.view")) {
    return <AccessDenied required="audit.view" reason="You don't have permission to view the audit trail." />;
  }
  const rows = db.audit.filter((a) =>
    !q || a.action.toLowerCase().includes(q.toLowerCase()) || a.target.toLowerCase().includes(q.toLowerCase()) || a.userName.toLowerCase().includes(q.toLowerCase())
  );
  const ACTION_TONE: Record<string, "pine" | "gold" | "rust" | "steel" | "gray"> = {
    "role.update": "gold", "role.create": "gold", "role.delete": "rust", "role.enable": "pine", "role.disable": "rust",
    "announcement.publish": "pine", "announcement.schedule": "steel", "announcement.draft": "gray",
    "user.deactivate": "rust", "user.create": "pine", "conversation.open": "steel", "message.report": "rust",
    "report.resolved": "pine", "report.dismissed": "gray", "conversation.hide": "rust", "event.create": "steel",
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHead kicker="System" title="Audit log" sub="Permission-sensitive actions, with who did what, to which target, and when." />
      <div className="mb-4 max-w-sm">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, target or user…" />
      </div>
      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60">
            <tr><th className={thCls()}>When</th><th className={thCls()}>User</th><th className={thCls()}>Action</th><th className={thCls()}>Target</th></tr>
          </thead>
          <tbody className="divide-y divide-mist/70">
            {rows.map((a) => (
              <tr key={a.id} className="transition-colors hover:bg-pine-50/40">
                <td className={`${tdCls()} whitespace-nowrap text-soft`}>
                  <span className="block text-[12px] font-semibold text-ink">{fmtDate(a.at.slice(0, 10))}</span>
                  <span className="text-[10.5px]">{timeAgo(a.at)}</span>
                </td>
                <td className={`${tdCls()} font-semibold text-ink`}>{a.userName}</td>
                <td className={tdCls()}><Chip tone={ACTION_TONE[a.action] ?? "gray"}><History className="h-3 w-3" /> {a.action}</Chip></td>
                <td className={tdCls()}>
                  <span className="font-semibold text-ink">{a.target}</span>
                  {a.detail && <span className="block text-[11px] text-soft">{a.detail}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4}><EmptyState icon={<History className="h-5 w-5" />} title="No matching entries" body="Permission-sensitive actions will be recorded here." /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
