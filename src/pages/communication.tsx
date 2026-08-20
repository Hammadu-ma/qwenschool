import { useState } from "react";
import {
  Baby, Check, GraduationCap, Inbox, Megaphone, Pin, PinOff, Plus, Search, Send, Trash2, Users, ShieldCheck, BookOpen,
} from "lucide-react";
import type { Audience, Notice, NoticeCategory } from "../types";
import {
  audienceContainsUser, audienceLabel, audienceSize, getClass, getSection, timeAgo, uid, useApp, visibleNotices,
  visibleThreads,
} from "../store";
import { Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, RoleBadge, Select, Tabs, TextArea, TextInput, UserAvatar, tdCls } from "../ui";

const CATS: NoticeCategory[] = ["Urgent", "Academic", "Exams", "Event", "General"];
const CAT_STYLE: Record<NoticeCategory, { bg: string; edge: string; dot: string }> = {
  Urgent: { bg: "bg-[#fff6f1]", edge: "border-rust-500", dot: "bg-rust-500" },
  Academic: { bg: "bg-[#f2f8f2]", edge: "border-pine-600", dot: "bg-pine-600" },
  Exams: { bg: "bg-[#f0f5fa]", edge: "border-steel-500", dot: "bg-steel-500" },
  Event: { bg: "bg-[#fdf6e6]", edge: "border-gold-500", dot: "bg-gold-500" },
  General: { bg: "bg-card", edge: "border-mist", dot: "bg-soft" },
};

/** Which audiences may this user address? Teachers stay within their assigned sections. */
function audiencesFor(role: string, db: ReturnType<typeof useApp>["db"], user: ReturnType<typeof useApp>["currentUser"]): Audience[] {
  const list: Audience[] = [{ kind: "everyone" }];
  if (role === "admin") {
    list.push({ kind: "teachers" }, { kind: "students" }, { kind: "guardians" });
    db.classes.forEach((c) => c.sections.forEach((s) => {
      list.push({ kind: "section-students", classId: c.id, sectionId: s.id });
      list.push({ kind: "section-guardians", classId: c.id, sectionId: s.id });
    }));
    return list;
  }
  if (role === "teacher") {
    list.push({ kind: "teachers" });
    const pairs = db.assignments
      .filter((a) => a.teacherId === user?.teacherId)
      .map((a) => ({ classId: a.classId, sectionId: a.sectionId }));
    const uniq = new Map<string, { classId: string; sectionId: string }>();
    pairs.forEach((p) => uniq.set(`${p.classId}|${p.sectionId}`, p));
    [...uniq.values()].forEach((p) => {
      list.push({ kind: "section-students", classId: p.classId, sectionId: p.sectionId });
      list.push({ kind: "section-guardians", classId: p.classId, sectionId: p.sectionId });
    });
    return list;
  }
  // students & guardians may address teachers — never the whole school
  return [{ kind: "teachers" }];
}

function AudienceSelect({ value, onChange, options }: { value: Audience; onChange: (a: Audience) => void; options: Audience[] }) {
  const { db } = useApp();
  const idx = options.findIndex((o) => JSON.stringify(o) === JSON.stringify(value));
  return (
    <div>
      <Select value={String(Math.max(0, idx))} onChange={(e) => onChange(options[Number(e.target.value)])}>
        {options.map((o, i) => (
          <option key={i} value={i}>{audienceLabel(db, o)} · {audienceSize(db, o)} recipients</option>
        ))}
      </Select>
      <p className="mt-1.5 text-[11px] text-soft">Recipients are resolved from enrollment and guardian links — never typed.</p>
    </div>
  );
}

/* ================= notice board ================= */
export function NoticesPage() {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const [cat, setCat] = useState<NoticeCategory | "All">("All");
  const [q, setQ] = useState("");
  const [postOpen, setPostOpen] = useState(false);

  const my = visibleNotices(db, currentUser)
    .filter((n) => cat === "All" || n.category === cat)
    .filter((n) => !q || n.title.toLowerCase().includes(q.toLowerCase()) || n.body.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at));

  const canManage = (n: Notice) => role === "admin" || n.author === currentUser?.name;

  const togglePin = (n: Notice) => {
    update((d) => { d.notices.find((x) => x.id === n.id)!.pinned = !n.pinned; });
    toast(n.pinned ? "Notice unpinned." : "Notice pinned to the top.");
  };
  const remove = (n: Notice) => {
    update((d) => { d.notices = d.notices.filter((x) => x.id !== n.id); });
    toast("Notice removed from the board.");
  };

  const rotations = ["-rotate-1", "rotate-1", "-rotate-[0.6deg]", "rotate-[0.8deg]"];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Communication" title="Notice board" sub={`You see notices addressed to ${role === "admin" ? "everyone — the whole school" : role === "teacher" ? "teachers and your sections" : role === "student" ? "students and your section" : "guardians and your children's sections"}.`}>
        {role !== "student" && role !== "guardian" && (
          <Btn variant="gold" onClick={() => setPostOpen(true)}><Plus className="h-4 w-4" /> Post notice</Btn>
        )}
      </PageHead>

      <Panel className="anim-rise mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the board…" className="!pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["All", ...CATS] as const).map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-all ${cat === c ? "border-pine-800 bg-pine-800 text-white" : "border-mist bg-card text-soft hover:border-pine-300 hover:text-ink"}`}>
              {c}
              {c !== "All" && <span className="ml-1 opacity-70">{db.notices.filter((n) => n.category === c && audienceContainsUser(db, currentUser, n.audience)).length}</span>}
            </button>
          ))}
        </div>
      </Panel>

      {my.length === 0 ? (
        <Panel><EmptyState icon={<Megaphone className="h-5 w-5" />} title="The board is clear" body="No notices for your audience match right now. New posts appear the moment they're published." /></Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {my.map((n, i) => {
            const st = CAT_STYLE[n.category];
            return (
              <article key={n.id} className={`anim-rise group relative rounded-lg border-l-4 ${st.edge} ${st.bg} p-4 shadow-[0_2px_8px_rgba(13,33,26,0.08)] transition-all duration-200 hover:-translate-y-1 hover:rotate-0 hover:shadow-lg ${rotations[i % rotations.length]}`}>
                {n.pinned && (
                  <span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-gold-400 shadow-md ring-4 ring-gold-200" title="Pinned" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <Chip tone={n.category === "Urgent" ? "rust" : n.category === "Event" ? "gold" : n.category === "Exams" ? "steel" : n.category === "Academic" ? "pine" : "gray"}>
                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {n.category}
                  </Chip>
                  <span className="text-[10.5px] font-semibold text-soft">{timeAgo(n.at)}</span>
                </div>
                <h3 className="font-display mt-2.5 text-[15px] font-extrabold leading-snug tracking-tight text-ink">{n.title}</h3>
                <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-soft">{n.body}</p>
                <div className="mt-3 flex items-center gap-2 border-t border-ink/5 pt-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
                    {n.authorRole === "admin" ? <ShieldCheck className="h-3.5 w-3.5 text-pine-600" /> : <BookOpen className="h-3.5 w-3.5 text-steel-500" />}
                    {n.author}
                  </span>
                  <Chip tone="gray" className="ml-auto">{audienceLabel(db, n.audience)}</Chip>
                  {canManage(n) && (
                    <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => togglePin(n)} title={n.pinned ? "Unpin" : "Pin"} className="cursor-pointer rounded p-1 text-soft hover:bg-gold-100 hover:text-gold-600">
                        {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => remove(n)} title="Remove" className="cursor-pointer rounded p-1 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {postOpen && <PostNoticeModal onClose={() => setPostOpen(false)} />}
    </div>
  );
}

function PostNoticeModal({ onClose }: { onClose: () => void }) {
  const { db, currentUser, update, toast } = useApp();
  const options = audiencesFor(currentUser?.role ?? "admin", db, currentUser);
  const [f, setF] = useState({ title: "", body: "", category: "General" as NoticeCategory, alsoMessage: true });
  const [aud, setAud] = useState<Audience>(options[1] ?? options[0]);

  const publish = () => {
    if (!f.title.trim() || !f.body.trim()) { toast("Title and body are required.", "warn"); return; }
    update((d) => {
      d.notices.unshift({
        id: uid(), title: f.title.trim(), body: f.body.trim(), category: f.category, audience: aud,
        author: currentUser?.name ?? "Front Office", authorRole: currentUser?.role ?? "admin",
        at: new Date().toISOString(), pinned: false,
      });
      if (f.alsoMessage) {
        d.threads.unshift({
          id: uid(), subject: `Notice: ${f.title.trim()}`, to: aud, createdBy: currentUser?.id, read: false,
          messages: [{ id: uid(), fromName: currentUser?.name ?? "Front Office", fromRole: currentUser?.role ?? "admin", body: f.body.trim(), at: new Date().toISOString() }],
        });
      }
    });
    toast(`Notice published to ${audienceLabel(db, aud)}${f.alsoMessage ? " — and sent to their message inbox" : ""}.`);
    onClose();
  };

  return (
    <Modal title="Post a notice" kicker={`Posting as ${currentUser?.name} · ${currentUser?.role}`} onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={publish}><Megaphone className="h-4 w-4" /> Publish</Btn></>}>
      <div className="grid gap-4">
        <Field label="Title" required><TextInput value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Midterm timetable released" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required>
            <Select value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value as NoticeCategory }))}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Audience" required><AudienceSelect value={aud} onChange={setAud} options={options} /></Field>
        </div>
        <Field label="Body" required><TextArea value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} rows={5} placeholder="Write the announcement…" /></Field>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-pine-200 bg-pine-50 px-3.5 py-2.5">
          <input type="checkbox" checked={f.alsoMessage} onChange={(e) => setF((p) => ({ ...p, alsoMessage: e.target.checked }))} className="h-4 w-4 accent-pine-700" />
          <span className="text-[12.5px] font-bold text-pine-900">Also send to the audience's message inbox</span>
        </label>
      </div>
    </Modal>
  );
}

/* ================= messages ================= */
export function MessagesPage() {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [compose, setCompose] = useState(false);

  const inbox = visibleThreads(db, currentUser).sort((a, b) => b.messages[b.messages.length - 1].at.localeCompare(a.messages[a.messages.length - 1].at));
  const sent = db.threads.filter((t) => t.createdBy === currentUser?.id).sort((a, b) => b.messages[b.messages.length - 1].at.localeCompare(a.messages[a.messages.length - 1].at));
  const list = folder === "inbox" ? inbox : sent;
  const open = list.find((t) => t.id === openId) ?? null;
  const unread = inbox.filter((t) => !t.read).length;

  const openThread = (id: string) => {
    setOpenId(id);
    update((d) => { const t = d.threads.find((x) => x.id === id); if (t && !t.read) t.read = true; });
  };

  const sendReply = () => {
    if (!open || !reply.trim() || !currentUser) return;
    update((d) => {
      const t = d.threads.find((x) => x.id === open.id)!;
      t.messages.push({ id: uid(), fromName: currentUser.name, fromRole: currentUser.role, body: reply.trim(), at: new Date().toISOString() });
    });
    setReply("");
    toast("Reply sent.");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Communication" title="Messages" sub={`Threads are addressed to audiences; visibility follows your role and relationships.${role === "student" || role === "guardian" ? " You can reply in any thread you receive." : ""}`}>
        <Btn variant="gold" onClick={() => setCompose(true)}><Plus className="h-4 w-4" /> Compose</Btn>
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="anim-rise overflow-hidden lg:col-span-2">
          <div className="border-b border-mist p-3">
            <Tabs
              tabs={[
                { id: "inbox", label: `Inbox${unread ? ` · ${unread}` : ""}`, icon: <Inbox className="h-3.5 w-3.5" /> },
                { id: "sent", label: "Sent", icon: <Send className="h-3.5 w-3.5" /> },
              ]}
              active={folder}
              onChange={(t) => { setFolder(t as "inbox" | "sent"); setOpenId(null); }}
            />
          </div>
          <ul className="max-h-[560px] divide-y divide-mist/70 overflow-y-auto">
            {list.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <li key={t.id}>
                  <button onClick={() => openThread(t.id)}
                    className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors ${openId === t.id ? "bg-pine-50" : "hover:bg-pine-50/50"}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${folder === "inbox" && !t.read ? "live-dot bg-gold-500" : "bg-mist"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] ${folder === "inbox" && !t.read ? "font-extrabold text-ink" : "font-semibold text-ink"}`}>{t.subject}</span>
                      <span className="block truncate text-[11.5px] text-soft">{last.fromName}: {last.body}</span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <Chip tone="gray" className="!text-[10px]">{audienceLabel(db, t.to)}</Chip>
                        <span className="text-[10px] text-soft">{timeAgo(last.at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-5 py-12 text-center text-[12.5px] text-soft">{folder === "inbox" ? "No messages for you right now." : "You haven't sent any messages yet."}</li>}
          </ul>
        </Panel>

        <Panel className="anim-rise flex min-h-[420px] flex-col overflow-hidden lg:col-span-3">
          {!open ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title="Select a thread" body="Pick a conversation on the left — opening it marks it as read." />
          ) : (
            <>
              <div className="border-b border-mist px-5 py-3.5">
                <h2 className="font-display text-[15px] font-bold tracking-tight">{open.subject}</h2>
                <p className="mt-0.5 text-[11.5px] text-soft">To: {audienceLabel(db, open.to)} · {open.messages.length} message{open.messages.length === 1 ? "" : "s"}</p>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto bg-paper/50 p-4">
                {open.messages.map((m) => {
                  const mine = m.fromName === currentUser?.name;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 shadow-sm ${mine ? "rounded-br-sm border-pine-700 bg-pine-800 text-pine-50" : "rounded-bl-sm border-mist bg-card"}`}>
                        <div className={`flex items-center gap-2 ${mine ? "justify-end" : ""}`}>
                          <span className={`text-[11px] font-bold ${mine ? "text-gold-300" : "text-pine-800"}`}>{m.fromName}</span>
                          <RoleBadge role={m.fromRole} />
                          <span className={`text-[10px] ${mine ? "text-pine-300" : "text-soft"}`}>{timeAgo(m.at)}</span>
                        </div>
                        <p className={`mt-1 whitespace-pre-line text-[13px] leading-relaxed ${mine ? "text-pine-50" : "text-ink"}`}>{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-end gap-2 border-t border-mist bg-card p-3.5">
                <TextArea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply as ${currentUser?.name} (${role})…`} className="!min-h-[44px] flex-1" rows={2}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }} />
                <Btn onClick={sendReply} disabled={!reply.trim()}><Send className="h-4 w-4" /> Send</Btn>
              </div>
            </>
          )}
        </Panel>
      </div>

      {compose && <ComposeModal onClose={() => setCompose(false)} onSent={(id) => { setCompose(false); setFolder("sent"); setOpenId(id); }} />}
    </div>
  );
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: (id: string) => void }) {
  const { db, currentUser, update, toast } = useApp();
  const options = audiencesFor(currentUser?.role ?? "admin", db, currentUser);
  const [aud, setAud] = useState<Audience>(options[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const send = () => {
    if (!subject.trim() || !body.trim()) { toast("Subject and message are required.", "warn"); return; }
    const id = uid();
    update((d) => {
      d.threads.unshift({
        id, subject: subject.trim(), to: aud, createdBy: currentUser?.id, read: true,
        messages: [{ id: uid(), fromName: currentUser?.name ?? "", fromRole: currentUser?.role ?? "admin", body: body.trim(), at: new Date().toISOString() }],
      });
    });
    toast(`Sent to ${audienceLabel(db, aud)} · ${audienceSize(db, aud)} recipients.`);
    onSent(id);
  };

  return (
    <Modal title="New message" kicker={`From ${currentUser?.name} · ${currentUser?.role}`} onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={send}><Send className="h-4 w-4" /> Send message</Btn></>}>
      <div className="grid gap-4">
        <Field label="To" required><AudienceSelect value={aud} onChange={setAud} options={options} /></Field>
        <Field label="Subject" required><TextInput value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Revision session on Thursday" /></Field>
        <Field label="Message" required><TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={5} /></Field>
      </div>
    </Modal>
  );
}
