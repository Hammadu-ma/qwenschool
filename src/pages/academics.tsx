import { useEffect, useMemo, useState } from "react";
import {
  Banknote, BookOpen, CalendarCheck2, Check, CheckCheck, CheckCircle2,
  ClipboardList, Clock as ClockIcon, Eye, FileBarChart2, Globe2, Layers,
  Pencil, Plus, Printer, Receipt, RotateCcw, Save, Send, ShieldCheck, Table2, Tag, Trash2,
  Undo2, UserCheck, UserX, Wallet,
} from "lucide-react";
import type {
  AssessmentItem, AssessmentStructure, Assignment, AttendanceStatus, FeeItem,
  SchoolClass, Section, Student, Submission, Subject, TimetableEntry,
} from "../types";
import {
  assessmentCalc, attendanceStats, childrenOf, feeStats, fmt1, fmtDate, fullName, getClass,
  getSubject, getTeacher, gradeFor, ordinal, sectionLabel, sectionShort, shortName,
  structureRanks, structureWeightSum, studentAverage, studentOf, studentResults, studentsOf,
  submissionFor, submissionStatus, teacherFor, teacherPairs, teacherStudentIds,
  todayISO, uid, useApp,
} from "../store";
import { hasPermission, pushAudit, pushNotifications } from "../rbac";
import {
  Avatar, Btn, Chip, EmptyState, Field, Modal, PageHead, Panel, Select, Stat, Tabs,
  TextArea, TextInput, tdCls, thCls,
} from "../ui";
import { AccessDenied } from "./Auth";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PERIODS = [1, 2, 3, 4, 5, 6];

/* ================= submission status chip (used by mark entry) ================= */
function SubmissionChip({ status }: { status: Submission["status"] }) {
  const meta: Record<Submission["status"], { tone: "gray" | "steel" | "gold" | "pine" | "rust"; label: string }> = {
    draft: { tone: "gray", label: "Draft" },
    submitted: { tone: "steel", label: "Submitted" },
    approved: { tone: "gold", label: "Approved" },
    published: { tone: "pine", label: "Published" },
    returned: { tone: "rust", label: "Returned" },
  };
  const m = meta[status];
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

/* ================= mark entry (admin full / teacher scoped) ================= */
export function MarkEntryPage() {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const isAdmin = role === "admin";
  const pairs = teacherPairs(db, currentUser);

  const allStructures = db.structures.filter((st) => st.yearId === yearId);

  const allowedStructures = allStructures.filter((st) => {
    if (isAdmin) return true;
    return pairs.some((p) => p.classId === st.classId && p.subjectIds.includes(st.subjectId));
  });

  const classOptions = [...new Set(allowedStructures.map((st) => st.classId))];
  const subjectOptions = [...new Set(allowedStructures.map((st) => st.subjectId))];

  const [filterClassId, setFilterClassId] = useState<string>("");
  const [filterSectionId, setFilterSectionId] = useState<string>("");
  const [filterSubjectId, setFilterSubjectId] = useState<string>("");

  const filteredStructures = allowedStructures.filter((st) => {
    if (filterClassId && st.classId !== filterClassId) return false;
    if (filterSectionId) {
      const cls = getClass(db, st.classId);
      if (!cls?.sections.some((s) => s.id === filterSectionId)) return false;
    }
    if (filterSubjectId && st.subjectId !== filterSubjectId) return false;
    return true;
  });

  const [sel, setSel] = useState<{ id: string | null }>({ id: null });
  const [editStruct, setEditStruct] = useState<AssessmentStructure | "new" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const structure = useMemo(() => {
    const current = filteredStructures.find((s) => s.id === sel.id);
    if (current) return current;
    return filteredStructures[0] ?? null;
  }, [filteredStructures, sel.id]);

  useEffect(() => {
    if (filteredStructures.length > 0 && (!sel.id || !filteredStructures.some((s) => s.id === sel.id))) {
      setSel({ id: filteredStructures[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStructures.map((s) => s.id).join(",")]);

  const availableSections = useMemo(() => {
    if (!filterClassId) return [];
    const cls = getClass(db, filterClassId);
    return cls?.sections || [];
  }, [db, filterClassId]);

  const roster: Student[] = useMemo(() => {
    if (!structure) return [];
    const all = db.students.filter((s) => s.enrollment?.classId === structure.classId);
    if (isAdmin) return all;
    const allowed = teacherStudentIds(db, currentUser);
    return all.filter((s) => allowed.has(s.id));
  }, [db, structure, isAdmin, currentUser]);

  const ranks = structure ? structureRanks(db, structure) : {};

  const submission = structure ? submissionFor(db, structure.id) : undefined;
  const status = structure ? submissionStatus(db, structure.id) : "draft";
  const canApprove = hasPermission(db, currentUser, "results.manage");
  const canPublish = hasPermission(db, currentUser, "results.publish");
  const canEnter = hasPermission(db, currentUser, "exams.enter_marks") || isAdmin;
  const canEdit = canEnter && (status === "draft" || status === "returned");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);

  const ensureSubmission = (d: { submissions: Submission[] }, structureId: string): Submission => {
    let s = d.submissions.find((x) => x.structureId === structureId);
    if (!s) {
      s = { id: uid(), structureId, status: "draft" };
      d.submissions.push(s);
    }
    return s;
  };

  const doSubmit = () => {
    if (!structure || !currentUser) return;
    update((d) => {
      const s = ensureSubmission(d, structure.id);
      s.status = "submitted";
      s.submittedBy = currentUser.id;
      s.submittedAt = new Date().toISOString();
      s.returnReason = undefined;
      pushAudit(d, currentUser, "marks.submit", `${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name} · ${structure.period}`, "Submitted for review");
      const approvers = d.users.filter((u) => u.status === "active" && u.id !== currentUser.id && d.roles.find((r) => r.id === u.roleId)?.permissions.includes("results.manage"));
      pushNotifications(d, approvers.map((u) => u.id), "result", "Marks awaiting review", `${currentUser.name} submitted ${getSubject(db, structure.subjectId)?.name} — ${getClass(db, structure.classId)?.name}.`);
    });
    setConfirmSubmit(false);
    toast("Submitted for administrative review.");
  };

  const doApprove = () => {
    if (!structure || !currentUser) return;
    update((d) => {
      const s = ensureSubmission(d, structure.id);
      s.status = "approved";
      s.approvedBy = currentUser.id;
      s.approvedAt = new Date().toISOString();
      pushAudit(d, currentUser, "marks.approve", `${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name}`, "Approved");
      if (s.submittedBy) pushNotifications(d, [s.submittedBy], "result", "Marks approved", `Your ${getSubject(db, structure.subjectId)?.name} marks were approved by ${currentUser.name}.`);
    });
    toast("Marks approved.");
  };

  const doReturn = () => {
    if (!structure || !currentUser || !returnReason.trim()) { toast("A reason is required to return marks.", "warn"); return; }
    update((d) => {
      const s = ensureSubmission(d, structure.id);
      s.status = "returned";
      s.returnedBy = currentUser.id;
      s.returnedAt = new Date().toISOString();
      s.returnReason = returnReason.trim();
      pushAudit(d, currentUser, "marks.return", `${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name}`, returnReason.trim());
      if (s.submittedBy) pushNotifications(d, [s.submittedBy], "result", "Marks returned for correction", returnReason.trim());
    });
    setReturnOpen(false);
    setReturnReason("");
    toast("Returned for correction.");
  };

  const doPublish = () => {
    if (!structure || !currentUser) return;
    update((d) => {
      const s = ensureSubmission(d, structure.id);
      s.status = "published";
      s.publishedBy = currentUser.id;
      s.publishedAt = new Date().toISOString();
      pushAudit(d, currentUser, "results.publish", `${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name}`, "Published to students & families");
      const classStudents = d.students.filter((st) => st.enrollment?.classId === structure.classId);
      const recipients = d.users.filter((u) => u.status === "active" && (classStudents.some((st) => u.studentId === st.id) || (u.childrenIds ?? []).some((cid) => classStudents.some((st) => st.id === cid))));
      pushNotifications(d, recipients.map((u) => u.id), "result", "Results published", `${getSubject(db, structure.subjectId)?.name} results for ${getClass(db, structure.classId)?.name} are now available.`);
    });
    setConfirmPublish(false);
    toast("Published — students and families can now view these results.");
  };

  const doReopen = () => {
    if (!structure || !currentUser) return;
    update((d) => {
      const s = ensureSubmission(d, structure.id);
      s.status = "draft";
      s.approvedBy = undefined; s.approvedAt = undefined; s.publishedBy = undefined; s.publishedAt = undefined;
      pushAudit(d, currentUser, "marks.reopen", `${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name}`, "Reopened for editing");
    });
    toast("Reopened — marks are editable again.");
  };

  const setScore = (studentId: string, item: AssessmentItem, raw: string) => {
    if (!structure || !canEdit) return;
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

      <div className="anim-rise mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-mist bg-card p-3">
        <Field label="Grade" className="w-40">
          <Select
            value={filterClassId}
            onChange={(e) => { setFilterClassId(e.target.value); setFilterSectionId(""); setSel({ id: null }); }}
          >
            <option value="">All grades</option>
            {classOptions.map((id) => {
              const cls = getClass(db, id);
              return cls ? <option key={id} value={id}>{cls.name}</option> : null;
            })}
          </Select>
        </Field>

        <Field label="Section" className="w-32">
          <Select
            value={filterSectionId}
            onChange={(e) => { setFilterSectionId(e.target.value); setSel({ id: null }); }}
            disabled={!filterClassId}
          >
            <option value="">All sections</option>
            {availableSections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
          </Select>
        </Field>

        <Field label="Subject" className="w-48">
          <Select
            value={filterSubjectId}
            onChange={(e) => { setFilterSubjectId(e.target.value); setSel({ id: null }); }}
          >
            <option value="">All subjects</option>
            {subjectOptions.map((id) => {
              const subj = getSubject(db, id);
              return subj ? <option key={id} value={id}>{subj.name}</option> : null;
            })}
          </Select>
        </Field>

        {(filterClassId || filterSectionId || filterSubjectId) && (
          <Btn size="sm" variant="ghost" onClick={() => { setFilterClassId(""); setFilterSectionId(""); setFilterSubjectId(""); setSel({ id: null }); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Clear filters
          </Btn>
        )}

        <span className="ml-auto text-[11.5px] text-soft">{filteredStructures.length} structure{filteredStructures.length !== 1 ? "s" : ""} found</span>
      </div>

      {allowedStructures.length === 0 ? (
        <Panel className="anim-rise"><EmptyState icon={<Table2 className="h-5 w-5" />} title="No assessment structures in your scope" body={isAdmin ? "Create a structure: subject + period + assessments with max marks and weights." : "Structures appear here once the admin configures them for your subjects, or ask the office."} action={isAdmin ? <Btn onClick={() => setEditStruct("new")}><Plus className="h-4 w-4" /> New structure</Btn> : undefined} /></Panel>
      ) : filteredStructures.length === 0 ? (
        <Panel className="anim-rise"><EmptyState icon={<Table2 className="h-5 w-5" />} title="No structures match your filters" body="Try adjusting your filter criteria." /></Panel>
      ) : (
        <>
          <div className="anim-rise mb-4 flex flex-wrap gap-1.5">
            {filteredStructures.map((st) => {
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
                <div className="flex flex-wrap items-center gap-2">
                  {savedAt && status === "draft" && <Chip tone="pine" className="!border-pine-600 !bg-pine-800 !text-pine-100"><Check className="h-3 w-3" /> Saved {savedAt}</Chip>}
                  <SubmissionChip status={status} />
                  {isAdmin && <Btn size="sm" variant="gold" onClick={() => setEditStruct(structure)}><Pencil className="h-3.5 w-3.5" /> Edit structure</Btn>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-mist bg-paper/70 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && canEnter && (
                    <Btn size="sm" onClick={() => setConfirmSubmit(true)}><Send className="h-3.5 w-3.5" /> Submit for review</Btn>
                  )}
                  {status === "submitted" && canApprove && (
                    <>
                      <Btn size="sm" variant="gold" onClick={doApprove}><CheckCheck className="h-3.5 w-3.5" /> Approve</Btn>
                      <Btn size="sm" variant="dangerSoft" onClick={() => setReturnOpen(true)}><Undo2 className="h-3.5 w-3.5" /> Return for correction</Btn>
                    </>
                  )}
                  {status === "approved" && canPublish && (
                    <Btn size="sm" variant="solid" onClick={() => setConfirmPublish(true)}><Globe2 className="h-3.5 w-3.5" /> Publish results</Btn>
                  )}
                  {(status === "approved" || status === "published") && canApprove && (
                    <Btn size="sm" variant="ghost" onClick={doReopen}><RotateCcw className="h-3.5 w-3.5" /> Reopen</Btn>
                  )}
                </div>
                {!canEdit && (
                  <p className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold text-soft">
                    <ShieldCheck className="h-3.5 w-3.5 text-pine-600" />
                    {status === "submitted" ? "Locked — awaiting administrative review." : status === "approved" ? "Locked — approved, ready to publish." : status === "published" ? "Locked — published and visible to students & families." : "Locked."}
                  </p>
                )}
                {canEdit && status === "returned" && submission?.returnReason && (
                  <p className="ml-auto max-w-md truncate text-[11.5px] font-semibold text-rust-600" title={submission.returnReason}>↩ {submission.returnReason}</p>
                )}
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
                                disabled={!canEdit}
                                onChange={(e) => setScore(s.id, it, e.target.value)}
                                className={`tnum w-16 rounded-md border border-mist bg-card px-2 py-1.5 text-center font-mono text-[13px] font-semibold outline-none transition-all focus:border-pine-500 focus:ring-2 focus:ring-pine-500/25 ${!canEdit ? "cursor-not-allowed bg-paper/60 text-soft" : ""}`}
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

      {structure && confirmSubmit && (
        <Modal title="Submit marks for review" kicker={`${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name} · ${structure.period}`} onClose={() => setConfirmSubmit(false)}
          footer={<><Btn variant="ghost" onClick={() => setConfirmSubmit(false)}>Cancel</Btn><Btn onClick={doSubmit}><Send className="h-4 w-4" /> Submit</Btn></>}>
          <p className="text-[13px] leading-relaxed text-ink">
            You are about to submit marks for <strong>{getClass(db, structure.classId)?.name}</strong> — <strong>{getSubject(db, structure.subjectId)?.name}</strong> — <strong>{structure.period}</strong>.
          </p>
          <p className="mt-2 rounded-lg bg-paper px-3 py-2.5 text-[12.5px] leading-relaxed text-soft">
            Once submitted, marks are locked and require administrative review before publication.
            {canApprove && <span className="mt-1 block font-semibold text-pine-700">You hold the approve permission, so you may also approve this submission.</span>}
          </p>
        </Modal>
      )}

      {structure && returnOpen && (
        <Modal title="Return for correction" kicker="A reason is required" onClose={() => setReturnOpen(false)}
          footer={<><Btn variant="ghost" onClick={() => setReturnOpen(false)}>Cancel</Btn><Btn variant="danger" onClick={doReturn}><Undo2 className="h-4 w-4" /> Return marks</Btn></>}>
          <Field label="Reason" required>
            <TextArea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="e.g. Please verify Abebe's mark — the attendance register shows he was absent." />
          </Field>
          <p className="mt-2 text-[12px] text-soft">The teacher will be notified and can correct and resubmit.</p>
        </Modal>
      )}

      {structure && confirmPublish && (
        <Modal title="Publish results" kicker={`${getSubject(db, structure.subjectId)?.name} · ${getClass(db, structure.classId)?.name}`} onClose={() => setConfirmPublish(false)}
          footer={<><Btn variant="ghost" onClick={() => setConfirmPublish(false)}>Cancel</Btn><Btn variant="gold" onClick={doPublish}><Globe2 className="h-4 w-4" /> Publish</Btn></>}>
          <p className="text-[13px] leading-relaxed text-ink">Publishing makes these results visible to the students of <strong>{getClass(db, structure.classId)?.name}</strong> and their families.</p>
          <p className="mt-2 rounded-lg bg-paper px-3 py-2.5 text-[12.5px] text-soft">This is recorded in the audit log. You can reopen later if a correction is needed.</p>
        </Modal>
      )}
    </div>
  );
}

/** Create / edit an assessment structure — subject + class + period + weighted items. */
function StructureModal({ existing, onClose }: { existing?: AssessmentStructure; onClose: () => void }) {
  const { db, yearId, update, toast, currentUser } = useApp();
  const [classId, setClassId] = useState(existing?.classId ?? db.classes[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? db.subjects[0]?.id ?? "");
  const [period, setPeriod] = useState(existing?.period ?? "Semester 1");
  const [items, setItems] = useState<AssessmentItem[]>(existing?.items.map((i) => ({ ...i })) ?? [
    { id: uid(), name: "Assessment 1", max: 20, weight: 20 },
    { id: uid(), name: "Final Exam", max: 40, weight: 40 },
  ]);

  const weightSum = items.reduce((s, i) => s + (Number(i.weight) || 0), 0);

  const addItem = () => setItems((p) => [...p, { id: uid(), name: `Assessment ${p.length + 1}`, max: 20, weight: 20 }]);
  const removeItem = (id: string) => setItems((p) => p.filter((i) => i.id !== id));
  const patchItem = (id: string, patch: Partial<AssessmentItem>) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const save = () => {
    if (!classId || !subjectId) { toast("Choose a class and subject.", "warn"); return; }
    if (items.length === 0) { toast("Add at least one assessment item.", "warn"); return; }
    if (items.some((i) => !i.name.trim())) { toast("Every item needs a name.", "warn"); return; }
    update((d) => {
      if (existing) {
        const i = d.structures.findIndex((s) => s.id === existing.id);
        if (i >= 0) d.structures[i] = { ...existing, classId, subjectId, period, items };
        pushAudit(d, currentUser, "structure.update", `${getSubject(db, subjectId)?.name} · ${getClass(db, classId)?.name}`);
      } else {
        d.structures.push({ id: uid(), yearId, classId, subjectId, period, items });
        pushAudit(d, currentUser, "structure.create", `${getSubject(db, subjectId)?.name} · ${getClass(db, classId)?.name}`);
      }
    });
    toast(existing ? "Structure updated." : "Structure created.");
    onClose();
  };

  return (
    <Modal title={existing ? "Edit assessment structure" : "New assessment structure"} kicker="Subject · class · weighted items" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}><Save className="h-4 w-4" /> Save structure</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Class" required>
          <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject" required>
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {db.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Period" required>
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option>Semester 1</option>
            <option>Semester 2</option>
            <option>Annual</option>
          </Select>
        </Field>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Assessment items — weight Σ {fmt1(weightSum)}%</p>
          <Btn size="sm" variant="soft" onClick={addItem}><Plus className="h-3.5 w-3.5" /> Add item</Btn>
        </div>
        {weightSum !== 100 && <p className="mb-2 text-[11.5px] font-semibold text-rust-600">Weights should add up to 100% (currently {fmt1(weightSum)}%).</p>}
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-mist bg-paper/50 p-2.5">
              <TextInput value={it.name} onChange={(e) => patchItem(it.id, { name: e.target.value })} placeholder="Item name" className="min-w-[160px] flex-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-bold uppercase text-soft">Max</span>
                <input type="number" min={1} value={it.max} onChange={(e) => patchItem(it.id, { max: Math.max(1, Number(e.target.value) || 1) })} className="w-16 rounded-md border border-mist bg-card px-2 py-1.5 text-center font-mono text-[13px]" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-bold uppercase text-soft">Weight %</span>
                <input type="number" min={0} max={100} value={it.weight} onChange={(e) => patchItem(it.id, { weight: Math.max(0, Number(e.target.value) || 0) })} className="w-16 rounded-md border border-mist bg-card px-2 py-1.5 text-center font-mono text-[13px]" />
              </div>
              <button onClick={() => removeItem(it.id)} disabled={items.length <= 1} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================================
   CLASSES, SECTIONS & SUBJECTS
   Admin: full CRUD. Teacher/student/guardian: scoped read-only view of the
   classes they teach / are enrolled in, with subjects & teachers shown.
   ========================================================================= */
export function ClassesPage({ scoped }: { scoped?: boolean } = {}) {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const canManage = !scoped && hasPermission(db, currentUser, "academics.manage");
  const [tab, setTab] = useState<"classes" | "subjects">("classes");
  const [editClass, setEditClass] = useState<SchoolClass | "new" | null>(null);
  const [editSubject, setEditSubject] = useState<Subject | "new" | null>(null);
  const [confirmDeleteClass, setConfirmDeleteClass] = useState<SchoolClass | null>(null);
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState<Subject | null>(null);

  /* -------- scoped (read-only) view for teacher / student / guardian -------- */
  if (scoped) {
    let pairs: { classId: string; sectionId: string; subjectIds: string[] }[] = [];
    if (role === "teacher") pairs = teacherPairs(db, currentUser);
    else if (role === "student") {
      const s = studentOf(db, currentUser);
      if (s?.enrollment) pairs = [{ classId: s.enrollment.classId, sectionId: s.enrollment.sectionId, subjectIds: db.assignments.filter((a) => a.classId === s.enrollment!.classId && a.sectionId === s.enrollment!.sectionId).map((a) => a.subjectId) }];
    } else if (role === "guardian") {
      pairs = childrenOf(db, currentUser).filter((c) => c.enrollment).map((c) => ({
        classId: c.enrollment!.classId, sectionId: c.enrollment!.sectionId,
        subjectIds: db.assignments.filter((a) => a.classId === c.enrollment!.classId && a.sectionId === c.enrollment!.sectionId).map((a) => a.subjectId),
      }));
    }

    return (
      <div className="mx-auto max-w-5xl">
        <PageHead kicker="Academics" title="My classes" sub="Subjects and the teacher for each, in your current placement." />
        {pairs.length === 0 ? (
          <Panel className="anim-rise"><EmptyState icon={<Layers className="h-5 w-5" />} title="No classes yet" body="Once enrollment or an assignment is set up, it will appear here." /></Panel>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {pairs.map((p, idx) => (
              <Panel key={idx} className="anim-rise p-4">
                <p className="font-display text-[15px] font-bold text-ink">{sectionLabel(db, p.classId, p.sectionId)}</p>
                <div className="mt-3 space-y-1.5">
                  {[...new Set(p.subjectIds)].map((sid) => {
                    const subj = getSubject(db, sid);
                    const t = teacherFor(db, db.years.find((y) => y.active)?.id ?? "", p.classId, p.sectionId, sid);
                    return (
                      <div key={sid} className="flex items-center justify-between rounded-md bg-paper px-2.5 py-1.5">
                        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                          <span className="h-2 w-2 rounded-full" style={{ background: subj?.color }} /> {subj?.name}
                        </span>
                        <span className="text-[11.5px] text-soft">{t?.name ?? "Unassigned"}</span>
                      </div>
                    );
                  })}
                  {p.subjectIds.length === 0 && <p className="text-[12px] text-soft">No subjects assigned yet.</p>}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* -------- admin: manage -------- */
  if (!hasPermission(db, currentUser, "academics.view")) {
    return <AccessDenied required="academics.view" reason="You don't have permission to view academic structure." />;
  }

  const classInUse = (c: SchoolClass) => db.students.some((s) => s.enrollment?.classId === c.id) || db.assignments.some((a) => a.classId === c.id) || db.timetable.some((t) => t.classId === c.id);
  const subjectInUse = (s: Subject) => db.assignments.some((a) => a.subjectId === s.id) || db.structures.some((st) => st.subjectId === s.id) || db.timetable.some((t) => t.subjectId === s.id);

  const removeClass = (c: SchoolClass) => {
    if (classInUse(c)) { toast("This class has students, assignments or timetable entries — remove those first.", "warn"); return; }
    update((d) => { d.classes = d.classes.filter((x) => x.id !== c.id); pushAudit(d, currentUser, "class.delete", c.name); });
    toast("Class deleted.");
    setConfirmDeleteClass(null);
  };
  const removeSubject = (s: Subject) => {
    if (subjectInUse(s)) { toast("This subject is used in assignments, structures or the timetable — remove those first.", "warn"); return; }
    update((d) => { d.subjects = d.subjects.filter((x) => x.id !== s.id); pushAudit(d, currentUser, "subject.delete", s.name); });
    toast("Subject deleted.");
    setConfirmDeleteSubject(null);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Academics" title="Classes & sections" sub="The structure everything else (timetable, assignments, enrollment) is built on.">
        {canManage && tab === "classes" && <Btn variant="gold" onClick={() => setEditClass("new")}><Plus className="h-4 w-4" /> New class</Btn>}
        {canManage && tab === "subjects" && <Btn variant="gold" onClick={() => setEditSubject("new")}><Plus className="h-4 w-4" /> New subject</Btn>}
      </PageHead>

      <div className="mb-4"><Tabs tabs={[{ id: "classes", label: "Classes & sections", icon: <Layers className="h-3.5 w-3.5" /> }, { id: "subjects", label: "Subjects", icon: <BookOpen className="h-3.5 w-3.5" /> }]} active={tab} onChange={(id) => setTab(id as any)} /></div>

      {tab === "classes" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {db.classes.map((c) => (
            <Panel key={c.id} className="anim-rise p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-[16px] font-bold text-ink">{c.name}</p>
                  <p className="text-[11px] text-soft">Level {c.level} · {c.sections.length} section{c.sections.length !== 1 ? "s" : ""}</p>
                </div>
                {canManage && (
                  <span className="flex gap-1">
                    <button onClick={() => setEditClass(c)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setConfirmDeleteClass(c)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.sections.map((s) => (
                  <Chip key={s.id} tone="pine">Section {s.name} · {studentsOf(db, c.id, s.id).length} students</Chip>
                ))}
                {c.sections.length === 0 && <p className="text-[12px] text-soft">No sections yet.</p>}
              </div>
            </Panel>
          ))}
          {db.classes.length === 0 && <Panel className="anim-rise sm:col-span-2"><EmptyState icon={<Layers className="h-5 w-5" />} title="No classes yet" body="Create the first class to start building the academic structure." action={canManage ? <Btn onClick={() => setEditClass("new")}><Plus className="h-4 w-4" /> New class</Btn> : undefined} /></Panel>}
        </div>
      )}

      {tab === "subjects" && (
        <Panel className="anim-rise overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-mist bg-paper/60">
              <tr><th className={thCls()}>Subject</th><th className={thCls()}>Code</th><th className={thCls()}>In use</th><th className={thCls()}></th></tr>
            </thead>
            <tbody className="divide-y divide-mist/70">
              {db.subjects.map((s) => (
                <tr key={s.id} className="transition-colors hover:bg-pine-50/50">
                  <td className={tdCls()}><span className="flex items-center gap-2 font-bold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /> {s.name}</span></td>
                  <td className={tdCls()}><Chip tone="gray">{s.code}</Chip></td>
                  <td className={tdCls()}>{subjectInUse(s) ? <Chip tone="pine">Yes</Chip> : <Chip tone="gray">No</Chip>}</td>
                  <td className={`${tdCls()} text-right`}>
                    {canManage && (
                      <span className="inline-flex gap-1">
                        <button onClick={() => setEditSubject(s)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setConfirmDeleteSubject(s)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {db.subjects.length === 0 && <tr><td colSpan={4}><EmptyState icon={<BookOpen className="h-5 w-5" />} title="No subjects yet" body="Add the subjects your school teaches." /></td></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      {editClass && <ClassModal existing={editClass === "new" ? undefined : editClass} onClose={() => setEditClass(null)} />}
      {editSubject && <SubjectModal existing={editSubject === "new" ? undefined : editSubject} onClose={() => setEditSubject(null)} />}

      {confirmDeleteClass && (
        <Modal title={`Delete ${confirmDeleteClass.name}?`} onClose={() => setConfirmDeleteClass(null)}
          footer={<><Btn variant="ghost" onClick={() => setConfirmDeleteClass(null)}>Cancel</Btn><Btn variant="danger" onClick={() => removeClass(confirmDeleteClass)}><Trash2 className="h-4 w-4" /> Delete</Btn></>}>
          <p className="text-[13px] text-ink">This can't be undone. It only succeeds if no students, assignments or timetable entries reference this class.</p>
        </Modal>
      )}
      {confirmDeleteSubject && (
        <Modal title={`Delete ${confirmDeleteSubject.name}?`} onClose={() => setConfirmDeleteSubject(null)}
          footer={<><Btn variant="ghost" onClick={() => setConfirmDeleteSubject(null)}>Cancel</Btn><Btn variant="danger" onClick={() => removeSubject(confirmDeleteSubject)}><Trash2 className="h-4 w-4" /> Delete</Btn></>}>
          <p className="text-[13px] text-ink">This can't be undone. It only succeeds if no assignments, structures or timetable entries reference this subject.</p>
        </Modal>
      )}
    </div>
  );
}

function ClassModal({ existing, onClose }: { existing?: SchoolClass; onClose: () => void }) {
  const { update, toast, currentUser } = useApp();
  const [name, setName] = useState(existing?.name ?? "");
  const [level, setLevel] = useState(existing?.level ?? 1);
  const [sections, setSections] = useState<Section[]>(existing?.sections.map((s) => ({ ...s })) ?? [{ id: uid(), name: "A" }]);

  const addSection = () => setSections((p) => [...p, { id: uid(), name: String.fromCharCode(65 + p.length) }]);
  const removeSection = (id: string) => setSections((p) => (p.length > 1 ? p.filter((s) => s.id !== id) : p));
  const renameSection = (id: string, name: string) => setSections((p) => p.map((s) => (s.id === id ? { ...s, name } : s)));

  const save = () => {
    if (!name.trim()) { toast("Give the class a name.", "warn"); return; }
    if (sections.some((s) => !s.name.trim())) { toast("Every section needs a name.", "warn"); return; }
    update((d) => {
      if (existing) {
        const i = d.classes.findIndex((c) => c.id === existing.id);
        if (i >= 0) d.classes[i] = { ...existing, name: name.trim(), level: Number(level), sections };
        pushAudit(d, currentUser, "class.update", name.trim());
      } else {
        d.classes.push({ id: uid(), name: name.trim(), level: Number(level), sections });
        pushAudit(d, currentUser, "class.create", name.trim());
      }
    });
    toast(existing ? "Class updated." : "Class created.");
    onClose();
  };

  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New class"} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}><Save className="h-4 w-4" /> Save</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grade 9" /></Field>
        <Field label="Level" required><input type="number" min={1} value={level} onChange={(e) => setLevel(Number(e.target.value) || 1)} className="w-full rounded-lg border border-mist bg-card px-3 py-2 text-[13.5px]" /></Field>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Sections</p>
          <Btn size="sm" variant="soft" onClick={addSection}><Plus className="h-3.5 w-3.5" /> Add section</Btn>
        </div>
        <div className="space-y-2">
          {sections.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <TextInput value={s.name} onChange={(e) => renameSection(s.id, e.target.value)} className="max-w-[160px]" />
              <button onClick={() => removeSection(s.id)} disabled={sections.length <= 1} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function SubjectModal({ existing, onClose }: { existing?: Subject; onClose: () => void }) {
  const { update, toast, currentUser } = useApp();
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [color, setColor] = useState(existing?.color ?? "#2c654c");

  const save = () => {
    if (!name.trim() || !code.trim()) { toast("Name and code are both required.", "warn"); return; }
    update((d) => {
      if (existing) {
        const i = d.subjects.findIndex((s) => s.id === existing.id);
        if (i >= 0) d.subjects[i] = { ...existing, name: name.trim(), code: code.trim().toUpperCase(), color };
        pushAudit(d, currentUser, "subject.update", name.trim());
      } else {
        d.subjects.push({ id: uid(), name: name.trim(), code: code.trim().toUpperCase(), color });
        pushAudit(d, currentUser, "subject.create", name.trim());
      }
    });
    toast(existing ? "Subject updated." : "Subject created.");
    onClose();
  };

  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New subject"} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}><Save className="h-4 w-4" /> Save</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chemistry" /></Field>
        <Field label="Code" required><TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CHEM" /></Field>
      </div>
      <Field label="Colour" className="mt-3">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded border border-mist bg-card" />
      </Field>
    </Modal>
  );
}

/* =========================================================================
   TIMETABLE (admin builder)
   ========================================================================= */
export function TimetablePage() {
  const { db, currentUser } = useApp();
  if (!hasPermission(db, currentUser, "academics.view")) {
    return <AccessDenied required="academics.view" reason="You don't have permission to view the timetable." />;
  }
  const canManage = hasPermission(db, currentUser, "academics.manage");
  const [classId, setClassId] = useState(db.classes[0]?.id ?? "");
  const cls = getClass(db, classId);
  const [sectionId, setSectionId] = useState(cls?.sections[0]?.id ?? "");
  useEffect(() => {
    const c = getClass(db, classId);
    if (c && !c.sections.some((s) => s.id === sectionId)) setSectionId(c.sections[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);
  const [editCell, setEditCell] = useState<{ day: number; period: number } | null>(null);

  const entryFor = (day: number, period: number) => db.timetable.find((t) => t.classId === classId && t.sectionId === sectionId && t.day === day && t.period === period);

  const availableSubjects = [...new Set(db.assignments.filter((a) => a.classId === classId && a.sectionId === sectionId).map((a) => a.subjectId))];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead kicker="Academics" title="Timetable" sub="One grid per class & section — Monday to Friday, six periods a day.">
        <Field label="Class" className="w-36"><Select value={classId} onChange={(e) => setClassId(e.target.value)}>{db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Section" className="w-28"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{cls?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      </PageHead>

      {availableSubjects.length === 0 && canManage && (
        <p className="anim-rise mb-3 rounded-lg border border-gold-200 bg-gold-100/60 px-3 py-2 text-[12px] font-semibold text-gold-700">No teacher–subject assignments exist for this class/section yet — set those up first so periods can be assigned.</p>
      )}

      <Panel className="anim-rise overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-mist bg-paper/60">
            <tr>
              <th className={`${thCls()} w-20`}>Period</th>
              {DAYS.map((d) => <th key={d} className={thCls()}>{d}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-mist/70">
            {PERIODS.map((p) => (
              <tr key={p}>
                <td className={`${tdCls()} font-mono text-[12px] font-bold text-soft`}>P{p}</td>
                {DAYS.map((_, day) => {
                  const e = entryFor(day, p);
                  const subj = e ? getSubject(db, e.subjectId) : null;
                  const teacher = e ? teacherFor(db, db.years.find((y) => y.active)?.id ?? "", classId, sectionId, e.subjectId) : null;
                  return (
                    <td key={day} className={tdCls()}>
                      <button
                        disabled={!canManage}
                        onClick={() => setEditCell({ day, period: p })}
                        className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-all ${e ? "border-pine-200 bg-pine-50 hover:border-pine-400" : "border-dashed border-mist bg-paper/50 hover:border-pine-300"} disabled:cursor-not-allowed`}
                      >
                        {subj ? (
                          <>
                            <span className="flex items-center gap-1.5 text-[12px] font-bold text-ink"><span className="h-1.5 w-1.5 rounded-full" style={{ background: subj.color }} /> {subj.name}</span>
                            <span className="block text-[10.5px] text-soft">{teacher?.name ?? "Unassigned"} · {e!.room}</span>
                          </>
                        ) : (
                          <span className="text-[11.5px] text-soft/60">{canManage ? "+ Assign" : "Free period"}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {editCell && (
        <TimetableCellModal
          day={editCell.day} period={editCell.period} classId={classId} sectionId={sectionId}
          existing={entryFor(editCell.day, editCell.period)}
          availableSubjects={availableSubjects}
          onClose={() => setEditCell(null)}
        />
      )}
    </div>
  );
}

function TimetableCellModal({ day, period, classId, sectionId, existing, availableSubjects, onClose }: {
  day: number; period: number; classId: string; sectionId: string; existing?: TimetableEntry; availableSubjects: string[]; onClose: () => void;
}) {
  const { db, update, toast, currentUser } = useApp();
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? availableSubjects[0] ?? "");
  const [room, setRoom] = useState(existing?.room ?? "");

  const save = () => {
    if (!subjectId) { toast("Choose a subject.", "warn"); return; }
    update((d) => {
      const i = d.timetable.findIndex((t) => t.classId === classId && t.sectionId === sectionId && t.day === day && t.period === period);
      if (i >= 0) d.timetable[i] = { ...d.timetable[i], subjectId, room: room.trim() };
      else d.timetable.push({ id: uid(), classId, sectionId, day, period, subjectId, room: room.trim() });
      pushAudit(d, currentUser, "timetable.update", `${DAYS[day]} P${period} · ${getClass(db, classId)?.name}`);
    });
    toast("Timetable updated.");
    onClose();
  };
  const clear = () => {
    update((d) => { d.timetable = d.timetable.filter((t) => !(t.classId === classId && t.sectionId === sectionId && t.day === day && t.period === period)); });
    toast("Period cleared.");
    onClose();
  };

  return (
    <Modal title={`${DAYS[day]} · Period ${period}`} kicker={sectionLabel(db, classId, sectionId)} onClose={onClose}
      footer={<>
        {existing && <Btn variant="dangerSoft" onClick={clear}><Trash2 className="h-4 w-4" /> Clear</Btn>}
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save}><Save className="h-4 w-4" /> Save</Btn>
      </>}>
      <Field label="Subject" required>
        <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {availableSubjects.length === 0 && <option value="">No assignments for this class/section</option>}
          {availableSubjects.map((sid) => <option key={sid} value={sid}>{getSubject(db, sid)?.name}</option>)}
        </Select>
      </Field>
      <Field label="Room" className="mt-3"><TextInput value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. R-201" /></Field>
    </Modal>
  );
}

/* =========================================================================
   ATTENDANCE
   Teacher/admin: mark a daily register. Student/guardian: view stats & history.
   ========================================================================= */
export function AttendancePage() {
  const { db, currentUser, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";

  if (role === "student" || role === "guardian") {
    return <AttendanceViewer />;
  }

  const canManage = hasPermission(db, currentUser, "attendance.manage");
  const isAdmin = role === "admin";
  const pairs = teacherPairs(db, currentUser);
  const classIds = isAdmin ? db.classes.map((c) => c.id) : [...new Set(pairs.map((p) => p.classId))];

  const [classId, setClassId] = useState(classIds[0] ?? "");
  const cls = getClass(db, classId);
  const sectionOptionsForClass = isAdmin
    ? (cls?.sections ?? [])
    : (cls?.sections ?? []).filter((s) => pairs.some((p) => p.classId === classId && p.sectionId === s.id));
  const [sectionId, setSectionId] = useState(sectionOptionsForClass[0]?.id ?? "");
  useEffect(() => {
    const opts = isAdmin ? (getClass(db, classId)?.sections ?? []) : (getClass(db, classId)?.sections ?? []).filter((s) => pairs.some((p) => p.classId === classId && p.sectionId === s.id));
    if (!opts.some((s) => s.id === sectionId)) setSectionId(opts[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);
  const [date, setDate] = useState(todayISO());

  const roster = studentsOf(db, classId, sectionId);
  const register = db.attendance.find((r) => r.date === date && r.classId === classId && r.sectionId === sectionId);

  const setMark = (studentId: string, status: AttendanceStatus) => {
    if (!canManage) return;
    update((d) => {
      let r = d.attendance.find((x) => x.date === date && x.classId === classId && x.sectionId === sectionId);
      if (!r) { r = { date, classId, sectionId, marks: {} }; d.attendance.push(r); }
      r.marks[studentId] = status;
    });
  };
  const markAllPresent = () => {
    if (!canManage) return;
    update((d) => {
      let r = d.attendance.find((x) => x.date === date && x.classId === classId && x.sectionId === sectionId);
      if (!r) { r = { date, classId, sectionId, marks: {} }; d.attendance.push(r); }
      roster.forEach((s) => { if (!r!.marks[s.id]) r!.marks[s.id] = "present"; });
    });
    toast("Unmarked students set to present.");
  };

  const counts = { present: 0, absent: 0, late: 0, unmarked: 0 };
  roster.forEach((s) => {
    const m = register?.marks[s.id];
    if (m === "present") counts.present++;
    else if (m === "absent") counts.absent++;
    else if (m === "late") counts.late++;
    else counts.unmarked++;
  });

  if (classIds.length === 0) {
    return <AccessDenied required="attendance.manage / a teaching assignment" reason="You aren't assigned to any class-section yet." />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Attendance" title="Daily register" sub="Mark present, absent or late for each student. Unmarked students count as not yet recorded.">
        <Field label="Class" className="w-36"><Select value={classId} onChange={(e) => setClassId(e.target.value)}>{classIds.map((id) => <option key={id} value={id}>{getClass(db, id)?.name}</option>)}</Select></Field>
        <Field label="Section" className="w-28"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{sectionOptionsForClass.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Date" className="w-40"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} /></Field>
      </PageHead>

      <div className="anim-rise mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Present" value={counts.present} tone="pine" icon={<UserCheck className="h-4.5 w-4.5" />} />
        <Stat label="Absent" value={counts.absent} tone="rust" icon={<UserX className="h-4.5 w-4.5" />} />
        <Stat label="Late" value={counts.late} tone="gold" icon={<ClockIcon className="h-4.5 w-4.5" />} />
        <Stat label="Unmarked" value={counts.unmarked} tone="steel" icon={<CalendarCheck2 className="h-4.5 w-4.5" />} />
      </div>

      <Panel className="anim-rise overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist bg-paper/60 px-4 py-3">
          <p className="text-[12.5px] font-bold text-ink">{sectionLabel(db, classId, sectionId)} · {fmtDate(date)}</p>
          {canManage && <Btn size="sm" variant="soft" onClick={markAllPresent}><CheckCircle2 className="h-3.5 w-3.5" /> Mark rest present</Btn>}
        </div>
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={`${thCls()} w-10`}>#</th><th className={thCls()}>Student</th><th className={`${thCls()} text-center`}>Status</th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {roster.map((s, i) => {
              const m = register?.marks[s.id];
              return (
                <tr key={s.id} className="transition-colors hover:bg-pine-50/40">
                  <td className={`${tdCls()} tnum text-soft`}>{i + 1}</td>
                  <td className={tdCls()}><span className="flex items-center gap-2.5"><Avatar student={s} size={30} /><span className="font-bold text-ink">{shortName(s)}</span></span></td>
                  <td className={`${tdCls()} text-center`}>
                    <span className="inline-flex gap-1">
                      {(["present", "late", "absent"] as AttendanceStatus[]).map((st) => (
                        <button key={st} disabled={!canManage} onClick={() => setMark(s.id, st)}
                          className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] font-bold capitalize transition-all disabled:cursor-not-allowed ${m === st ? (st === "present" ? "border-pine-700 bg-pine-700 text-white" : st === "late" ? "border-gold-500 bg-gold-500 text-white" : "border-rust-600 bg-rust-600 text-white") : "border-mist bg-card text-soft hover:border-pine-300"}`}>
                          {st}
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
            {roster.length === 0 && <tr><td colSpan={3}><EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No students in this section" body="Enroll students into this class/section first." /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/** Read-only attendance view for students (own record) and guardians (per child). */
function AttendanceViewer() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  const kids = role === "guardian" ? childrenOf(db, currentUser) : (studentOf(db, currentUser) ? [studentOf(db, currentUser)!] : []);
  const [selId, setSelId] = useState(kids[0]?.id ?? "");
  const student = kids.find((k) => k.id === selId) ?? kids[0];

  if (!student) return <AccessDenied required="students.view_self / students.view_children" reason="No linked student record was found." />;

  const stats = attendanceStats(db, student.id);
  const history = db.attendance
    .filter((r) => student.enrollment && r.classId === student.enrollment.classId && r.sectionId === student.enrollment.sectionId && r.marks[student.id])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Attendance" title={role === "guardian" ? "Attendance" : "My attendance"} sub="Present, late and absent counts across the academic year.">
        {role === "guardian" && kids.length > 1 && (
          <Field label="Child" className="w-48"><Select value={selId} onChange={(e) => setSelId(e.target.value)}>{kids.map((k) => <option key={k.id} value={k.id}>{shortName(k)}</option>)}</Select></Field>
        )}
      </PageHead>

      <div className="anim-rise mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Present" value={stats.present} tone="pine" icon={<UserCheck className="h-4.5 w-4.5" />} />
        <Stat label="Late" value={stats.late} tone="gold" icon={<ClockIcon className="h-4.5 w-4.5" />} />
        <Stat label="Absent" value={stats.absent} tone="rust" icon={<UserX className="h-4.5 w-4.5" />} />
        <Stat label="Attendance rate" value={`${stats.pct}%`} tone="steel" icon={<CalendarCheck2 className="h-4.5 w-4.5" />} />
      </div>

      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Date</th><th className={`${thCls()} text-center`}>Status</th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {history.map((r) => (
              <tr key={r.date}><td className={tdCls()}>{fmtDate(r.date)}</td><td className={`${tdCls()} text-center`}><Chip tone={r.marks[student.id] === "present" ? "pine" : r.marks[student.id] === "late" ? "gold" : "rust"}>{r.marks[student.id]}</Chip></td></tr>
            ))}
            {history.length === 0 && <tr><td colSpan={2}><EmptyState icon={<CalendarCheck2 className="h-5 w-5" />} title="No attendance recorded yet" body="Records will appear here once the register is taken." /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* =========================================================================
   TEACHER–SUBJECT ASSIGNMENTS
   Admin: full CRUD. Teacher/student/guardian: read-only, scoped to them.
   ========================================================================= */
export function AssignmentsPage() {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";

  if (role !== "admin") {
    let rows: { classId: string; sectionId: string; subjectId: string; teacherId: string }[] = [];
    if (role === "teacher") {
      for (const p of teacherPairs(db, currentUser)) for (const sid of p.subjectIds) rows.push({ classId: p.classId, sectionId: p.sectionId, subjectId: sid, teacherId: currentUser!.teacherId! });
    } else if (role === "student") {
      const s = studentOf(db, currentUser);
      if (s?.enrollment) rows = db.assignments.filter((a) => a.classId === s.enrollment!.classId && a.sectionId === s.enrollment!.sectionId).map((a) => ({ classId: a.classId, sectionId: a.sectionId, subjectId: a.subjectId, teacherId: a.teacherId }));
    } else if (role === "guardian") {
      for (const c of childrenOf(db, currentUser)) {
        if (!c.enrollment) continue;
        for (const a of db.assignments.filter((a) => a.classId === c.enrollment!.classId && a.sectionId === c.enrollment!.sectionId)) rows.push({ classId: a.classId, sectionId: a.sectionId, subjectId: a.subjectId, teacherId: a.teacherId });
      }
    }
    return (
      <div className="mx-auto max-w-4xl">
        <PageHead kicker="Academics" title="Assignments" sub="Which teacher covers which subject for each class." />
        <Panel className="anim-rise overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Class</th><th className={thCls()}>Subject</th><th className={thCls()}>Teacher</th></tr></thead>
            <tbody className="divide-y divide-mist/70">
              {rows.map((r, i) => (
                <tr key={i}><td className={tdCls()}>{sectionShort(db, r.classId, r.sectionId)}</td><td className={tdCls()}>{getSubject(db, r.subjectId)?.name}</td><td className={tdCls()}>{getTeacher(db, r.teacherId)?.name}</td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3}><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="Nothing assigned yet" body="Assignments will appear once the office sets them up." /></td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>
    );
  }

  if (!hasPermission(db, currentUser, "academics.manage")) {
    return <AccessDenied required="academics.manage" reason="You don't have permission to manage teacher assignments." />;
  }

  const [edit, setEdit] = useState<Assignment | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Assignment | null>(null);
  const [filterClass, setFilterClass] = useState("");

  const rows = db.assignments.filter((a) => a.yearId === yearId && (!filterClass || a.classId === filterClass));

  const remove = (a: Assignment) => {
    update((d) => { d.assignments = d.assignments.filter((x) => x.id !== a.id); pushAudit(d, currentUser, "assignment.delete", `${getSubject(db, a.subjectId)?.name} · ${sectionShort(db, a.classId, a.sectionId)}`); });
    toast("Assignment removed.");
    setConfirmDelete(null);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Academics" title="Teacher assignments" sub="The source of truth for who teaches what, where — drives access for teachers everywhere in the system.">
        <Field label="Class" className="w-40"><Select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}><option value="">All classes</option>{db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Btn variant="gold" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> New assignment</Btn>
      </PageHead>

      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Class · Section</th><th className={thCls()}>Subject</th><th className={thCls()}>Teacher</th><th className={thCls()}></th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {rows.map((a) => (
              <tr key={a.id} className="transition-colors hover:bg-pine-50/50">
                <td className={tdCls()}>{sectionShort(db, a.classId, a.sectionId)}</td>
                <td className={tdCls()}><span className="flex items-center gap-1.5"><Tag className="h-3 w-3 text-soft" /> {getSubject(db, a.subjectId)?.name}</span></td>
                <td className={tdCls()}>{getTeacher(db, a.teacherId)?.name}</td>
                <td className={`${tdCls()} text-right`}>
                  <span className="inline-flex gap-1">
                    <button onClick={() => setEdit(a)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-pine-100 hover:text-pine-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => setConfirmDelete(a)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4}><EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No assignments yet" body="Assign a teacher to a subject for a class & section." action={<Btn onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> New assignment</Btn>} /></td></tr>}
          </tbody>
        </table>
      </Panel>

      {edit && <AssignmentModal existing={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {confirmDelete && (
        <Modal title="Remove this assignment?" onClose={() => setConfirmDelete(null)}
          footer={<><Btn variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Btn><Btn variant="danger" onClick={() => remove(confirmDelete)}><Trash2 className="h-4 w-4" /> Remove</Btn></>}>
          <p className="text-[13px] text-ink">The teacher will immediately lose access to students in this class/section for this subject.</p>
        </Modal>
      )}
    </div>
  );
}

function AssignmentModal({ existing, onClose }: { existing?: Assignment; onClose: () => void }) {
  const { db, yearId, update, toast, currentUser } = useApp();
  const [classId, setClassId] = useState(existing?.classId ?? db.classes[0]?.id ?? "");
  const cls = getClass(db, classId);
  const [sectionId, setSectionId] = useState(existing?.sectionId ?? cls?.sections[0]?.id ?? "");
  useEffect(() => {
    const c = getClass(db, classId);
    if (c && !c.sections.some((s) => s.id === sectionId)) setSectionId(c.sections[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? db.subjects[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(existing?.teacherId ?? db.teachers[0]?.id ?? "");

  const save = () => {
    const dup = db.assignments.find((a) => a.id !== existing?.id && a.yearId === yearId && a.classId === classId && a.sectionId === sectionId && a.subjectId === subjectId);
    if (dup) { toast("This class/section already has a teacher for that subject — edit the existing assignment instead.", "warn"); return; }
    update((d) => {
      if (existing) {
        const i = d.assignments.findIndex((a) => a.id === existing.id);
        if (i >= 0) d.assignments[i] = { ...existing, classId, sectionId, subjectId, teacherId };
        pushAudit(d, currentUser, "assignment.update", `${getSubject(db, subjectId)?.name} · ${sectionShort(db, classId, sectionId)}`);
      } else {
        d.assignments.push({ id: uid(), yearId, classId, sectionId, subjectId, teacherId });
        pushAudit(d, currentUser, "assignment.create", `${getSubject(db, subjectId)?.name} · ${sectionShort(db, classId, sectionId)}`);
      }
    });
    toast(existing ? "Assignment updated." : "Assignment created.");
    onClose();
  };

  return (
    <Modal title={existing ? "Edit assignment" : "New assignment"} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}><Save className="h-4 w-4" /> Save</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class" required><Select value={classId} onChange={(e) => setClassId(e.target.value)}>{db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Section" required><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{cls?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Subject" required><Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>{db.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Teacher" required><Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>{db.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

/* =========================================================================
   RESULTS / REPORT CARDS (role-aware viewer)
   ========================================================================= */
export function ReportsPage() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role ?? "admin";

  if (role === "student" || role === "guardian") {
    return <ReportCardViewer />;
  }

  if (!hasPermission(db, currentUser, "results.view")) {
    return <AccessDenied required="results.view" reason="You don't have permission to view results." />;
  }

  const [classId, setClassId] = useState(db.classes[0]?.id ?? "");
  const cls = getClass(db, classId);
  const [sectionId, setSectionId] = useState("");
  const [q, setQ] = useState("");
  const [openStudent, setOpenStudent] = useState<Student | null>(null);

  const roster = studentsOf(db, classId, sectionId || undefined).filter((s) => !q || fullName(s).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Results" title="Reports" sub="Class averages across every published assessment structure.">
        <Field label="Class" className="w-36"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); }}>{db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Section" className="w-32"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}><option value="">All</option>{cls?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Search" className="w-48"><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student name…" /></Field>
      </PageHead>

      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={`${thCls()} w-10`}>#</th><th className={thCls()}>Student</th><th className={thCls()}>Section</th><th className={`${thCls()} text-center`}>Average</th><th className={thCls()}></th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {roster.map((s, i) => {
              const avg = studentAverage(db, s);
              return (
                <tr key={s.id} className="transition-colors hover:bg-pine-50/50">
                  <td className={`${tdCls()} tnum text-soft`}>{i + 1}</td>
                  <td className={tdCls()}><span className="flex items-center gap-2.5"><Avatar student={s} size={30} /><span className="font-bold text-ink">{shortName(s)}</span></span></td>
                  <td className={tdCls()}>{s.enrollment ? sectionShort(db, s.enrollment.classId, s.enrollment.sectionId) : "—"}</td>
                  <td className={`${tdCls()} text-center font-mono font-bold`}>{avg != null ? `${avg}%` : "—"}</td>
                  <td className={`${tdCls()} text-right`}><Btn size="sm" variant="ghost" onClick={() => setOpenStudent(s)}><Eye className="h-3.5 w-3.5" /> View</Btn></td>
                </tr>
              );
            })}
            {roster.length === 0 && <tr><td colSpan={5}><EmptyState icon={<FileBarChart2 className="h-5 w-5" />} title="No students match" body="Try a different class, section, or search." /></td></tr>}
          </tbody>
        </table>
      </Panel>

      {openStudent && <ReportCardModal student={openStudent} onClose={() => setOpenStudent(null)} adminView />}
    </div>
  );
}

/** Student/guardian: only ever see PUBLISHED results. */
function ReportCardViewer() {
  const { db, currentUser } = useApp();
  const role = currentUser?.role;
  const kids = role === "guardian" ? childrenOf(db, currentUser) : (studentOf(db, currentUser) ? [studentOf(db, currentUser)!] : []);
  const [selId, setSelId] = useState(kids[0]?.id ?? "");
  const student = kids.find((k) => k.id === selId) ?? kids[0];
  if (!student) return <AccessDenied required="results.view_self / results.view_children" reason="No linked student record was found." />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead kicker="Results" title={role === "guardian" ? "Grades" : "My grades"} sub="Only published results are shown here.">
        {role === "guardian" && kids.length > 1 && (
          <Field label="Child" className="w-48"><Select value={selId} onChange={(e) => setSelId(e.target.value)}>{kids.map((k) => <option key={k.id} value={k.id}>{shortName(k)}</option>)}</Select></Field>
        )}
      </PageHead>
      <ReportCardBody student={student} publishedOnly />
    </div>
  );
}

function ReportCardModal({ student, onClose, adminView }: { student: Student; onClose: () => void; adminView?: boolean }) {
  return (
    <Modal title={fullName(student)} kicker="Report card" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Btn></>}>
      <ReportCardBody student={student} publishedOnly={!adminView} />
    </Modal>
  );
}

function ReportCardBody({ student, publishedOnly }: { student: Student; publishedOnly?: boolean }) {
  const { db } = useApp();
  const all = studentResults(db, student);
  const results = publishedOnly ? all.filter((r) => submissionStatus(db, r.st.id) === "published") : all;
  const completeOnes = results.filter((r) => r.calc.complete);
  const avg = completeOnes.length ? +(completeOnes.reduce((s, r) => s + r.calc.pct, 0) / completeOnes.length).toFixed(1) : null;

  return (
    <div className="anim-rise">
      <div className="mb-3 flex items-center gap-3 rounded-lg border border-mist bg-paper/50 p-3">
        <Avatar student={student} size={40} />
        <div>
          <p className="font-display font-bold text-ink">{fullName(student)}</p>
          <p className="text-[11.5px] text-soft">{student.enrollment ? sectionShort(db, student.enrollment.classId, student.enrollment.sectionId) : "—"} · Reg. {student.regId}</p>
        </div>
        {avg != null && <span className="ml-auto text-right"><span className="block font-mono text-[20px] font-extrabold text-pine-800">{avg}%</span><span className="block text-[10.5px] font-semibold text-soft">overall average</span></span>}
      </div>

      <Panel className="overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Subject</th><th className={thCls()}>Period</th><th className={`${thCls()} text-center`}>Total</th><th className={`${thCls()} text-center`}>%</th><th className={`${thCls()} text-center`}>Grade</th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {results.map((r, i) => {
              const grade = r.calc.complete ? gradeFor(r.calc.pct, db.grading) : null;
              return (
                <tr key={i}>
                  <td className={tdCls()}><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: r.subject?.color }} /> {r.subject?.name}</span></td>
                  <td className={tdCls()}>{r.st.period}</td>
                  <td className={`${tdCls()} text-center font-mono font-bold`}>{r.calc.complete ? fmt1(r.calc.total) : "—"}</td>
                  <td className={`${tdCls()} text-center font-mono`}>{r.calc.complete ? `${fmt1(r.calc.pct)}%` : "—"}</td>
                  <td className={`${tdCls()} text-center`}>{grade ? <Chip tone={r.calc.pct >= 80 ? "pine" : r.calc.pct >= 50 ? "gold" : "rust"}>{grade.grade}</Chip> : <Chip tone="gray">pending</Chip>}</td>
                </tr>
              );
            })}
            {results.length === 0 && <tr><td colSpan={5}><EmptyState icon={<FileBarChart2 className="h-5 w-5" />} title="No published results yet" body="Results appear here once the office publishes them." /></td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* =========================================================================
   FEES (admin ledger + simple receipts)
   ========================================================================= */
export function FeesPage() {
  const { db, currentUser } = useApp();
  if (!hasPermission(db, currentUser, "fees.view")) {
    return <AccessDenied required="fees.view" reason="You don't have permission to view fee records." />;
  }
  const canManage = hasPermission(db, currentUser, "fees.manage");

  const [classId, setClassId] = useState("");
  const cls = getClass(db, classId);
  const [sectionId, setSectionId] = useState("");
  const [q, setQ] = useState("");
  const [openStudent, setOpenStudent] = useState<Student | null>(null);

  const roster = db.students.filter((s) => {
    if (classId && s.enrollment?.classId !== classId) return false;
    if (sectionId && s.enrollment?.sectionId !== sectionId) return false;
    if (q && !fullName(s).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const totals = roster.reduce((acc, s) => {
    const f = feeStats(db, s.id);
    acc.billed += f.billed; acc.paid += f.paid; acc.outstanding += f.outstanding;
    return acc;
  }, { billed: 0, paid: 0, outstanding: 0 });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHead kicker="Finance" title="Fees" sub="Per-student ledgers — billed, paid and outstanding.">
        <Field label="Class" className="w-36"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(""); }}><option value="">All</option>{db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Section" className="w-28"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}><option value="">All</option>{cls?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Search" className="w-44"><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student name…" /></Field>
      </PageHead>

      <div className="anim-rise mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Billed" value={`Br ${totals.billed.toLocaleString()}`} tone="steel" icon={<Banknote className="h-4.5 w-4.5" />} />
        <Stat label="Collected" value={`Br ${totals.paid.toLocaleString()}`} tone="pine" icon={<Wallet className="h-4.5 w-4.5" />} />
        <Stat label="Outstanding" value={`Br ${totals.outstanding.toLocaleString()}`} tone="rust" icon={<Receipt className="h-4.5 w-4.5" />} />
      </div>

      <Panel className="anim-rise overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-mist bg-paper/60"><tr><th className={thCls()}>Student</th><th className={thCls()}>Section</th><th className={`${thCls()} text-center`}>Billed</th><th className={`${thCls()} text-center`}>Paid</th><th className={`${thCls()} text-center`}>Outstanding</th><th className={thCls()}></th></tr></thead>
          <tbody className="divide-y divide-mist/70">
            {roster.map((s) => {
              const f = feeStats(db, s.id);
              return (
                <tr key={s.id} className="transition-colors hover:bg-pine-50/50">
                  <td className={tdCls()}><span className="flex items-center gap-2.5"><Avatar student={s} size={30} /><span className="font-bold text-ink">{shortName(s)}</span></span></td>
                  <td className={tdCls()}>{s.enrollment ? sectionShort(db, s.enrollment.classId, s.enrollment.sectionId) : "—"}</td>
                  <td className={`${tdCls()} text-center font-mono`}>{f.billed.toLocaleString()}</td>
                  <td className={`${tdCls()} text-center font-mono text-pine-700`}>{f.paid.toLocaleString()}</td>
                  <td className={`${tdCls()} text-center font-mono ${f.outstanding > 0 ? "font-bold text-rust-600" : "text-soft"}`}>{f.outstanding.toLocaleString()}</td>
                  <td className={`${tdCls()} text-right`}><Btn size="sm" variant="ghost" onClick={() => setOpenStudent(s)}><Eye className="h-3.5 w-3.5" /> Ledger</Btn></td>
                </tr>
              );
            })}
            {roster.length === 0 && <tr><td colSpan={6}><EmptyState icon={<Banknote className="h-5 w-5" />} title="No students match" body="Try a different class, section, or search." /></td></tr>}
          </tbody>
        </table>
      </Panel>

      {openStudent && <FeeLedgerModal student={openStudent} canManage={canManage} onClose={() => setOpenStudent(null)} />}
    </div>
  );
}

function FeeLedgerModal({ student, canManage, onClose }: { student: Student; canManage: boolean; onClose: () => void }) {
  const { db, update, toast, currentUser } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState(0);
  const [due, setDue] = useState(todayISO());
  const [payItem, setPayItem] = useState<FeeItem | null>(null);
  const [payAmount, setPayAmount] = useState(0);

  const items = db.fees.filter((f) => f.studentId === student.id);
  const stats = feeStats(db, student.id);

  const addItem = () => {
    if (!label.trim() || amount <= 0) { toast("Give the fee a label and a positive amount.", "warn"); return; }
    update((d) => { d.fees.push({ id: uid(), studentId: student.id, label: label.trim(), amount, paid: 0, due }); pushAudit(d, currentUser, "fee.create", `${label.trim()} · ${fullName(student)}`); });
    toast("Fee item added.");
    setAddOpen(false); setLabel(""); setAmount(0);
  };
  const removeItem = (f: FeeItem) => {
    update((d) => { d.fees = d.fees.filter((x) => x.id !== f.id); pushAudit(d, currentUser, "fee.delete", `${f.label} · ${fullName(student)}`); });
    toast("Fee item removed.");
  };
  const recordPayment = () => {
    if (!payItem || payAmount <= 0) { toast("Enter a positive payment amount.", "warn"); return; }
    update((d) => {
      const f = d.fees.find((x) => x.id === payItem.id);
      if (f) f.paid = Math.min(f.amount, f.paid + payAmount);
      pushAudit(d, currentUser, "fee.payment", `${payItem.label} · ${fullName(student)}`, `Br ${payAmount}`);
    });
    toast("Payment recorded.");
    setPayItem(null); setPayAmount(0);
  };

  const printReceipt = async (f: FeeItem) => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a5" });
    doc.setFontSize(14); doc.text(db.settings.schoolName || "School", 12, 16);
    doc.setFontSize(10); doc.text("Payment receipt", 12, 23);
    doc.setDrawColor(200); doc.line(12, 27, 138, 27);
    doc.setFontSize(11);
    doc.text(`Student: ${fullName(student)}`, 12, 36);
    doc.text(`Reg. no: ${student.regId}`, 12, 43);
    doc.text(`Item: ${f.label}`, 12, 50);
    doc.text(`Billed: Br ${f.amount.toLocaleString()}`, 12, 57);
    doc.text(`Paid to date: Br ${f.paid.toLocaleString()}`, 12, 64);
    doc.text(`Outstanding: Br ${(f.amount - f.paid).toLocaleString()}`, 12, 71);
    doc.text(`Date issued: ${fmtDate(todayISO())}`, 12, 78);
    doc.save(`Receipt-${student.regId}-${f.label.replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <Modal title={fullName(student)} kicker="Fee ledger" onClose={onClose} wide
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn>{canManage && <Btn variant="gold" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add fee item</Btn>}</>}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-paper p-2.5 text-center"><p className="font-mono text-[16px] font-extrabold text-ink">{stats.billed.toLocaleString()}</p><p className="text-[10.5px] font-bold uppercase text-soft">Billed</p></div>
        <div className="rounded-lg bg-paper p-2.5 text-center"><p className="font-mono text-[16px] font-extrabold text-pine-700">{stats.paid.toLocaleString()}</p><p className="text-[10.5px] font-bold uppercase text-soft">Paid</p></div>
        <div className="rounded-lg bg-paper p-2.5 text-center"><p className={`font-mono text-[16px] font-extrabold ${stats.outstanding > 0 ? "text-rust-600" : "text-ink"}`}>{stats.outstanding.toLocaleString()}</p><p className="text-[10.5px] font-bold uppercase text-soft">Outstanding</p></div>
      </div>

      {addOpen && (
        <div className="mb-3 rounded-lg border border-mist bg-paper/50 p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tuition — Term 2" className="sm:col-span-1" />
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="Amount" className="rounded-lg border border-mist bg-card px-3 py-2 text-[13.5px]" />
            <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="mt-2 flex justify-end gap-2"><Btn size="sm" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn><Btn size="sm" onClick={addItem}><Save className="h-3.5 w-3.5" /> Add</Btn></div>
        </div>
      )}

      <div className="space-y-2">
        {items.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-mist bg-card p-2.5">
            <div className="min-w-[140px] flex-1">
              <p className="text-[12.5px] font-bold text-ink">{f.label}</p>
              <p className="text-[10.5px] text-soft">Due {fmtDate(f.due)}</p>
            </div>
            <span className="font-mono text-[12.5px]">Br {f.amount.toLocaleString()}</span>
            <Chip tone={f.paid >= f.amount ? "pine" : f.paid > 0 ? "gold" : "rust"}>{f.paid >= f.amount ? "Paid" : f.paid > 0 ? "Partial" : "Unpaid"}</Chip>
            {canManage && f.paid < f.amount && <Btn size="sm" variant="soft" onClick={() => { setPayItem(f); setPayAmount(f.amount - f.paid); }}><Wallet className="h-3.5 w-3.5" /> Record payment</Btn>}
            <Btn size="sm" variant="ghost" onClick={() => printReceipt(f)}><Printer className="h-3.5 w-3.5" /> Receipt</Btn>
            {canManage && <button onClick={() => removeItem(f)} className="cursor-pointer rounded p-1.5 text-soft hover:bg-rust-100 hover:text-rust-600"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-[12.5px] text-soft">No fee items yet.</p>}
      </div>

      {payItem && (
        <Modal title={`Record payment — ${payItem.label}`} onClose={() => setPayItem(null)}
          footer={<><Btn variant="ghost" onClick={() => setPayItem(null)}>Cancel</Btn><Btn onClick={recordPayment}><Save className="h-4 w-4" /> Save payment</Btn></>}>
          <Field label={`Amount (outstanding: Br ${(payItem.amount - payItem.paid).toLocaleString()})`} required>
            <input type="number" min={0} max={payItem.amount - payItem.paid} value={payAmount} onChange={(e) => setPayAmount(Math.min(payItem.amount - payItem.paid, Number(e.target.value) || 0))} className="w-full rounded-lg border border-mist bg-card px-3 py-2 text-[13.5px]" />
          </Field>
        </Modal>
      )}
    </Modal>
  );
}
