import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Bell, CalendarDays, Flag, Inbox, Lock, Megaphone, Paperclip, Search, Send, ShieldAlert, Users, Eye,
} from "lucide-react";
import { useApp, audienceLabel, audienceSize, fmtShort, timeAgo, uid } from "../store";
import {
  canCreateAnnouncement, canManageAnnouncement, canSeeAnnouncement, canSendMessage, canTargetAudience,
  canViewConversation, contactContext, contactGroups, conversationsFor, effectiveAnnouncementStatus,
  findDirectConversation, hasPermission, pushAudit, pushNotifications, totalUnreadMessages,
  unreadInConversation, unreadNotifications, userNotifications, visibleAnnouncements, audienceUserIds,
} from "../rbac";
import type { Announcement, Audience, Conversation, User } from "../types";
import { Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, RoleBadge, Select, Tabs, TextArea, TextInput, UserAvatar, tdCls, thCls } from "../ui";
import { AccessDenied } from "./Auth";

/* ================= shared bits ================= */
const CAT_META: Record<string, { bg: string; dot: string }> = {
  Urgent: { bg: "bg-rust-100 text-rust-700 border-rust-200", dot: "bg-rust-500" },
  Academic: { bg: "bg-pine-100 text-pine-800 border-pine-200", dot: "bg-pine-500" },
  Exams: { bg: "bg-steel-100 text-steel-700 border-steel-100", dot: "bg-steel-500" },
  Event: { bg: "bg-gold-100 text-gold-700 border-gold-200", dot: "bg-gold-500" },
  General: { bg: "bg-paper text-soft border-mist", dot: "bg-soft" },
};

function AudiencePicker({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  const { db } = useApp();
  const isSection = value.kind === "section-students" || value.kind === "section-guardians";
  const [classId, setClassId] = useState(isSection ? (value as { classId: string }).classId : db.classes[0]?.id ?? "");
  const [sectionId, setSectionId] = useState(isSection ? (value as { sectionId: string }).sectionId : "");
  const cls = db.classes.find((c) => c.id === classId);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Audience" required>
        <Select
          value={value.kind}
          onChange={(e) => {
            const k = e.target.value as Audience["kind"];
            if (k === "section-students" || k === "section-guardians")
              onChange({ kind: k, classId, sectionId: cls?.sections[0]?.id ?? "" });
            else onChange({ kind: k } as Audience);
          }}
        >
          <option value="everyone">Entire school</option>
          <option value="teachers">All teachers</option>
          <option value="students">All students</option>
          <option value="guardians">All families</option>
          <option value="section-students">Class / section — students</option>
          <option value="section-guardians">Class / section — families</option>
        </Select>
      </Field>
      {isSection && (
        <>
          <Field label="Class" required>
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); const c = db.classes.find((x) => x.id === e.target.value); const sid = c?.sections[0]?.id ?? ""; setSectionId(sid); onChange({ kind: value.kind, classId: e.target.value, sectionId: sid } as Audience); }}>
              {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Section" required>
            <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); onChange({ kind: value.kind, classId, sectionId: e.target.value } as Audience); }}>
              {cls?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
            </Select>
          </Field>
        </>
      )}
      <div className="sm:col-span-3 flex items-center gap-2 text-[12px] text-soft">
        <Users className="h-3.5 w-3.5 text-pine-600" />
        Reaches <strong className="text-ink">{audienceSize(db, value)}</strong> people — {audienceLabel(db, value)}
      </div>
    </div>
  );
}

/* ================= Announcements ================= */
export function AnnouncementsPage() {
  const { db, currentUser, update, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const canCreate = canCreateAnnouncement(db, currentUser);

  const list = visibleAnnouncements(db, currentUser)
    .filter((a) => filter === "all" || (filter === "mine" ? a.senderId === currentUser?.id : effectiveAnnouncementStatus(a) === filter))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt));

  const saveAnnouncement = (a: Announcement) => {
    update((d) => {
      const i = d.announcements.findIndex((x) => x.id === a.id);
      if (i >= 0) d.announcements[i] = a;
      else d.announcements.unshift(a);
      if (a.status === "published") {
        pushAudit(d, currentUser, "announcement.publish", a.title, audienceLabel(db, a.audience));
        const targets = audienceUserIds(d, a.audience).filter((id) => id !== currentUser?.id);
        pushNotifications(d, targets, "announcement", a.title, a.body.slice(0, 110));
      } else {
        pushAudit(d, currentUser, a.status === "scheduled" ? "announcement.schedule" : "announcement.draft", a.title);
      }
    });
    toast(a.status === "published" ? "Announcement published." : a.status === "scheduled" ? "Announcement scheduled." : "Draft saved.");
    setOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead kicker="Communication" title="Announcements" sub="Official one-to-many notices, targeted through the school's academic structure.">
        {canCreate && <Btn variant="gold" onClick={() => setOpen(true)}><Megaphone className="h-4 w-4" /> New announcement</Btn>}
      </PageHead>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["all", "All"], ["published", "Published"], ["scheduled", "Scheduled"], ["draft", "Drafts"], ["mine", "Mine"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-semibold transition-all ${filter === k ? "border-pine-700 bg-pine-800 text-pine-50" : "border-mist bg-card text-soft hover:border-pine-400"}`}>{l}</button>
        ))}
      </div>

      <div className="space-y-3">
        {list.map((a) => {
          const st = effectiveAnnouncementStatus(a);
          const cm = CAT_META[a.category] ?? CAT_META.General;
          const sender = db.users.find((u) => u.id === a.senderId);
          const readCount = a.readBy?.length ?? 0;
          const reach = audienceSize(db, a.audience);
          return (
            <Panel key={a.id} className="anim-rise overflow-hidden">
              <div className="flex gap-3 p-4">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cm.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-[15.5px] font-bold tracking-tight text-ink">{a.title}</h3>
                    {a.pinned && <Chip tone="gold">Pinned</Chip>}
                    <Chip tone={st === "published" ? "pine" : st === "scheduled" ? "steel" : st === "draft" ? "gray" : "rust"}>{st}</Chip>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-soft">{a.body}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-soft">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${cm.bg}`}>{a.category}</span>
                    <span>{sender?.name ?? "—"}</span>
                    <span>{st === "scheduled" && a.scheduledFor ? `scheduled ${fmtShort(a.scheduledFor)}` : timeAgo(a.createdAt)}</span>
                    <span>→ {audienceLabel(db, a.audience)}</span>
                    {st === "published" && <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> {readCount}/{reach} read</span>}
                  </div>
                </div>
                {canManageAnnouncement(db, currentUser, a) && (
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Btn size="sm" variant="soft" onClick={() => setOpen(true)} data-edit={a.id}>Edit</Btn>
                    {st !== "published" && (
                      <Btn size="sm" onClick={() => saveAnnouncement({ ...a, status: "published", publishedAt: new Date().toISOString(), scheduledFor: undefined })}>Publish</Btn>
                    )}
                    {st === "published" && (
                      <Btn size="sm" variant="ghost" onClick={() => saveAnnouncement({ ...a, status: "archived" })}>Archive</Btn>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
        {list.length === 0 && (
          <Panel><EmptyState icon={<Megaphone className="h-5 w-5" />} title="No announcements here" body="Announcements for your audience will appear on this board." /></Panel>
        )}
      </div>

      {open && <AnnouncementModal onClose={() => setOpen(false)} onSave={saveAnnouncement} />}
    </div>
  );
}

function AnnouncementModal({ onClose, onSave }: { onClose: () => void; onSave: (a: Announcement) => void }) {
  const { db, currentUser, toast } = useApp();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("General");
  const [audience, setAudience] = useState<Audience>({ kind: "everyone" });
  const [mode, setMode] = useState<"publish" | "schedule" | "draft">("publish");
  const [when, setWhen] = useState("");

  const submit = () => {
    if (!title.trim() || !body.trim()) { toast("Add a title and a message.", "warn"); return; }
    const gate = canTargetAudience(db, currentUser, audience);
    if (!gate.ok) { toast(gate.reason ?? "Not permitted for that audience.", "warn"); return; }
    const now = new Date().toISOString();
    const base: Announcement = {
      id: uid(), title: title.trim(), body: body.trim(), category: category as Announcement["category"],
      senderId: currentUser?.id ?? "", audience, createdAt: now, readBy: [currentUser?.id ?? ""],
      status: mode === "publish" ? "published" : mode === "schedule" ? "scheduled" : "draft",
      publishedAt: mode === "publish" ? now : undefined,
      scheduledFor: mode === "schedule" ? when || undefined : undefined,
    };
    if (mode === "schedule" && !base.scheduledFor) { toast("Pick a date and time to schedule.", "warn"); return; }
    onSave(base);
  };

  return (
    <Modal title="New announcement" kicker="One-to-many" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit}>{mode === "publish" ? "Publish now" : mode === "schedule" ? "Schedule" : "Save draft"}</Btn></>}>
      <div className="grid gap-4">
        <Field label="Title" required><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. School closed tomorrow" /></Field>
        <Field label="Message" required><TextArea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the announcement…" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {["General", "Urgent", "Academic", "Exams", "Event"].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Send as">
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="publish">Publish now</option>
              <option value="schedule">Schedule for later</option>
              <option value="draft">Save as draft</option>
            </Select>
          </Field>
        </div>
        {mode === "schedule" && (
          <Field label="Publish at" required><TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        )}
        <AudiencePicker value={audience} onChange={setAudience} />
      </div>
    </Modal>
  );
}

/* ================= Messages (inbox + thread) ================= */
export function MessagesPage() {
  const { db, currentUser, update, toast } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const [composeWith, setComposeWith] = useState<User | null>(null);
  const [reportMsg, setReportMsg] = useState<{ conv: Conversation; messageId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const convs = conversationsFor(db, currentUser);
  const active = id ? db.conversations.find((c) => c.id === id) : undefined;

  // Deep-link protection: verify membership + permission before rendering a conversation.
  if (id && (!active || !canViewConversation(db, currentUser, id))) {
    return <AccessDenied required="Conversation access" reason="You don't have permission to access this conversation. It may involve people you aren't connected to." />;
  }

  const messages = active ? db.messages.filter((m) => m.conversationId === active.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];

  // Mark incoming messages read when the conversation is opened.
  useEffect(() => {
    if (!active || !currentUser) return;
    const unread = db.messages.some((m) => m.conversationId === active.id && m.senderId !== currentUser.id && !m.readBy.includes(currentUser.id));
    if (unread) {
      update((d) => {
        d.messages.forEach((m) => {
          if (m.conversationId === active.id && m.senderId !== currentUser.id && !m.readBy.includes(currentUser.id)) {
            m.readBy.push(currentUser.id);
            m.status = "read";
          }
        });
      });
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, messages.length]);

  const openDirect = (target: User) => {
    if (!currentUser) return;
    const gate = canSendMessage(db, currentUser, target);
    if (!gate.ok) { toast(gate.reason ?? "Not permitted.", "warn"); return; }
    const existing = findDirectConversation(db, currentUser.id, target.id);
    if (existing) { nav(`/messages/${existing.id}`); return; }
    const cid = uid();
    update((d) => {
      d.conversations.unshift({ id: cid, type: "direct", participants: [currentUser.id, target.id], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "active" });
      pushAudit(d, currentUser, "conversation.open", target.name);
    });
    nav(`/messages/${cid}`);
  };

  const send = () => {
    if (!active || !currentUser || !draft.trim()) return;
    const other = active.participants.find((p) => p !== currentUser.id);
    const target = db.users.find((u) => u.id === other);
    const gate = canSendMessage(db, currentUser, target ?? null);
    if (!gate.ok) { toast(gate.reason ?? "Not permitted.", "warn"); return; }
    update((d) => {
      d.messages.push({ id: uid(), conversationId: active.id, senderId: currentUser.id, body: draft.trim(), createdAt: new Date().toISOString(), readBy: [currentUser.id], status: "sent" });
      const c = d.conversations.find((x) => x.id === active.id);
      if (c) c.updatedAt = new Date().toISOString();
      if (other) pushNotifications(d, [other], "message", `${currentUser.name} sent you a message`, draft.trim().slice(0, 90));
    });
    setDraft("");
  };

  const other = active ? db.users.find((u) => u.id === active.participants.find((p) => p !== currentUser?.id)) : undefined;
  const relatedStudent = active?.relatedStudentId ? db.students.find((s) => s.id === active.relatedStudentId) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Communication" title="Messages" sub={`Direct conversations, limited to people you're actually connected to. ${totalUnreadMessages(db, currentUser)} unread.`}>
        <Btn variant="gold" onClick={() => setComposeWith(currentUser ?? null)}><Send className="h-4 w-4" /> New message</Btn>
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* conversation list */}
        <Panel className="anim-rise h-fit overflow-hidden">
          <div className="border-b border-mist bg-paper/60 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-soft">Inbox</div>
          <ul className="max-h-[560px] divide-y divide-mist/70 overflow-y-auto">
            {convs.map((c) => {
              const peer = db.users.find((u) => u.id === c.participants.find((p) => p !== currentUser?.id));
              const last = [...db.messages.filter((m) => m.conversationId === c.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              const un = unreadInConversation(db, currentUser, c);
              return (
                <li key={c.id}>
                  <button onClick={() => nav(`/messages/${c.id}`)} className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-pine-50/60 ${active?.id === c.id ? "bg-pine-50" : ""}`}>
                    <UserAvatar name={peer?.name ?? "?"} role={peer?.role ?? "admin"} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between">
                        <span className={`truncate text-[13px] ${un ? "font-bold text-ink" : "font-semibold text-ink"}`}>{peer?.name ?? "—"}</span>
                        {last && <span className="ml-2 shrink-0 text-[10.5px] text-soft">{timeAgo(last.createdAt)}</span>}
                      </span>
                      <span className={`block truncate text-[11.5px] ${un ? "font-semibold text-pine-800" : "text-soft"}`}>{last ? last.body : "No messages yet"}</span>
                    </span>
                    {un > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-pine-700 px-1.5 font-mono text-[10px] font-bold text-white">{un}</span>}
                  </button>
                </li>
              );
            })}
            {convs.length === 0 && <li className="px-4 py-10 text-center text-[12.5px] text-soft">No conversations yet.</li>}
          </ul>
        </Panel>

        {/* thread */}
        <Panel className="anim-rise flex min-h-[480px] flex-col overflow-hidden">
          {!active ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title="Select a conversation" body="Pick a conversation from the inbox, or start a new one with someone you're connected to." />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-mist px-4 py-3">
                <button onClick={() => nav("/messages")} className="cursor-pointer rounded p-1 text-soft hover:bg-paper lg:hidden"><ArrowLeft className="h-4 w-4" /></button>
                <UserAvatar name={other?.name ?? "?"} role={other?.role ?? "admin"} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[14.5px] font-bold text-ink">{other?.name}</p>
                  <p className="text-[11px] text-soft">
                    {other && contactContext(db, currentUser, other)}
                    {relatedStudent && ` · about ${relatedStudent.firstName} ${relatedStudent.lastName}`}
                  </p>
                </div>
                {other && <RoleBadge role={other.role} full />}
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-paper/50 px-4 py-4">
                {messages.map((m) => {
                  const mine = m.senderId === currentUser?.id;
                  const sender = db.users.find((u) => u.id === m.senderId);
                  return (
                    <div key={m.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-xl border px-3.5 py-2.5 shadow-sm ${mine ? "rounded-br-sm border-pine-800 bg-pine-800 text-pine-50" : "rounded-bl-sm border-mist bg-card text-ink"}`}>
                        {!mine && <p className="mb-0.5 text-[10.5px] font-bold text-pine-700">{sender?.name}</p>}
                        <p className="whitespace-pre-line text-[13px] leading-relaxed">{m.body}</p>
                        <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-pine-300" : "text-soft"}`}>
                          {timeAgo(m.createdAt)}
                          {mine && <span className="opacity-80">{m.status === "read" ? "· read" : "· sent"}</span>}
                        </p>
                      </div>
                      {!mine && (
                        <button onClick={() => setReportMsg({ conv: active, messageId: m.id })} title="Report message" className="ml-1.5 self-center rounded p-1 text-soft opacity-0 transition-opacity hover:bg-rust-100 hover:text-rust-600 group-hover:opacity-100">
                          <Flag className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {messages.length === 0 && <p className="pt-16 text-center text-[12.5px] text-soft">Say hello — messages stay private to this conversation.</p>}
              </div>

              <div className="border-t border-mist bg-card px-4 py-3">
                {canSendMessage(db, currentUser, other ?? null).ok ? (
                  <div className="flex items-end gap-2">
                    <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message…" className="!min-h-[44px] flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <Btn onClick={send} disabled={!draft.trim()}><Send className="h-4 w-4" /></Btn>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[12.5px] text-soft"><Lock className="h-4 w-4 text-rust-500" /> {canSendMessage(db, currentUser, other ?? null).reason ?? "You can't message this person."}</p>
                )}
              </div>
            </>
          )}
        </Panel>
      </div>

      {composeWith && <ContactPicker onClose={() => setComposeWith(null)} onPick={(u) => { setComposeWith(null); openDirect(u); }} />}
      {reportMsg && <ReportModal onClose={() => setReportMsg(null)} conv={reportMsg.conv} messageId={reportMsg.messageId} />}
    </div>
  );
}

function ContactPicker({ onClose, onPick }: { onClose: () => void; onPick: (u: User) => void }) {
  const { db, currentUser } = useApp();
  const [q, setQ] = useState("");
  const groups = useMemo(() => contactGroups(db, currentUser), [db, currentUser]);
  return (
    <Modal title="Start a conversation" kicker="Only people you're connected to" onClose={onClose}>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search authorized contacts…" className="!pl-9" />
      </div>
      <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => {
          const users = g.users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
          if (!users.length) return null;
          return (
            <div key={g.label}>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-soft">{g.label}</p>
              <ul className="space-y-1">
                {users.map((u) => (
                  <li key={u.id}>
                    <button onClick={() => onPick(u)} className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-mist bg-card px-3 py-2 text-left transition-all hover:border-pine-400 hover:bg-pine-50">
                      <UserAvatar name={u.name} role={u.role} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-ink">{u.name}</span>
                        <span className="block truncate text-[11px] text-soft">{contactContext(db, currentUser, u)}</span>
                      </span>
                      <RoleBadge role={u.role} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {groups.every((g) => !g.users.some((u) => u.name.toLowerCase().includes(q.toLowerCase()))) && (
          <p className="py-8 text-center text-[12.5px] text-soft">No matching authorized users found.</p>
        )}
      </div>
    </Modal>
  );
}

function ReportModal({ onClose, conv, messageId }: { onClose: () => void; conv: Conversation; messageId: string }) {
  const { currentUser, update, toast } = useApp();
  const [reason, setReason] = useState("Inappropriate content");
  const [detail, setDetail] = useState("");
  return (
    <Modal title="Report message" kicker="Goes to authorized moderators" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" onClick={() => {
        update((d) => { d.reports.unshift({ id: uid(), messageId, conversationId: conv.id, reporterId: currentUser?.id ?? "", reason, detail: detail.trim() || undefined, at: new Date().toISOString(), status: "open" }); pushAudit(d, currentUser, "message.report", reason); });
        toast("Report submitted to moderators.");
        onClose();
      }}><Flag className="h-4 w-4" /> Submit report</Btn></>}>
      <Field label="Reason" required>
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          {["Inappropriate content", "Harassment", "Spam", "Other"].map((r) => <option key={r}>{r}</option>)}
        </Select>
      </Field>
      <div className="mt-3">
        <Field label="Details"><TextArea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional context…" /></Field>
      </div>
    </Modal>
  );
}

/* ================= Notifications ================= */
export function NotificationsPage() {
  const { db, currentUser, update } = useApp();
  const list = userNotifications(db, currentUser);
  const ICON: Record<string, typeof Bell> = { announcement: Megaphone, message: Inbox, homework: Send, result: ShieldAlert, attendance: CalendarDays, event: CalendarDays, system: Bell };
  const markAll = () => update((d) => { d.notifications.forEach((n) => { if (n.userId === currentUser?.id) n.read = true; }); });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Communication" title="Notifications" sub={`${unreadNotifications(db, currentUser)} unread — system-generated updates about homework, results, attendance and announcements.`}>
        <Btn variant="soft" onClick={markAll}>Mark all read</Btn>
      </PageHead>
      <Panel className="anim-rise overflow-hidden">
        <ul className="divide-y divide-mist/70">
          {list.map((n) => {
            const I = ICON[n.type] ?? Bell;
            return (
              <li key={n.id} className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${n.read ? "" : "bg-pine-50/60"}`}>
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.read ? "bg-paper text-soft" : "bg-pine-800 text-pine-50"}`}><I className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] ${n.read ? "font-semibold text-soft" : "font-bold text-ink"}`}>{n.title}</span>
                    <span className="shrink-0 text-[10.5px] text-soft">{timeAgo(n.at)}</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-soft">{n.body}</span>
                </span>
                {!n.read && (
                  <button onClick={() => update((d) => { const x = d.notifications.find((y) => y.id === n.id); if (x) x.read = true; })} className="mt-1 shrink-0 cursor-pointer text-[11px] font-bold text-pine-700 hover:underline">Mark read</button>
                )}
              </li>
            );
          })}
          {list.length === 0 && <li><EmptyState icon={<Bell className="h-5 w-5" />} title="All caught up" body="You have no notifications right now." /></li>}
        </ul>
      </Panel>
    </div>
  );
}

/* ================= Events ================= */
export function EventsPage() {
  const { db, currentUser, update, toast } = useApp();
  const [open, setOpen] = useState(false);
  const canManage = hasPermission(db, currentUser, "events.manage");
  const visible = db.events
    .filter((e) => audienceSize(db, e.audience) >= 0 && (canManage || e.audience.kind === "everyone" || true))
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Communication" title="School calendar" sub="Upcoming events and key dates.">
        {canManage && <Btn variant="gold" onClick={() => setOpen(true)}><CalendarDays className="h-4 w-4" /> Add event</Btn>}
      </PageHead>
      <Panel className="anim-rise overflow-hidden">
        <ul className="divide-y divide-mist/70">
          {visible.map((e) => {
            const cm = CAT_META[e.category] ?? CAT_META.General;
            const d = new Date(e.date + "T00:00:00");
            return (
              <li key={e.id} className="flex items-center gap-4 px-4 py-3.5">
                <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-mist bg-paper">
                  <span className="font-display text-[16px] font-extrabold leading-none text-ink">{d.getDate()}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-soft">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-bold text-ink">{e.title}</span>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cm.bg}`}>{e.category}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-soft">{e.time ? `${e.time} · ` : ""}{e.location ? `${e.location} · ` : ""}{audienceLabel(db, e.audience)}</span>
                </span>
              </li>
            );
          })}
          {visible.length === 0 && <li><EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No events scheduled" body="The calendar is clear." /></li>}
        </ul>
      </Panel>
      {open && <EventModal onClose={() => setOpen(false)} onSave={(ev) => { update((d) => { d.events.push(ev); pushAudit(d, currentUser, "event.create", ev.title); }); toast("Event added."); setOpen(false); }} />}
    </div>
  );
}

function EventModal({ onClose, onSave }: { onClose: () => void; onSave: (e: import("../types").SchoolEvent) => void }) {
  const { db, currentUser, toast } = useApp();
  const [f, setF] = useState({ title: "", date: "", time: "", location: "", category: "Event", description: "" });
  const [audience, setAudience] = useState<Audience>({ kind: "everyone" });
  return (
    <Modal title="Add event" kicker="School calendar" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={() => {
        if (!f.title.trim() || !f.date) { toast("Title and date are required.", "warn"); return; }
        onSave({ id: uid(), title: f.title.trim(), date: f.date, time: f.time || undefined, location: f.location || undefined, category: f.category as import("../types").NoticeCategory, audience, createdBy: currentUser?.id ?? "", description: f.description || undefined });
      }}>Save event</Btn></>}>
      <div className="grid gap-4">
        <Field label="Title" required><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Time"><TextInput type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          <Field label="Location"><TextInput value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["Event", "Exams", "Academic", "General", "Urgent"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <Field label="Description"><TextArea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <AudiencePicker value={audience} onChange={setAudience} />
      </div>
    </Modal>
  );
}

/* ================= Contacts ================= */
export function ContactsPage() {
  const { db, currentUser } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const groups = contactGroups(db, currentUser);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Communication" title="Contacts" sub="A role-aware directory — only people you're authorized to reach are listed, so nobody's existence is leaked." />
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" className="!pl-9" />
      </div>
      <div className="space-y-5">
        {groups.map((g) => {
          const users = g.users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
          if (!users.length) return null;
          return (
            <div key={g.label}>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-soft">{g.label} · {users.length}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((u) => (
                  <button key={u.id} onClick={() => nav("/messages")} className="anim-rise flex cursor-pointer items-center gap-3 rounded-xl border border-mist bg-card px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-pine-400 hover:shadow-md">
                    <UserAvatar name={u.name} role={u.role} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">{u.name}</span>
                      <span className="block truncate text-[11px] text-soft">{contactContext(db, currentUser, u)}</span>
                    </span>
                    <RoleBadge role={u.role} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {groups.every((g) => !g.users.some((u) => u.name.toLowerCase().includes(q.toLowerCase()))) && (
          <Panel><EmptyState icon={<Users className="h-5 w-5" />} title="No matching authorized users found" body="Contacts are limited to people connected to you through the school." /></Panel>
        )}
      </div>
    </div>
  );
}

/* ================= Moderation (for communication.moderate) ================= */
export function ModerationPage() {
  const { db, currentUser, update, toast } = useApp();
  if (!hasPermission(db, currentUser, "communication.moderate")) {
    return <AccessDenied required="communication.moderate" reason="Only authorized moderators can review reported communication." />;
  }
  const reports = db.reports;
  const resolve = (id: string, status: "resolved" | "dismissed") => {
    update((d) => { const r = d.reports.find((x) => x.id === id); if (r) r.status = status; pushAudit(d, currentUser, `report.${status}`, id); });
    toast(status === "resolved" ? "Report resolved." : "Report dismissed.");
  };
  const hideConversation = (convId: string) => {
    update((d) => { const c = d.conversations.find((x) => x.id === convId); if (c) c.status = "hidden"; pushAudit(d, currentUser, "conversation.hide", convId); });
    toast("Conversation hidden from participants.");
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Communication" title="Moderation" sub="Review reported messages. Actions are written to the audit log." />
      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60">
            <tr><th className={thCls()}>Message</th><th className={thCls()}>Reason</th><th className={thCls()}>Reported by</th><th className={thCls()}>Status</th><th className={thCls()}></th></tr>
          </thead>
          <tbody className="divide-y divide-mist/70">
            {reports.map((r) => {
              const msg = db.messages.find((m) => m.id === r.messageId);
              const reporter = db.users.find((u) => u.id === r.reporterId);
              return (
                <tr key={r.id}>
                  <td className={`${tdCls()} max-w-[220px] truncate text-soft`}>{msg?.body ?? "(removed)"}</td>
                  <td className={tdCls()}><Chip tone={r.status === "open" ? "rust" : "gray"}>{r.reason}</Chip></td>
                  <td className={`${tdCls()} text-soft`}>{reporter?.name ?? "—"}<span className="block text-[10.5px]">{timeAgo(r.at)}</span></td>
                  <td className={tdCls()}><Chip tone={r.status === "open" ? "gold" : r.status === "resolved" ? "pine" : "gray"}>{r.status}</Chip></td>
                  <td className={`${tdCls()} whitespace-nowrap text-right`}>
                    {r.status === "open" && (
                      <span className="flex justify-end gap-1.5">
                        <Btn size="sm" variant="soft" onClick={() => resolve(r.id, "resolved")}>Resolve</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => resolve(r.id, "dismissed")}>Dismiss</Btn>
                        <Btn size="sm" variant="dangerSoft" onClick={() => hideConversation(r.conversationId)}>Hide</Btn>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {reports.length === 0 && <tr><td colSpan={5}><EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Nothing to review" body="No messages have been reported." /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
