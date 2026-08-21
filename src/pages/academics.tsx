/* ================= mark entry (admin full / teacher scoped) ================= */
export function MarkEntryPage() {
  const { db, currentUser, yearId, update, toast } = useApp();
  const role = currentUser?.role ?? "admin";
  const isAdmin = role === "admin";
  const pairs = teacherPairs(db, currentUser);

  // Get all structures for the year
  const allStructures = db.structures.filter((st) => st.yearId === yearId);

  // Filter structures based on user role
  const allowedStructures = allStructures.filter((st) => {
    if (isAdmin) return true;
    return pairs.some((p) => p.classId === st.classId && p.subjectIds.includes(st.subjectId));
  });

  // Get unique classes, sections, and subjects from allowed structures
  const classOptions = [...new Set(allowedStructures.map((st) => st.classId))];
  const subjectOptions = [...new Set(allowedStructures.map((st) => st.subjectId))];

  // Filter state
  const [filterClassId, setFilterClassId] = useState<string>("");
  const [filterSectionId, setFilterSectionId] = useState<string>("");
  const [filterSubjectId, setFilterSubjectId] = useState<string>("");

  // Filter structures based on selected filters
  const filteredStructures = allowedStructures.filter((st) => {
    if (filterClassId && st.classId !== filterClassId) return false;
    if (filterSectionId) {
      // Check if this structure's class has the selected section
      const cls = getClass(db, st.classId);
      if (!cls?.sections.some(s => s.id === filterSectionId)) return false;
    }
    if (filterSubjectId && st.subjectId !== filterSubjectId) return false;
    return true;
  });

  const [sel, setSel] = useState<{ id: string | null }>({ id: null });
  const [editStruct, setEditStruct] = useState<AssessmentStructure | "new" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Auto-select first filtered structure if current selection is not in filtered list
  const structure = useMemo(() => {
    const current = filteredStructures.find((s) => s.id === sel.id);
    if (current) return current;
    return filteredStructures[0] ?? null;
  }, [filteredStructures, sel.id]);

  // Update selection when filters change
  useEffect(() => {
    if (filteredStructures.length > 0 && (!sel.id || !filteredStructures.some(s => s.id === sel.id))) {
      setSel({ id: filteredStructures[0].id });
    }
  }, [filteredStructures, sel.id]);

  // Get section options for the selected class
  const availableSections = useMemo(() => {
    if (!filterClassId) return [];
    const cls = getClass(db, filterClassId);
    return cls?.sections || [];
  }, [db, filterClassId]);

  // teacher's allowed students for the chosen structure
  const roster: Student[] = useMemo(() => {
    if (!structure) return [];
    const all = db.students.filter((s) => s.enrollment?.classId === structure.classId);
    if (isAdmin) return all;
    const allowed = teacherStudentIds(db, currentUser);
    return all.filter((s) => allowed.has(s.id));
  }, [db, structure, isAdmin, currentUser]);

  const ranks = structure ? structureRanks(db, structure) : {};

  /* ---------- submission workflow (submit → approve/return → publish) ---------- */
  const submission = structure ? submissionFor(db, structure.id) : undefined;
  const status = structure ? submissionStatus(db, structure.id) : "draft";
  const canApprove = hasPermission(db, currentUser, "results.manage");
  const canPublish = hasPermission(db, currentUser, "results.publish");
  const canEnter = hasPermission(db, currentUser, "exams.enter_marks") || isAdmin;
  /** Marks are editable only while in draft/returned, and only by someone who may enter marks. */
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

      {/* Filter bar */}
      <div className="anim-rise mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-mist bg-card p-3">
        <Field label="Grade" className="w-40">
          <Select 
            value={filterClassId} 
            onChange={(e) => {
              setFilterClassId(e.target.value);
              setFilterSectionId(""); // Reset section when class changes
              setSel({ id: null });
            }}
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
            onChange={(e) => {
              setFilterSectionId(e.target.value);
              setSel({ id: null });
            }}
            disabled={!filterClassId}
          >
            <option value="">All sections</option>
            {availableSections.map((s) => (
              <option key={s.id} value={s.id}>Section {s.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Subject" className="w-48">
          <Select 
            value={filterSubjectId} 
            onChange={(e) => {
              setFilterSubjectId(e.target.value);
              setSel({ id: null });
            }}
          >
            <option value="">All subjects</option>
            {subjectOptions.map((id) => {
              const subj = getSubject(db, id);
              return subj ? <option key={id} value={id}>{subj.name}</option> : null;
            })}
          </Select>
        </Field>

        {(filterClassId || filterSectionId || filterSubjectId) && (
          <Btn 
            size="sm" 
            variant="ghost" 
            onClick={() => {
              setFilterClassId("");
              setFilterSectionId("");
              setFilterSubjectId("");
              setSel({ id: null });
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear filters
          </Btn>
        )}

        <span className="ml-auto text-[11.5px] text-soft">
          {filteredStructures.length} structure{filteredStructures.length !== 1 ? "s" : ""} found
        </span>
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

              {/* workflow action bar */}
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
