import { useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import {
  Camera, Check, ChevronLeft, ChevronRight, CreditCard, Download, FileText, GraduationCap, ImagePlus,
  Printer, Trash2, Upload, User, Users, X,
} from "lucide-react";
import type { Student, StudentDoc } from "../types";
import { describeSyncErrors, getClass, getSection, getYear, sectionLabel, todayISO, uid, useApp } from "../store";
import { pushAudit } from "../rbac";
import { Btn, Chip, Field, Modal, Panel, Select, TextArea, TextInput } from "../ui";

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });

const STEPS = ["Personal", "Guardian", "Admission", "Placement", "Photo & Docs", "Review"];

interface WizardProps {
  student?: Student; // present = edit mode
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function RegistrationWizard({ student, onClose, onSaved }: WizardProps) {
  const { db, currentUser, yearId, update, toast, reconnect } = useApp();
  const isEdit = !!student;
  const activeYear = getYear(db, yearId) ?? db.years.find((y) => y.active);
  const yrPrefix = activeYear ? activeYear.name.slice(0, 4) : "2026";

  const nextNum = db.students.length + 1;
  const [f, setF] = useState({
    regId: student?.regId ?? `ST-${yrPrefix}-${String(nextNum).padStart(3, "0")}`,
    firstName: student?.firstName ?? "",
    middleName: student?.middleName ?? "",
    lastName: student?.lastName ?? "",
    gender: student?.gender ?? ("Male" as "Male" | "Female"),
    dob: student?.dob ?? "",
    phone: student?.phone ?? "",
    email: student?.email ?? "",
    address: student?.address ?? "",
    gFather: student?.guardian.father ?? "",
    gMother: student?.guardian.mother ?? "",
    gRelation: student?.guardian.relation ?? "Father",
    gPhone: student?.guardian.phone ?? "",
    gAddress: student?.guardian.address ?? "",
    admNo: student?.admission.number ?? `ADM-${yrPrefix}-${String(nextNum).padStart(3, "0")}`,
    admDate: student?.admission.date ?? todayISO(),
    prevSchool: student?.admission.previousSchool ?? "",
    admType: student?.admission.type ?? "New Admission",
    classId: student?.enrollment?.classId ?? db.classes[0]?.id ?? "",
    sectionId: student?.enrollment?.sectionId ?? "",
    makeLogin: false,
    username: "",
    password: "stud123",
  });
  const [photo, setPhoto] = useState<string | undefined>(student?.photo);
  const [docs, setDocs] = useState<StudentDoc[]>(student?.documents ?? []);
  const [step, setStep] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));

  const classObj = getClass(db, f.classId);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0: return !!(f.firstName.trim() && f.lastName.trim() && f.dob);
      case 1: return !!f.gFather.trim();
      case 2: return !!f.admNo.trim() && !!f.admDate;
      case 3: return !!f.classId && !!f.sectionId;
      default: return true;
    }
  }, [step, f]);

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Choose an image file (JPG/PNG).", "warn"); return; }
    setPhoto(await readAsDataUrl(file));
  };

  const addDocs = async (files: File[]) => {
    const items: StudentDoc[] = [];
    for (const file of files) {
      const small = file.size < 400_000;
      items.push({
        id: uid(), name: file.name, kind: file.type.startsWith("image/") ? "Image" : "Document",
        size: `${Math.max(1, Math.round(file.size / 1024))} KB`, date: todayISO(),
        dataUrl: small ? await readAsDataUrl(file) : undefined,
      });
    }
    setDocs((d) => [...d, ...items]);
    if (items.length) toast(`${items.length} file(s) attached.`);
  };

  const save = async () => {
    if (!f.firstName.trim() || !f.lastName.trim() || !f.dob) { toast("Names and date of birth are required.", "warn"); return; }
    if (!f.classId || !f.sectionId) { toast("Pick a grade and section.", "warn"); return; }
    if (!isEdit && f.makeLogin && (!f.username.trim() || !f.password.trim())) { toast("Login needs a username and password.", "warn"); return; }
    if (!isEdit && f.makeLogin && f.password.trim().length < 6) { toast("Password must be at least 6 characters.", "warn"); return; }
    if (!isEdit && f.makeLogin && db.users.some((u) => u.username.toLowerCase() === f.username.trim().toLowerCase())) { toast("That username is already taken.", "warn"); return; }

    const id = isEdit ? student!.id : uid();
    const errors = await update((d) => {
      const record: Student = {
        id,
        regId: f.regId.trim(),
        firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim(),
        gender: f.gender, dob: f.dob, status: "active", photo,
        phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim(),
        guardian: { father: f.gFather.trim(), mother: f.gMother.trim(), relation: f.gRelation, phone: f.gPhone.trim(), address: f.gAddress.trim() || f.address.trim() },
        admission: { number: f.admNo.trim(), date: f.admDate, previousSchool: f.prevSchool.trim(), type: f.admType },
        enrollment: { yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: f.admDate },
        history: isEdit
          ? [...student!.history.slice(0, -1), { yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: f.admDate }]
          : [{ yearId, classId: f.classId, sectionId: f.sectionId, status: "active", enrolledOn: f.admDate }],
        documents: docs,
      };
      if (isEdit) {
        const idx = d.students.findIndex((x) => x.id === id);
        if (idx >= 0) d.students[idx] = record;
        pushAudit(d, currentUser, "student.edit", `${record.firstName} ${record.lastName}`, "Record updated via wizard");
      } else {
        d.students.push(record);
        pushAudit(d, currentUser, "student.register", `${record.firstName} ${record.lastName}`, `Admitted to ${sectionLabel(db, f.classId, f.sectionId)}`);
        if (f.makeLogin) {
          d.users.push({
            id: uid(), name: `${record.firstName} ${record.lastName}`, username: f.username.trim(), password: f.password.trim(),
            role: "student", roleId: "student", status: "active", studentId: id, email: record.email, createdAt: todayISO(),
          });
        }
      }
    });

    if (errors.length) {
      // The student record may still have landed even if the login didn't (or vice versa) — say exactly what failed rather than a blanket success.
      toast(describeSyncErrors(errors), "warn");
    } else {
      toast(isEdit ? "Student record updated." : `${f.firstName.trim()} ${f.lastName.trim()} registered${f.makeLogin ? " — login created" : ""}.`);
    }
    if (!isEdit && f.makeLogin && errors.length === 0) await reconnect(); // pull the real Supabase-assigned account id in place of the local placeholder
    onSaved?.(id);
    onClose();
  };

  const canNext = stepValid;

  return (
    <Modal
      title={isEdit ? `Edit ${student!.firstName} ${student!.lastName}` : "Register new student"}
      kicker={isEdit ? "Update the permanent record — history is preserved" : "One permanent record, reused everywhere"}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn variant="ghost" onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}>
            <ChevronLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
          </Btn>
          {step < STEPS.length - 1 ? (
            <Btn onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Next: {STEPS[step + 1]} <ChevronRight className="h-4 w-4" />
            </Btn>
          ) : (
            <Btn variant="gold" onClick={save}><Check className="h-4 w-4" /> {isEdit ? "Save changes" : "Register student"}</Btn>
          )}
        </>
      }
    >
      {/* stepper */}
      <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => i < step && setStep(i)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition-all ${
              i === step ? "border-pine-700 bg-pine-800 text-white shadow-sm"
              : i < step ? "cursor-pointer border-pine-300 bg-pine-50 text-pine-700"
              : "border-mist bg-card text-soft"
            }`}
          >
            <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] ${i === step ? "bg-gold-400 text-pine-950" : i < step ? "bg-pine-600 text-white" : "bg-mist text-soft"}`}>
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="anim-rise grid gap-4 sm:grid-cols-2">
          <Field label="Student ID" hint="auto-generated, editable"><TextInput value={f.regId} onChange={(e) => set({ regId: e.target.value })} className="font-mono" /></Field>
          <Field label="Gender"><Select value={f.gender} onChange={(e) => set({ gender: e.target.value as "Male" | "Female" })}><option>Male</option><option>Female</option></Select></Field>
          <Field label="First name" required><TextInput value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} /></Field>
          <Field label="Middle name"><TextInput value={f.middleName} onChange={(e) => set({ middleName: e.target.value })} /></Field>
          <Field label="Last name" required><TextInput value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} /></Field>
          <Field label="Date of birth" required><TextInput type="date" value={f.dob} onChange={(e) => set({ dob: e.target.value })} /></Field>
          <Field label="Student phone"><TextInput value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Student email"><TextInput value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Home address" className="sm:col-span-2"><TextInput value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        </div>
      )}

      {step === 1 && (
        <div className="anim-rise grid gap-4 sm:grid-cols-2">
          <Field label="Guardian / father name" required><TextInput value={f.gFather} onChange={(e) => set({ gFather: e.target.value })} /></Field>
          <Field label="Mother name"><TextInput value={f.gMother} onChange={(e) => set({ gMother: e.target.value })} /></Field>
          <Field label="Relationship"><Select value={f.gRelation} onChange={(e) => set({ gRelation: e.target.value })}><option>Father</option><option>Mother</option><option>Guardian</option><option>Uncle</option><option>Aunt</option><option>Other</option></Select></Field>
          <Field label="Guardian phone"><TextInput value={f.gPhone} onChange={(e) => set({ gPhone: e.target.value })} /></Field>
          <Field label="Guardian address" className="sm:col-span-2" hint="defaults to home address"><TextInput value={f.gAddress} onChange={(e) => set({ gAddress: e.target.value })} /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="anim-rise grid gap-4 sm:grid-cols-2">
          <Field label="Admission number" required><TextInput value={f.admNo} onChange={(e) => set({ admNo: e.target.value })} className="font-mono" /></Field>
          <Field label="Admission date" required><TextInput type="date" value={f.admDate} onChange={(e) => set({ admDate: e.target.value })} /></Field>
          <Field label="Previous school"><TextInput value={f.prevSchool} onChange={(e) => set({ prevSchool: e.target.value })} /></Field>
          <Field label="Admission type"><Select value={f.admType} onChange={(e) => set({ admType: e.target.value })}><option>New Admission</option><option>Transfer</option><option>Re-admission</option></Select></Field>
        </div>
      )}

      {step === 3 && (
        <div className="anim-rise grid gap-4 sm:grid-cols-2">
          <Field label="Academic year"><TextInput value={activeYear?.name ?? ""} disabled className="bg-paper/60" /></Field>
          <Field label="Grade" required>
            <Select value={f.classId} onChange={(e) => set({ classId: e.target.value, sectionId: "" })}>
              {db.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Section" required className="sm:col-span-2">
            <Select value={f.sectionId} onChange={(e) => set({ sectionId: e.target.value })}>
              <option value="">Select…</option>
              {classObj?.sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
            </Select>
          </Field>
          {f.classId && f.sectionId && (
            <p className="rounded-lg border border-pine-200 bg-pine-50 px-3 py-2.5 text-[12.5px] font-semibold text-pine-800 sm:col-span-2">
              <GraduationCap className="mr-1.5 inline h-4 w-4" /> Will be enrolled in {sectionLabel(db, f.classId, f.sectionId)} · AY {activeYear?.name}
            </p>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="anim-rise space-y-5">
          <div>
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Student photo — used on the ID card</p>
            <div className="flex items-center gap-4">
              <div className="flex h-24 w-20 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-mist bg-paper/60">
                {photo ? (
                  <img src={photo} alt="Student" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-8 w-8 text-soft/50" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Btn size="sm" variant="soft" onClick={() => fileRef.current?.click()}><ImagePlus className="h-3.5 w-3.5" /> {photo ? "Replace photo" : "Upload photo"}</Btn>
                {photo && <Btn size="sm" variant="ghost" onClick={() => setPhoto(undefined)}><Trash2 className="h-3.5 w-3.5" /> Remove</Btn>}
                <p className="text-[11px] text-soft">JPG/PNG, square works best.</p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Documents — birth certificate, previous records, ID</p>
            <div
              onClick={() => docRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addDocs(Array.from(e.dataTransfer.files)); }}
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-mist bg-paper/50 px-4 py-7 text-center transition-all hover:border-pine-400 hover:bg-pine-50/50"
            >
              <Upload className="h-6 w-6 text-pine-600" />
              <p className="text-[13px] font-bold text-ink">Drag & drop or click to upload</p>
              <p className="text-[11px] text-soft">Files under 400 KB keep a preview you can open in-app</p>
            </div>
            <input ref={docRef} type="file" multiple className="hidden" onChange={(e) => { addDocs(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            {docs.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {docs.map((dc) => (
                  <li key={dc.id} className="flex items-center gap-2.5 rounded-lg border border-mist bg-card px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-pine-600" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{dc.name}</span>
                    <span className="text-[10.5px] text-soft">{dc.size}</span>
                    <button onClick={() => setDocs((d) => d.filter((x) => x.id !== dc.id))} className="cursor-pointer rounded p-1 text-soft hover:bg-rust-100 hover:text-rust-600"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="anim-rise space-y-4">
          <div className="flex items-center gap-4 rounded-xl border border-mist bg-paper/60 p-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-pine-700 ring-2 ring-pine-300">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <User className="h-7 w-7 text-pine-200" />}
            </div>
            <div className="min-w-0">
              <p className="font-display text-[16px] font-extrabold text-ink">{f.firstName} {f.middleName} {f.lastName}</p>
              <p className="font-mono text-[11.5px] text-soft">{f.regId} · {f.gender} · b. {f.dob}</p>
              <p className="mt-1 text-[12px] font-semibold text-pine-700">{sectionLabel(db, f.classId, f.sectionId)} · AY {activeYear?.name}</p>
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
            <p className="text-soft">Guardian <span className="float-right font-semibold text-ink">{f.gFather || "—"}</span></p>
            <p className="text-soft">Guardian phone <span className="float-right font-mono font-semibold text-ink">{f.gPhone || "—"}</span></p>
            <p className="text-soft">Admission no <span className="float-right font-mono font-semibold text-ink">{f.admNo}</span></p>
            <p className="text-soft">Admitted <span className="float-right font-semibold text-ink">{f.admDate}</span></p>
            <p className="text-soft">Documents <span className="float-right font-semibold text-ink">{docs.length} attached</span></p>
          </div>
          {!isEdit && (
            <div className="rounded-lg border border-pine-200 bg-pine-50 p-3.5">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={f.makeLogin} onChange={(e) => set({ makeLogin: e.target.checked })} className="h-4 w-4 accent-pine-700" />
                <span className="text-[12.5px] font-bold text-pine-900">Create a student login</span>
                <span className="text-[11px] text-pine-700">— they sign in and see only their own records</span>
              </label>
              {f.makeLogin && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Username" required><TextInput value={f.username} onChange={(e) => set({ username: e.target.value })} className="font-mono" placeholder="e.g. abebe.k" /></Field>
                  <Field label="Temporary password" required><TextInput value={f.password} onChange={(e) => set({ password: e.target.value })} className="font-mono" /></Field>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ================= ID card ================= */
export function IDCardModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const { db, yearId, toast } = useApp();
  const activeYear = getYear(db, yearId) ?? db.years.find((y) => y.active);
  const school = db.settings.schoolName;
  const enr = student.enrollment;
  const placement = enr ? sectionLabel(db, enr.classId, enr.sectionId) : "—";
  const guardian = student.guardian;

  const downloadPdf = () => {
    const W = 85.6, H = 54;
    const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });
    const PINE: [number, number, number] = [22, 53, 42];
    const GOLD: [number, number, number] = [226, 162, 29];
    const INK: [number, number, number] = [27, 38, 32];

    /* front */
    doc.setFillColor(...PINE); doc.rect(0, 0, W, 15, "F");
    doc.setFillColor(...GOLD); doc.rect(0, 15, W, 1.2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(school.toUpperCase(), W / 2, 6.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(6);
    doc.text("STUDENT IDENTITY CARD", W / 2, 11, { align: "center" });

    if (student.photo) {
      const fmt = student.photo.includes("image/png") ? "PNG" : "JPEG";
      try { doc.addImage(student.photo, fmt, 6, 20, 21, 26); } catch { /* unsupported image */ }
    } else {
      doc.setDrawColor(180, 190, 182); doc.setLineWidth(0.4); doc.rect(6, 20, 21, 26);
      doc.setFontSize(7); doc.setTextColor(140, 150, 142);
      doc.text("PHOTO", 16.5, 34, { align: "center" });
    }

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`${student.firstName} ${student.middleName} ${student.lastName}`, 31, 24);
    doc.setFont("courier", "bold"); doc.setFontSize(8); doc.setTextColor(...PINE);
    doc.text(student.regId, 31, 29);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...INK);
    doc.text(placement, 31, 34);
    doc.text(`Academic Year ${activeYear?.name ?? ""}`, 31, 38);
    doc.text(student.gender, 31, 42);
    doc.setFontSize(6); doc.setTextColor(120, 130, 122);
    doc.text(`Valid thru ${activeYear?.end ?? ""}`, 31, 47);
    doc.setFontSize(5.5);
    doc.text(db.settings.motto, W / 2, 51.5, { align: "center" });

    /* back */
    doc.addPage([W, H], "landscape");
    doc.setFillColor(...PINE); doc.rect(0, 0, W, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
    doc.text(school.toUpperCase(), W / 2, 5, { align: "center" });
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Guardian / Emergency Contact", 6, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`${guardian.relation}: ${guardian.father}`, 6, 19);
    doc.text(`Phone: ${guardian.phone ?? "—"}`, 6, 23.5);
    doc.text(`Address: ${(guardian.address || student.address || "—").slice(0, 60)}`, 6, 28);
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(50, 44, 80, 44);
    doc.setFontSize(5.5); doc.setTextColor(120, 130, 122);
    doc.text("Registrar signature", 65, 46.5, { align: "center" });
    doc.text("If found, please return to the school office.", 6, 50);

    doc.save(`id-card-${student.regId}.pdf`);
    toast("ID card PDF downloaded.");
  };

  return (
    <Modal title="Student ID card" kicker={`${student.regId} · CR80 format`} onClose={onClose} wide
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn variant="soft" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Btn>
          <Btn variant="gold" onClick={downloadPdf}><Download className="h-4 w-4" /> Download PDF</Btn>
        </>
      }>
      <div className="idcard-sheet flex flex-wrap items-start justify-center gap-6">
        {/* FRONT */}
        <div>
          <div className="idcard flex flex-col bg-card">
            <div className="bg-pine-900 px-4 py-2 text-center">
              <p className="font-display text-[12px] font-extrabold uppercase tracking-wide text-white">{school}</p>
              <p className="text-[7.5px] font-semibold tracking-[0.2em] text-pine-300">STUDENT IDENTITY CARD</p>
            </div>
            <div className="h-[3px] bg-gold-400" />
            <div className="flex flex-1 gap-3 p-3">
              <div className="flex h-[104px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-mist bg-paper">
                {student.photo ? <img src={student.photo} alt="" className="h-full w-full object-cover" /> : <User className="h-8 w-8 text-soft/40" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-extrabold leading-tight text-ink">{student.firstName} {student.middleName} {student.lastName}</p>
                <p className="font-mono text-[11px] font-bold text-pine-700">{student.regId}</p>
                <div className="mt-1.5 space-y-0.5 text-[10.5px] font-semibold text-soft">
                  <p className="text-ink">{placement}</p>
                  <p>AY {activeYear?.name}</p>
                  <p>{student.gender}</p>
                  <p className="text-[9px] text-soft/70">Valid thru {activeYear?.end}</p>
                </div>
              </div>
            </div>
            <p className="pb-1.5 text-center text-[7.5px] italic text-soft/70">{db.settings.motto}</p>
          </div>
          <p className="no-print mt-1.5 text-center text-[10.5px] font-semibold text-soft">Front</p>
        </div>

        {/* BACK */}
        <div>
          <div className="idcard flex flex-col bg-card">
            <div className="bg-pine-900 px-4 py-1.5 text-center">
              <p className="font-display text-[10px] font-extrabold uppercase tracking-wide text-white">{school}</p>
            </div>
            <div className="flex-1 space-y-2 p-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-soft">Guardian / Emergency contact</p>
                <p className="text-[11.5px] font-bold text-ink">{guardian.relation}: {guardian.father}</p>
                <p className="font-mono text-[10.5px] text-soft">{guardian.phone || "—"}</p>
                <p className="text-[10px] text-soft">{(guardian.address || student.address || "—").slice(0, 55)}</p>
              </div>
              <div className="flex items-end justify-between pt-3">
                <p className="max-w-[150px] text-[8.5px] italic text-soft/70">If found, please return to the school office.</p>
                <div className="text-center">
                  <div className="h-px w-[110px] bg-ink/60" />
                  <p className="mt-0.5 text-[8px] text-soft">Registrar signature</p>
                </div>
              </div>
            </div>
          </div>
          <p className="no-print mt-1.5 text-center text-[10.5px] font-semibold text-soft">Back</p>
        </div>
      </div>
      <p className="no-print mt-4 text-center text-[11px] text-soft">
        {!student.photo && <Chip tone="gold" className="mr-2"><Camera className="h-3 w-3" /> No photo on file — upload one in Edit</Chip>}
        Use Download PDF for a print-ready CR80 card.
      </p>
    </Modal>
  );
}
