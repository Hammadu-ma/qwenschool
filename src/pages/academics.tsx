import { useMemo, useState } from "react";
import {
  AlertTriangle, CalendarCheck2, Check, ClipboardList,
  FileBarChart2, Layers, Pencil, Plus, Send, Table2, Trash2,
} from "lucide-react";
import type { AssessmentItem, AssessmentStructure, AttendanceStatus, Student } from "../types";
import { DAYS, PERIODS } from "../data/seed";
import {
  assessmentCalc, attendanceStats, childrenOf, feeStats, fmt1, fmtDate, getClass, getSection, getSubject,
  gradeFor, ordinal, sectionLabel, sectionShort, shortName, studentAverage, studentOf, studentResults,
  structureRanks, structureWeightSum, teacherFor, teacherPairs, teacherStudentIds, teachersOfStudent, todayISO,
  uid, useApp,
} from "../store";
import {
  Avatar, Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, Ring, Select, Tabs, TextInput, tdCls, thCls,
} from "../ui";

const PERIOD_OPTIONS = ["Semester 1", "Semester 2", "Annual"];
const ATT_META: Record<AttendanceStatus, { label: string; on: string }> = {
  present: { label: "P", on: "border-pine-600 bg-pine-600 text-white" },
  late: { label: "L", on: "border-gold-500 bg-gold-400 text-pine-950" },
  absent: { label: "A", on: "border-rust-600 bg-rust-600 text-white" },
};

/* ================= classes (admin full / scoped read) ================= */
export function ClassesPage({ scoped }: { scoped?: boolean }) {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const isAdmin = role === "admin";
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLevel, setNewLevel] = useState("9");
  const [secFor, setSecFor] = useState<string | null>(null);
  const [secName, setSecName] = useState("");

  const me = studentOf(db, currentUser);
  const pairs = teacherPairs(db, currentUser);
  const child = childrenOf(db, currentUser)[0];

  const visible = db.classes.filter((c) => {
    if (isAdmin) return true;
    if (role === "teacher") return pairs.some((p) => p.classId === c.id);
    const enr = role === "student" ? me?.enrollment : child?.enrollment;
    return enr?.classId === c.id;
  });

  const addClass = () => {
    if (!newName.trim()) { toast("Give the class a name.", "warn"); return; }
    update((d) => {
      d.classes.push({ id: uid(), name: newName.trim(), level: Number(newLevel) || 0, sections: [{ id: uid(), name: "A" }] });
      d.classes.sort((a, b) => a.level - b.level);
    });
    toast(`${newName.trim()} created with Section A.`);
    setAddOpen(false); setNewName("");
  };

  const addSection = (classId: string) => {
    const name = secName.trim().toUpperCase();
    const cls = getClass(db, classId);
    if (!name) { toast("Enter a section letter.", "warn"); return; }
    if (cls?.sections.some((s) => s.name.toUpperCase() === name)) { toast(`Section ${name} already exists.`, "warn"); return; }
    update((d) => { d.classes.find((c) => c.id === classId)!.sections.push({ id: uid(), name }); });
    toast(`Section ${name} added to ${cls?.name}.`);
    setSecFor(null); setSecName("");
  };

  const removeSection = (classId: string, sectionId: string) => {
    const enrolled = db.students.filter((s) => s.enrollment?.classId === classId && s.enrollment?.sectionId === sectionId).length;
    if (enrolled > 0) { toast(`Cannot remove — ${enrolled} student(s) are placed in this section.`, "warn"); return; }
    update((d) => {
      const cls = d.classes.find((c) => c.id === classId)!;
      cls.sections = cls.sections.filter((s) => s.id !== sectionId);
      d.assignments = d.assignments.filter((a) => !(a.classId === classId && a.sectionId === sectionId));
      d.timetable = d.timetable.filter((t) => !(t.classId === classId && t.sectionId === sectionId));
    });
    toast("Section removed.");
  };

  const head = scoped
    ? role === "teacher"
      ? { kicker: "Teaching", title: "My classes", sub: "Only the classes and sections you are assigned to. Changes to your assignments update this page immediately." }
      : { kicker: role === "student" ? "Learning" : "Family", title: "My classes", sub: "Subjects, teachers and timetable for your class this year." }
    : { kicker: "Academics", title: "Classes & sections", sub: "A class is a grade level; sections live inside it. Students are placed into Grade → Section." };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead {...head}>
        {isAdmin && <Btn variant="gold" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New class</Btn>}
      </PageHead>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((c, i) => {
          const secs = c.sections.filter((sec) => isAdmin || role !== "teacher" || pairs.some((p) => p.classId === c.id && p.sectionId === sec.id));
          return (
            <Panel key={c.id} className="anim-rise overflow-hidden">
              <div className="relative bg-pine-900 px-5 py-4" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full border-[12px] border-pine-800/70" />
                <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-gold-300">Level {c.level}</p>
                <h2 className="font-display text-[22px] font-extrabold tracking-tight text-white">{c.name}</h2>
              </div>
              <div className="space-y-2.5 p-4">
                {secs.map((sec) => {
                  const n = db.students.filter((s) => s.enrollment?.classId === c.id && s.enrollment?.sectionId === sec.id).length;
                  const subjectsHere = db.assignments.filter((a) => a.yearId === yearId && a.classId === c.id && a.sectionId === sec.id);
                  const mine = role === "teacher" ? pairs.some((p) => p.classId === c.id && p.sectionId === sec.id) : true;
                  return (
                    <div key={sec.id} className="group rounded-lg border border-mist bg-paper/60 px-3 py-2 transition-colors hover:border-pine-300">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Chip tone="pine">Section {sec.name}</Chip>
                          <span className="text-[12px] font-semibold text-soft">{n} students</span>
                          {role === "teacher" && mine && <Chip tone="gold">You teach</Chip>}
                        </span>
                        {isAdmin && (
                          <button onClick={() => removeSection(c.id, sec.id)} className="cursor-pointer rounded p-1.5 text-soft opacity-0 transition-all hover:bg-rust-100 hover:text-rust-600 group-hover:opacity-100">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {!isAdmin && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {subjectsHere.map((a) => (
                            <span key={a.id} className="flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-[10px] font-semibold text-soft ring-1 ring-mist">
                              <span className="h-2 w-2 rounded-sm" style={{ background: getSubject(db, a.subjectId)?.color }} />
                              {getSubject(db, a.subjectId)?.code} · {db.teachers.find((t) => t.id === a.teacherId)?.name.replace(/^(Mr\.|Ms\.|Mrs\.)\s*/, "")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {isAdmin && (
                  secFor === c.id ? (
                    <div className="flex items-center gap-2">
                      <TextInput value={secName} onChange={(e) => setSecName(e.target.value)} placeholder="e.g. D" className="!w-20 !py-1.5 text-center font-bold" autoFocus />
                      <Btn size="sm" onClick={() => addSection(c.id)}>Add</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setSecFor(null)}>Cancel</Btn>
                    </div>
                  ) : (
                    <button onClick={() => { setSecFor(c.id); setSecName(""); }} className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-mist py-2 text-[12px] font-bold text-soft transition-colors hover:border-pine-400 hover:bg-pine-50 hover:text-pine-700">
                      <Plus className="h-3.5 w-3.5" /> Add section
                    </button>
                  )
                )}
              </div>
            </Panel>
          );
        })}
        {visible.length === 0 && <Panel className="md:col-span-2 xl:col-span-3"><EmptyState icon={<Layers className="h-5 w-5" />} title="No classes in your scope" body="Nothing has been assigned to you yet — the front office controls class assignments." /></Panel>}
      </div>

      {addOpen && (
        <Modal title="New class" kicker="Classes" onClose={() => setAddOpen(false)}
          footer={<><Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn><Btn onClick={addClass}>Create class</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Class name" required><TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Grade 9" /></Field>
            <Field label="Level" required><TextInput type="number" min={1} max={12} value={newLevel} onChange={(e) => setNewLevel(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= timetable (admin) ================= */
export function TimetablePage() {
  const { db, ui, update, toast, yearId } = useApp();
  const [classId, setClassId] = useState("c8");
  const [sectionId, setSectionId] = useState("sec8b");
  const [day, setDay] = useState(Math.min(4, (new Date().getDay() + 6) % 7));
  const [editing, setEditing] = useState<number | null>(null);
  const [eSubject, setESubject] = useState("math");
  const [eRoom, setERoom] = useState("R-201");

  const cls = getClass(db, classId);
  const pickClass = (id: string) => {
    setClassId(id);
    const first = db.classes.find((c) => c.id === id)?.sections[0];
    if (first) setSectionId(first.id);
  };
  const entryFor = (period: number) => db.timetable.find((t) => t.classId === classId && t.sectionId === sectionId && t.day === day && t.period === period);
  const teacher = editing != null ? teacherFor(db, yearId, classId, sectionId, eSubject) : null;

  const saveEntry = () => {
    if (editing == null) return;
    update((d) => {
      d.timetable = d.timetable.filter((t) => !(t.classId === classId && t.sectionId === sectionId && t.day === day && t.period === editing));
      d.timetable.push({ id: uid(), classId, sectionId, day, period: editing, subjectId: eSubject, room: eRoom.trim() || "TBA" });
    });
    toast(`${DAYS[day]} period ${editing} scheduled — teacher pulled from the central assignment.`);
    setEditing(null);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Academics" title="Timetable" sub="Day, period, subject and room — the teacher resolves from the teacher–subject assignment, never typed twice.">
        <Select value={classId} onChange={(e) => pickClass(e.target.value)} className="!w-36">
          {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="!w-32">
          {cls?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
        </Select>
      </PageHead>

      <div className="anim-rise mb-4 flex gap-1.5">
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => setDay(i)}
            className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-[13px] font-bold transition-all duration-150 ${day === i ? "border-pine-800 bg-pine-800 text-white shadow-sm" : "border-mist bg-card text-soft hover:border-pine-300 hover:text-ink"}`}>
            <span className="hidden sm:inline">{d}</span><span className="sm:hidden">{d.slice(0, 3)}</span>
          </button>
        ))}
      </div>

      <Panel className="anim-rise overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mist px-5 py-3.5">
          <h2 className="font-display text-[15px] font-bold">{DAYS[day]} · {sectionLabel(db, classId, sectionId)}</h2>
        </div>
        <ul className="divide-y divide-mist/70">
          {PERIODS.map((p) => {
            const e = entryFor(p.period);
            const subj = e ? getSubject(db, e.subjectId) : null;
            const t = e ? teacherFor(db, yearId, classId, sectionId, e.subjectId) : null;
            return (
              <li key={p.period} className="group flex min-h-[64px] items-center gap-4 px-5 py-3 transition-colors hover:bg-pine-50/40">
                <div className="w-16 shrink-0">
                  <p className="tnum font-mono text-[13px] font-bold text-ink">{p.time}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-soft">Period {p.period}</p>
                </div>
                <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: subj?.color ?? "var(--color-mist)" }} />
                {e ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-ink">{subj?.name}</p>
                      <p className="text-[11.5px] text-soft">{t ? t.name : <span className="font-semibold text-rust-600">No teacher assigned</span>} · Room {e.room}</p>
                    </div>
                    <div className="flex gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                      <Btn size="sm" variant="soft" onClick={() => { setEditing(p.period); setESubject(e.subjectId); setERoom(e.room); }}>Edit</Btn>
                      <button onClick={() => { update((d) => { d.timetable = d.timetable.filter((t2) => t2.id !== e.id); }); toast("Slot cleared."); }} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="flex-1 text-[12.5px] italic text-soft/70">Free period</p>
                    <Btn size="sm" variant="outline" onClick={() => { setEditing(p.period); setESubject("math"); setERoom("R-201"); }}><Plus className="h-3.5 w-3.5" /> Schedule</Btn>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {editing != null && (
        <Modal title={`${DAYS[day]} · Period ${editing}`} kicker="Schedule a lesson" onClose={() => setEditing(null)}
          footer={<><Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn><Btn onClick={saveEntry}>Save lesson</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subject" required>
              <Select value={eSubject} onChange={(e) => setESubject(e.target.value)}>
                {db.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Room"><TextInput value={eRoom} onChange={(e) => setERoom(e.target.value)} placeholder="R-204" /></Field>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border border-pine-200 bg-pine-50 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pine-700">Teacher · resolved automatically</span>
            <span className="text-[13px] font-bold text-pine-900">{teacher?.name ?? <span className="text-rust-600">Unassigned</span>}</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= mark entry (admin full / teacher scoped) ================= */
export function MarkEntryPage() {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const isAdmin = role === "admin";
  const pairs = teacherPairs(db, currentUser);

  const allowedStructures = db.structures.filter((st) => {
    if (st.yearId !== yearId) return false;
    if (isAdmin) return true;
    return pairs.some((p) => p.classId === st.classId && p.subjectIds.includes(st.subjectId));
  });

  const [sel, setSel] = useState<{ id: string | null }>({ id: null });
  const [editStruct, setEditStruct] = useState<AssessmentStructure | "new" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const structure = allowedStructures.find((s) => s.id === sel.id) ?? allowedStructures[0] ?? null;

  // teacher's allowed students for the chosen structure
  const roster: Student[] = useMemo(() => {
    if (!structure) return [];
    const all = db.students.filter((s) => s.enrollment?.classId === structure.classId);
    if (isAdmin) return all;
    const allowed = teacherStudentIds(db, currentUser);
    return all.filter((s) => allowed.has(s.id));
  }, [db, structure, isAdmin, currentUser]);

  const ranks = structure ? structureRanks(db, structure) : {};

  const setScore = (studentId: string, item: AssessmentItem, raw: string) => {
    if (!structure) return;
    update((d) => {
      const byStudent = (d.assessmentMarks[structure.id] = d.assessmentMarks[structure.id] ?? {});
      const row = (byStudent[studentId] = byStudent[studentId] ?? {});
      if (raw === "") {
        delete row[item.id];
        if (Object.keys(row).length === 0) delete byStudent[studentId];
        return;
      }
      const v = Number(raw);
      row[item.id] = isNaN(v) ? 0 : Math.max(0, Math.min(item.max, v));
    });
    setSavedAt(new Date().toLocaleTimeString("en-GB"));
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Examination" title="Mark entry" sub={isAdmin ? "Pick a structure, type raw marks — totals, percentages, grades and ranks are all derived." : "Only subjects you are assigned to appear. Totals follow each structure's weights."}>
        {isAdmin && <Btn variant="gold" onClick={() => setEditStruct("new")}><Plus className="h-4 w-4" /> New structure</Btn>}
      </PageHead>

      {allowedStructures.length === 0 ? (
        <Panel className="anim-rise"><EmptyState icon={<Table2 className="h-5 w-5" />} title="No assessment structures in your scope" body={isAdmin ? "Create a structure: subject + period + assessments with max marks and weights." : "Structures appear here once the admin configures them for your subjects, or ask the office."} action={isAdmin ? <Btn onClick={() => setEditStruct("new")}><Plus className="h-4 w-4" /> New structure</Btn> : undefined} /></Panel>
      ) : (
        <>
          <div className="anim-rise mb-4 flex flex-wrap gap-1.5">
            {allowedStructures.map((st) => {
              const active = structure?.id === st.id;
              return (
                <button key={st.id} onClick={() => { setSel({ id: st.id }); setSavedAt(null); }}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition-all duration-150 ${active ? "border-pine-800 bg-pine-800 text-white shadow-sm" : "border-mist bg-card hover:border-pine-300"}`}>
                  <span className={`block text-[12.5px] font-bold ${active ? "text-white" : "text-ink"}`}>{getSubject(db, st.subjectId)?.name}</span>
                  <span className={`block text-[10.5px] ${active ? "text-pine-300" : "text-soft"}`}>{getClass(db, st.classId)?.name} · {st.period}</span>
                </button>
              );
            })}
          </div>

          {structure && (
            <Panel className="anim-rise overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-mist bg-pine-900 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 className="font-display text-[15px] font-extrabold tracking-tight text-white">
                    {getSubject(db, structure.subjectId)?.name} — {getClass(db, structure.classId)?.name} · {structure.period}
                  </h2>
                  <p className="text-[11px] text-pine-300">Weights: {structure.items.map((i) => `${i.name} ${i.weight}%`).join(" · ")} · Σ {fmt1(structureWeightSum(structure))}%</p>
                </div>
                <div className="flex items-center gap-2">
                  {savedAt && <Chip tone="pine" className="!border-pine-600 !bg-pine-800 !text-pine-100"><Check className="h-3 w-3" /> Saved {savedAt}</Chip>}
                  {isAdmin && <Btn size="sm" variant="gold" onClick={() => setEditStruct(structure)}><Pencil className="h-3.5 w-3.5" /> Edit structure</Btn>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="border-b border-mist bg-paper/60">
                    <tr>
                      <th className={`${thCls()} w-10`}>#</th>
                      <th className={thCls()}>Student</th>
                      {structure.items.map((it) => (
                        <th key={it.id} className={`${thCls()} text-center`}>
                          <span className="block whitespace-nowrap">{it.name}</span>
                          <span className="font-mono text-[9.5px] font-semibold normal-case tracking-normal text-soft">/{it.max} · {it.weight}%</span>
                        </th>
                      ))}
                      <th className={`${thCls()} text-center text-gold-700`}>Total<span className="ml-1 font-mono text-[9.5px] font-semibold normal-case text-soft">/{fmt1(structureWeightSum(structure))}</span></th>
                      <th className={`${thCls()} text-center`}>%</th>
                      <th className={`${thCls()} text-center`}>Grade</th>
                      <th className={`${thCls()} text-center`}>Rank</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mist/70">
                    {roster.map((s, i) => {
                      const calc = assessmentCalc(db, structure, s.id);
                      const grade = calc?.complete ? gradeFor(calc.pct, db.grading) : null;
                      return (
                        <tr key={s.id} className={`transition-colors ${calc?.complete ? "hover:bg-pine-50/60" : calc ? "bg-gold-100/25" : "bg-paper/40"}`}>
                          <td className={`${tdCls()} tnum font-mono text-[11.5px] text-soft`}>{i + 1}</td>
                          <td className={tdCls()}>
                            <span className="flex items-center gap-2.5">
                              <Avatar student={s} size={30} />
                              <span className="font-bold text-ink">{shortName(s)}</span>
                              {calc && !calc.complete && <Chip tone="gold">incomplete</Chip>}
                              {!calc && <Chip tone="gray">not started</Chip>}
                            </span>
                          </td>
                          {structure.items.map((it) => (
                            <td key={it.id} className={`${tdCls()} text-center`}>
                              <input
                                type="number" min={0} max={it.max}
                                value={calc?.raw[it.id] ?? ""}
                                placeholder="–"
                                onChange={(e) => setScore(s.id, it, e.target.value)}
                                className="tnum w-16 rounded-md border border-mist bg-card px-2 py-1.5 text-center font-mono text-[13px] font-semibold outline-none transition-all focus:border-pine-500 focus:ring-2 focus:ring-pine-500/25"
                              />
                            </td>
                          ))}
                          <td className={`${tdCls()} text-center font-mono text-[13px] font-bold ${calc ? "text-ink" : "text-soft/50"}`}>{calc ? fmt1(calc.total) : "—"}</td>
                          <td className={`${tdCls()} tnum text-center font-mono text-[12.5px] font-semibold ${calc ? "text-pine-800" : "text-soft/50"}`}>{calc ? `${fmt1(calc.pct)}%` : "—"}</td>
                          <td className={`${tdCls()} text-center`}>{grade ? <Chip tone={calc!.pct >= 80 ? "pine" : calc!.pct >= 50 ? "gold" : "rust"}>{grade.grade}</Chip> : <span className="text-soft/40">—</span>}</td>
                          <td className={`${tdCls()} tnum text-center font-mono text-[12px] text-soft`}>{calc?.complete && ranks[s.id] ? ordinal(ranks[s.id]) : "—"}</td>
                        </tr>
                      );
                    })}
                    {roster.length === 0 && <tr><td colSpan={structure.items.length + 6} className="px-5 py-10 text-center text-[12.5px] text-soft">No students in scope for this structure.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}

      {editStruct && <StructureModal existing={editStruct === "new" ? undefined : editStruct} onClose={() => setEditStruct(null)} />}
    </div>
  );
}

function StructureModal({ existing, onClose }: { existing?: AssessmentStructure; onClose: () => void }) {
  const { db, yearId, update, toast } = useApp();
  const [f, setF] = useState({
    classId: existing?.classId ?? db.classes[0]?.id ?? "",
    subjectId: existing?.subjectId ?? db.subjects[0]?.id ?? "",
    period: existing?.period ?? "Semester 1",
  });
  const [items, setItems] = useState<AssessmentItem[]>(
    existing ? existing.items.map((i) => ({ ...i })) : [
      { id: uid(), name: "Assessment 1", max: 20, weight: 20 },
      { id: uid(), name: "Assessment 2", max: 20, weight: 20 },
      { id: uid(), name: "Assessment 3", max: 20, weight: 20 },
      { id: uid(), name: "Final Exam", max: 40, weight: 40 },
    ]
  );
  const weightSum = items.reduce((s, i) => s + (Number(i.weight) || 0), 0);
  const weightOk = Math.round(weightSum * 10) / 10 === 100;
  const setItem = (idx: number, patch: Partial<AssessmentItem>) => setItems((p) => p.map((x, j) => (j === idx ? { ...x, ...patch } : x)));

  const save = () => {
    if (items.length === 0 || items.some((i) => !i.name.trim() || !(Number(i.max) > 0) || !(Number(i.weight) > 0))) {
      toast("Every assessment needs a name, a positive maximum and a positive weight.", "warn"); return;
    }
    if (!existing && db.structures.some((s) => s.yearId === yearId && s.classId === f.classId && s.subjectId === f.subjectId && s.period === f.period)) {
      toast("A structure already exists for that subject, class and period.", "warn"); return;
    }
    const clean = items.map((i) => ({ ...i, name: i.name.trim(), max: Number(i.max), weight: Number(i.weight) }));
    update((d) => {
      if (existing) {
        const st = d.structures.find((x) => x.id === existing.id)!;
        st.classId = f.classId; st.subjectId = f.subjectId; st.period = f.period; st.items = clean;
      } else {
        d.structures.push({ id: uid(), yearId, classId: f.classId, subjectId: f.subjectId, period: f.period, items: clean });
      }
    });
    toast(existing ? "Structure updated — every mark re-weights instantly." : "Structure saved.");
    onClose();
  };

  return (
    <Modal title={existing ? "Edit assessment structure" : "New assessment structure"} kicker="Dynamic assessments — nothing hard-coded" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Save structure</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Grade" required>
          <Select value={f.classId} onChange={(e) => setF((p) => ({ ...p, classId: e.target.value }))}>
            {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject" required>
          <Select value={f.subjectId} onChange={(e) => setF((p) => ({ ...p, subjectId: e.target.value }))}>
            {db.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Period" required>
          <Select value={f.period} onChange={(e) => setF((p) => ({ ...p, period: e.target.value }))}>
            {PERIOD_OPTIONS.map((p) => <option key={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Assessments — any names, max marks and weights</p>
        <div className="overflow-hidden rounded-lg border border-mist">
          <div className="grid grid-cols-[1fr_92px_92px_36px] items-center gap-2 border-b border-mist bg-paper/70 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-soft">Assessment</span>
            <span className="text-center text-[10px] font-bold uppercase tracking-wider text-soft">Max</span>
            <span className="text-center text-[10px] font-bold uppercase tracking-wider text-soft">Weight %</span>
            <span />
          </div>
          <div className="divide-y divide-mist/70">
            {items.map((it, i) => (
              <div key={it.id} className="grid grid-cols-[1fr_92px_92px_36px] items-center gap-2 px-3 py-2">
                <TextInput value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className="!py-1.5" placeholder="Quiz, Project, Midterm…" />
                <TextInput type="number" min={1} value={it.max} onChange={(e) => setItem(i, { max: Number(e.target.value) })} className="!py-1.5 text-center font-mono" />
                <TextInput type="number" min={0} max={100} value={it.weight} onChange={(e) => setItem(i, { weight: Number(e.target.value) })} className="!py-1.5 text-center font-mono" />
                <button onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-paper/70 px-3 py-2.5">
            <Btn size="sm" variant="soft" onClick={() => setItems((p) => [...p, { id: uid(), name: "", max: 20, weight: 20 }])}><Plus className="h-3.5 w-3.5" /> Add assessment</Btn>
            <Chip tone={weightOk ? "pine" : "gold"}>{weightOk ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} Weights {fmt1(weightSum)}%</Chip>
          </div>
        </div>
        <p className="mt-2.5 text-[11.5px] text-soft">Raw marks scale as (raw ÷ max) × weight — totals, % and grades all derive from this.</p>
      </div>
    </Modal>
  );
}

/* ================= assignments (admin/teacher manage · student submits · guardian reads) ================= */
export function AssignmentsPage() {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const canManage = role === "admin" || role === "teacher";
  const pairs = teacherPairs(db, currentUser);
  const me = studentOf(db, currentUser);
  const [childId, setChildId] = useState<string>("");
  const kids = childrenOf(db, currentUser);
  const child = kids.find((k) => k.id === childId) ?? kids[0];

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ classId: "", sectionId: "", subjectId: "", title: "", description: "", due: todayISO() });

  // scope: which homework is visible
  const visible = db.homework.filter((h) => {
    if (h.yearId !== yearId) return false;
    if (role === "admin") return true;
    if (role === "teacher") return pairs.some((p) => p.classId === h.classId && p.sectionId === h.sectionId);
    const enr = role === "student" ? me?.enrollment : child?.enrollment;
    return enr ? h.classId === enr.classId && h.sectionId === enr.sectionId : false;
  }).sort((a, b) => a.due.localeCompare(b.due));

  const startNew = () => {
    const first = role === "teacher" ? pairs[0] : null;
    const fallbackClass = first?.classId ?? db.classes[0]?.id ?? "";
    const fallbackSec = first?.sectionId ?? db.classes[0]?.sections[0]?.id ?? "";
    const subj = first?.subjectIds[0] ?? db.subjects[0]?.id ?? "";
    setF({ classId: fallbackClass, sectionId: fallbackSec, subjectId: subj, title: "", description: "", due: todayISO() });
    setOpen(true);
  };

  const save = () => {
    if (!f.title.trim() || !f.sectionId) { toast("Title and placement are required.", "warn"); return; }
    update((d) => { d.homework.push({ id: uid(), yearId, classId: f.classId, sectionId: f.sectionId, subjectId: f.subjectId, title: f.title.trim(), description: f.description.trim(), issued: todayISO(), due: f.due, submitted: [] }); });
    const n = db.students.filter((s) => s.enrollment?.classId === f.classId && s.enrollment?.sectionId === f.sectionId).length;
    toast(`Published to ${n} students in ${sectionShort(db, f.classId, f.sectionId)}.`);
    setOpen(false);
  };

  const submitMine = (hwId: string) => {
    const myId = role === "student" ? me?.id : undefined;
    if (!myId) return;
    update((d) => {
      const h = d.homework.find((x) => x.id === hwId)!;
      h.submitted = h.submitted.includes(myId) ? h.submitted.filter((x) => x !== myId) : [...h.submitted, myId];
    });
  };

  const head = role === "teacher"
    ? { kicker: "Teaching", title: "Assignments", sub: "Homework you've set for your sections — publish once, every placed student receives it." }
    : role === "student"
      ? { kicker: "Learning", title: "My assignments", sub: "Everything set for your class and section. Mark work as submitted when it's handed in." }
      : role === "guardian"
        ? { kicker: "Family", title: "Assignments", sub: `${child ? shortName(child) + "'s" : "Your child's"} homework across all subjects.` }
        : { kicker: "Academics", title: "Assignments", sub: "Teacher-driven homework: Grade → Section → Subject, delivered to every placed student." };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead {...head}>
        {canManage && <Btn variant="gold" onClick={startNew}><Plus className="h-4 w-4" /> New homework</Btn>}
        {role === "guardian" && kids.length > 1 && (
          <Select value={child?.id ?? ""} onChange={(e) => setChildId(e.target.value)} className="!w-44">
            {kids.map((k) => <option key={k.id} value={k.id}>{shortName(k)}</option>)}
          </Select>
        )}
      </PageHead>

      {visible.length === 0 ? (
        <Panel className="anim-rise"><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No assignments here" body={canManage ? "Set the first homework — it lands on every student in the chosen section." : "Nothing has been set for this class yet."} action={canManage ? <Btn size="sm" variant="gold" onClick={startNew}><Plus className="h-3.5 w-3.5" /> New homework</Btn> : undefined} /></Panel>
      ) : (
        <div className="space-y-3">
          {visible.map((h, i) => {
            const subj = getSubject(db, h.subjectId);
            const roster = db.students.filter((s) => s.enrollment?.classId === h.classId && s.enrollment?.sectionId === h.sectionId);
            const today = todayISO();
            const days = Math.round((new Date(h.due + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
            const pct = roster.length ? (h.submitted.length / roster.length) * 100 : 0;
            const mineDone = role === "student" && me ? h.submitted.includes(me.id) : false;
            return (
              <Panel key={h.id} className="anim-rise overflow-hidden">
                <div className="flex gap-4 p-4" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className="w-1.5 shrink-0 rounded-full" style={{ background: subj?.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-[15.5px] font-bold tracking-tight text-ink">{h.title}</h3>
                      <Chip tone={days < 0 ? "rust" : days <= 1 ? "gold" : "gray"}>{days < 0 ? `${-days}d overdue` : days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days}d`}</Chip>
                    </div>
                    <p className="mt-0.5 text-[12px] text-soft">{subj?.name} · {sectionShort(db, h.classId, h.sectionId)} · due {fmtDate(h.due)}</p>
                    {h.description && <p className="mt-2 rounded-lg bg-paper/80 px-3 py-2 text-[12.5px] leading-relaxed text-ink">{h.description}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {canManage ? (
                        <>
                          <span className="h-1.5 w-36 overflow-hidden rounded-full bg-mist"><span className="anim-bar block h-full rounded-full bg-pine-600" style={{ width: `${pct}%` }} /></span>
                          <span className="tnum font-mono text-[11.5px] font-bold text-ink">{h.submitted.length}/{roster.length} submitted</span>
                          <button onClick={() => { update((d) => { d.homework = d.homework.filter((x) => x.id !== h.id); }); toast("Homework removed."); }} className="ml-auto cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </>
                      ) : role === "student" ? (
                        <Btn size="sm" variant={mineDone ? "soft" : "solid"} onClick={() => submitMine(h.id)}>
                          {mineDone ? <><Check className="h-3.5 w-3.5" /> Submitted — undo</> : <><Send className="h-3.5 w-3.5" /> Mark as submitted</>}
                        </Btn>
                      ) : (
                        <Chip tone={h.submitted.length ? "pine" : "gray"}>{child && h.submitted.includes(child.id) ? `${child.firstName} submitted` : `${child?.firstName ?? "—"} hasn't submitted`}</Chip>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {open && (
        <Modal title="New homework" kicker={`${role === "teacher" ? "Your sections only" : "Any section"}`} onClose={() => setOpen(false)} wide
          footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn onClick={save}><ClipboardList className="h-4 w-4" /> Publish to section</Btn></>}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Grade" required>
              <Select value={f.classId} onChange={(e) => {
                const allowed = role === "teacher" ? pairs.filter((p) => p.classId === e.target.value) : null;
                setF((p) => ({ ...p, classId: e.target.value, sectionId: allowed ? allowed[0]?.sectionId ?? "" : db.classes.find((c) => c.id === e.target.value)?.sections[0]?.id ?? "" }));
              }}>
                {(role === "teacher" ? db.classes.filter((c) => pairs.some((p) => p.classId === c.id)) : db.classes).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Section" required>
              <Select value={f.sectionId} onChange={(e) => setF((p) => ({ ...p, sectionId: e.target.value }))}>
                {(role === "teacher" ? pairs.filter((p) => p.classId === f.classId) : getClass(db, f.classId)?.sections.map((s) => ({ classId: f.classId, sectionId: s.id, subjectIds: [] })) ?? []).map((p) => (
                  <option key={p.sectionId} value={p.sectionId}>Section {getSection(db, f.classId, p.sectionId)?.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject" required>
              <Select value={f.subjectId} onChange={(e) => setF((p) => ({ ...p, subjectId: e.target.value }))}>
                {(role === "teacher" ? [...new Set(pairs.filter((p) => p.classId === f.classId && p.sectionId === f.sectionId).flatMap((p) => p.subjectIds))].map((id) => getSubject(db, id)!) : db.subjects).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid gap-4">
            <Field label="Title" required><TextInput value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="Solve exercises 1–10, page 24" /></Field>
            <Field label="Instructions"><TextInput value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field>
            <Field label="Due date" required className="sm:w-56"><TextInput type="date" value={f.due} onChange={(e) => setF((p) => ({ ...p, due: e.target.value }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= reports (admin any student · student own · guardian child) ================= */
export function ReportsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role ?? "admin";
  const kids = childrenOf(db, currentUser);
  const me = studentOf(db, currentUser);
  const [pick, setPick] = useState<string>("");

  const target: Student | undefined =
    role === "admin"
      ? db.students.find((s) => s.id === pick) ?? db.students.filter((s) => s.enrollment)[0]
      : role === "student"
        ? me ?? undefined
        : kids.find((k) => k.id === pick) ?? kids[0];

  const results = target ? studentResults(db, target) : [];
  const avg = target ? studentAverage(db, target) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker={role === "admin" ? "Reports" : "Grades"} title={role === "admin" ? "Student reports" : role === "student" ? "My grades" : "My child's grades"} sub="Weighted totals, percentages, grades and calculated positions — no manual numbers anywhere.">
        {role === "admin" && (
          <Select value={target?.id ?? ""} onChange={(e) => setPick(e.target.value)} className="!w-56">
            {db.students.filter((s) => s.enrollment).map((s) => <option key={s.id} value={s.id}>{shortName(s)} · {sectionShort(db, s.enrollment!.classId, s.enrollment!.sectionId)}</option>)}
          </Select>
        )}
        {role === "guardian" && kids.length > 0 && (
          <Select value={target?.id ?? ""} onChange={(e) => setPick(e.target.value)} className="!w-48">
            {kids.map((k) => <option key={k.id} value={k.id}>{shortName(k)}</option>)}
          </Select>
        )}
      </PageHead>

      {!target ? (
        <Panel><EmptyState icon={<FileBarChart2 className="h-5 w-5" />} title="No student selected" body="Pick a student to generate their report." /></Panel>
      ) : (
        <Panel className="anim-rise overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist bg-pine-900 px-5 py-4">
            <div className="flex items-center gap-3">
              <Avatar student={target} size={44} className="ring-pine-700" />
              <div>
                <h2 className="font-display text-[16px] font-extrabold text-white">{target.firstName} {target.middleName} {target.lastName}</h2>
                <p className="text-[11.5px] text-pine-300">{sectionLabel(db, target.enrollment?.classId, target.enrollment?.sectionId)} · {target.regId}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Chip tone="gold" className="!text-[12px]">Average {avg != null ? `${avg}%` : "—"}</Chip>
              {avg != null && <Chip tone="pine" className="!text-[12px]">Grade {gradeFor(avg, db.grading).grade}</Chip>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-mist bg-paper/60">
                <tr><th className={thCls()}>Subject</th><th className={thCls()}>Period</th><th className={thCls()}>Total</th><th className={thCls()}>%</th><th className={thCls()}>Grade</th><th className={thCls()}>Remark</th><th className={thCls()}>Position</th></tr>
              </thead>
              <tbody className="divide-y divide-mist/70">
                {results.map(({ st, calc, subject }) => {
                  const band = gradeFor(calc.pct, db.grading);
                  const ranks = structureRanks(db, st);
                  return (
                    <tr key={st.id} className="transition-colors hover:bg-pine-50/50">
                      <td className={tdCls()}><span className="flex items-center gap-2 font-bold text-ink"><span className="h-4 w-1 rounded-full" style={{ background: subject?.color }} />{subject?.name}</span></td>
                      <td className={`${tdCls()} text-soft`}>{st.period}</td>
                      <td className={`${tdCls()} font-mono text-[12px]`}>{calc.complete ? `${fmt1(calc.total)}/${fmt1(structureWeightSum(st))}` : "—"}</td>
                      <td className={`${tdCls()} font-mono text-[12.5px] font-bold ${calc.complete ? "text-pine-800" : "text-gold-600"}`}>{calc.complete ? `${fmt1(calc.pct)}%` : "in progress"}</td>
                      <td className={tdCls()}>{calc.complete ? <Chip tone={calc.pct >= 80 ? "pine" : calc.pct >= 50 ? "gold" : "rust"}>{band.grade}</Chip> : "—"}</td>
                      <td className={`${tdCls()} text-soft`}>{calc.complete ? band.remark : "—"}</td>
                      <td className={`${tdCls()} text-soft`}>{calc.complete && ranks[target.id] ? `${ordinal(ranks[target.id])} of ${Object.keys(ranks).length}` : "—"}</td>
                    </tr>
                  );
                })}
                {results.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-[12.5px] text-soft">No assessment structures for this class yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ================= attendance (admin all · teacher assigned · student/guardian own register) ================= */
export function AttendancePage() {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";

  if (role === "student" || role === "guardian") return <OwnAttendance />;
  return <Registrar />;
}

function Registrar() {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const pairs = teacherPairs(db, currentUser);
  const isAdmin = role === "admin";

  const options = isAdmin
    ? db.classes.flatMap((c) => c.sections.map((s) => ({ classId: c.id, sectionId: s.id })))
    : pairs.map((p) => ({ classId: p.classId, sectionId: p.sectionId }));

  const [classId, setClassId] = useState(options[0]?.classId ?? "");
  const [sectionId, setSectionId] = useState(options[0]?.sectionId ?? "");
  const [date, setDate] = useState(todayISO());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [loadedKey, setLoadedKey] = useState("");

  const key = `${date}|${classId}|${sectionId}`;
  const existing = db.attendance.find((r) => r.date === date && r.classId === classId && r.sectionId === sectionId);
  const roster = db.students.filter((s) => s.enrollment?.classId === classId && s.enrollment?.sectionId === sectionId);

  if (loadedKey !== key) {
    const m: Record<string, AttendanceStatus> = {};
    roster.forEach((s) => { m[s.id] = existing?.marks[s.id] ?? "present"; });
    setMarks(m);
    setLoadedKey(key);
  }

  const save = () => {
    update((d) => {
      d.attendance = d.attendance.filter((r) => !(r.date === date && r.classId === classId && r.sectionId === sectionId));
      d.attendance.push({ date, classId, sectionId, marks });
    });
    toast(`Register saved for ${sectionShort(db, classId, sectionId)} · ${fmtDate(date)}.`);
  };

  const counts = { P: 0, L: 0, A: 0 };
  roster.forEach((s) => { const m = marks[s.id] ?? "present"; counts[m === "present" ? "P" : m === "late" ? "L" : "A"]++; });

  if (options.length === 0) {
    return <Panel><EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No sections assigned" body="You'll see registers here once classes are assigned to you." /></Panel>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Administration" title="Attendance" sub={isAdmin ? "Every section's register, every day." : "Registers for your assigned sections only."} />
      <Panel className="anim-rise overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-mist px-5 py-4">
          <Field label="Grade" className="w-36">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); const first = options.find((o) => o.classId === e.target.value); if (first) setSectionId(first.sectionId); setLoadedKey(""); }}>
              {[...new Set(options.map((o) => o.classId))].map((cid) => <option key={cid} value={cid}>{getClass(db, cid)?.name}</option>)}
            </Select>
          </Field>
          <Field label="Section" className="w-32">
            <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setLoadedKey(""); }}>
              {options.filter((o) => o.classId === classId).map((o) => <option key={o.sectionId} value={o.sectionId}>Section {getSection(db, o.classId, o.sectionId)?.name}</option>)}
            </Select>
          </Field>
          <Field label="Date" className="w-40">
            <TextInput type="date" value={date} onChange={(e) => { setDate(e.target.value); setLoadedKey(""); }} />
          </Field>
          <div className="ml-auto flex items-center gap-2">
            {existing && <Chip tone="pine"><Check className="h-3 w-3" /> already saved</Chip>}
            <Chip tone="gray">{counts.P}P · {counts.L}L · {counts.A}A</Chip>
          </div>
        </div>

        {roster.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No students in this section" body="Place students into this class-section first." />
        ) : (
          <ul className="divide-y divide-mist/70">
            {roster.map((s) => {
              const cur = marks[s.id] ?? "present";
              return (
                <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-pine-50/40">
                  <Avatar student={s} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">{shortName(s)}</p>
                    <p className="font-mono text-[10.5px] text-soft">{s.regId}</p>
                  </div>
                  <div className="flex gap-1">
                    {(Object.keys(ATT_META) as AttendanceStatus[]).map((st) => (
                      <button key={st} onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                        className={`h-8 w-9 cursor-pointer rounded-md border text-[12px] font-extrabold transition-all duration-100 active:scale-90 ${cur === st ? ATT_META[st].on : "border-mist bg-card text-soft hover:border-pine-300"}`}>
                        {ATT_META[st].label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {roster.length > 0 && (
          <div className="flex justify-end border-t border-mist bg-paper/60 px-5 py-3.5">
            <Btn onClick={save}><Check className="h-4 w-4" /> {existing ? "Update register" : "Save register"}</Btn>
          </div>
        )}
      </Panel>
    </div>
  );
}

function OwnAttendance() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role ?? "student";
  const kids = childrenOf(db, currentUser);
  const me = studentOf(db, currentUser);
  const [childId, setChildId] = useState<string>("");
  const target: Student | undefined = role === "student" ? me ?? undefined : kids.find((k) => k.id === childId) ?? kids[0];
  if (!target || !target.enrollment) return <Panel><EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No linked record" body="Ask the front office to link your account." /></Panel>;
  const att = attendanceStats(db, target.id);
  const records = db.attendance
    .filter((r) => r.classId === target.enrollment!.classId && r.sectionId === target.enrollment!.sectionId && r.marks[target.id])
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead kicker={role === "student" ? "Learning" : "Family"} title={role === "student" ? "My attendance" : "Attendance"}>
        {role === "guardian" && kids.length > 1 && (
          <Select value={target.id} onChange={(e) => setChildId(e.target.value)} className="!w-44">
            {kids.map((k) => <option key={k.id} value={k.id}>{shortName(k)}</option>)}
          </Select>
        )}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel className="anim-rise flex flex-col items-center justify-center gap-2 p-6">
          <Ring pct={att.pct} size={110} stroke={9} color={att.pct >= 90 ? "var(--color-pine-600)" : att.pct >= 75 ? "var(--color-gold-500)" : "var(--color-rust-500)"} />
          <p className="font-display text-[15px] font-bold">Overall attendance</p>
          <div className="mt-1 flex gap-2">
            <Chip tone="pine">{att.present} present</Chip>
            <Chip tone="gold">{att.late} late</Chip>
            <Chip tone="rust">{att.absent} absent</Chip>
          </div>
        </Panel>
        <Panel className="anim-rise overflow-hidden md:col-span-2">
          <div className="border-b border-mist px-5 py-3.5"><h3 className="font-display text-[15px] font-bold">Register history</h3></div>
          <ul className="max-h-[380px] divide-y divide-mist/70 overflow-y-auto">
            {records.map((r) => (
              <li key={r.date} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-[13px] font-semibold text-ink">{fmtDate(r.date)}</span>
                <Chip tone={r.marks[target.id] === "present" ? "pine" : r.marks[target.id] === "late" ? "gold" : "rust"}>{r.marks[target.id]}</Chip>
              </li>
            ))}
            {records.length === 0 && <li className="px-5 py-10 text-center text-[12.5px] text-soft">No registers recorded yet.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/* ================= fees (admin) ================= */
export function FeesPage() {
  const { db, update, toast } = useApp();
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [outOnly, setOutOnly] = useState(false);

  const rows = db.fees
    .map((f) => ({ f, s: db.students.find((x) => x.id === f.studentId)! }))
    .filter((x) => x.s)
    .filter(({ f }) => !outOnly || f.paid < f.amount)
    .sort((a, b) => (b.f.amount - b.f.paid) - (a.f.amount - a.f.paid));
  const billed = db.fees.reduce((s, f) => s + f.amount, 0);
  const collected = db.fees.reduce((s, f) => s + f.paid, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Administration" title="Fees" sub="Charges sit against the student record — payments update every profile instantly.">
        <button onClick={() => setOutOnly(!outOnly)} className={`cursor-pointer rounded-lg border px-3 py-2 text-[12px] font-bold transition-all ${outOnly ? "border-rust-500 bg-rust-100 text-rust-700" : "border-mist bg-card text-soft hover:text-ink"}`}>
          Outstanding only
        </button>
      </PageHead>

      <div className="anim-rise mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Billed", value: billed, cls: "text-ink" },
          { label: "Collected", value: collected, cls: "text-pine-700" },
          { label: "Outstanding", value: billed - collected, cls: "text-rust-600" },
        ].map((x) => (
          <Panel key={x.label} className="px-5 py-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-soft">{x.label}</p>
            <p className={`font-display text-[24px] font-extrabold tracking-tight ${x.cls}`}>ETB {x.value.toLocaleString()}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist">
              <div className="anim-bar h-full rounded-full bg-pine-600" style={{ width: `${billed ? (collected / billed) * 100 : 0}%` }} />
            </div>
          </Panel>
        ))}
      </div>

      <Panel className="anim-rise overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-mist bg-paper/60">
              <tr><th className={thCls()}>Student</th><th className={thCls()}>Item</th><th className={thCls()}>Amount</th><th className={thCls()}>Paid</th><th className={thCls()}>Balance</th><th className={thCls()}>Due</th><th className={thCls()}></th></tr>
            </thead>
            <tbody className="divide-y divide-mist/70">
              {rows.slice(0, 40).map(({ f, s }) => {
                const bal = f.amount - f.paid;
                return (
                  <tr key={f.id} className="transition-colors hover:bg-pine-50/60">
                    <td className={tdCls()}>
                      <span className="flex items-center gap-2.5">
                        <Avatar student={s} size={30} />
                        <span>
                          <span className="block font-bold text-ink">{shortName(s)}</span>
                          <span className="text-[10.5px] text-soft">{sectionShort(db, s.enrollment?.classId, s.enrollment?.sectionId)}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${tdCls()} text-soft`}>{f.label}</td>
                    <td className={`${tdCls()} font-mono text-[12px]`}>{f.amount.toLocaleString()}</td>
                    <td className={`${tdCls()} font-mono text-[12px] text-pine-700`}>{f.paid.toLocaleString()}</td>
                    <td className={tdCls()}>{bal > 0 ? <Chip tone="rust">{bal.toLocaleString()}</Chip> : <Chip tone="pine">Settled</Chip>}</td>
                    <td className={`${tdCls()} text-soft`}>{fmtDate(f.due)}</td>
                    <td className={`${tdCls()} text-right`}>{bal > 0 && <Btn size="sm" variant="soft" onClick={() => { setPayFor(f.id); setPayAmt(String(bal)); }}>Record payment</Btn>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {payFor && (
        <Modal title="Record payment" kicker="Fees" onClose={() => setPayFor(null)}
          footer={<>
            <Btn variant="ghost" onClick={() => setPayFor(null)}>Cancel</Btn>
            <Btn onClick={() => {
              const amt = Math.max(0, Number(payAmt) || 0);
              if (amt <= 0) { toast("Enter a valid amount.", "warn"); return; }
              update((d) => { const fi = d.fees.find((x) => x.id === payFor)!; fi.paid = Math.min(fi.amount, fi.paid + amt); });
              toast(`Payment of ETB ${amt.toLocaleString()} recorded.`);
              setPayFor(null);
            }}>Save payment</Btn>
          </>}>
          <Field label="Amount (ETB)" required><TextInput type="number" min={0} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
