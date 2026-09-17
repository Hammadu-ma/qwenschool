import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import type { Role, Student, User } from "./types";
import { initials } from "./store";
import { useSignedUrl } from "./lib/storage";

/* ================= primitives ================= */
const btnVariants: Record<string, string> = {
  solid: "bg-pine-800 text-pine-50 hover:bg-pine-700 active:bg-pine-900 shadow-sm",
  gold: "bg-gold-400 text-pine-950 hover:bg-gold-300 active:bg-gold-500 shadow-sm",
  soft: "bg-pine-100 text-pine-800 hover:bg-pine-200",
  outline: "border border-mist bg-card text-ink hover:border-pine-400 hover:bg-pine-50",
  ghost: "text-soft hover:bg-pine-100/70 hover:text-pine-800",
  danger: "bg-rust-600 text-white hover:bg-rust-500 shadow-sm",
  dangerSoft: "bg-rust-100 text-rust-700 hover:bg-rust-200",
};
const btnSizes: Record<string, string> = {
  sm: "text-[12.5px] px-2.5 py-1.5 gap-1.5",
  md: "text-[13.5px] px-3.5 py-2 gap-2",
  lg: "text-[14.5px] px-5 py-2.5 gap-2",
};

export function Btn({
  variant = "solid",
  size = "md",
  className = "",
  busy = false,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes; busy?: boolean }) {
  return (
    <button
      className={`relative inline-flex items-center justify-center rounded-lg font-semibold tracking-tight transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none cursor-pointer whitespace-nowrap ${btnVariants[variant]} ${btnSizes[size]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy}
      {...props}
    >
      {busy && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />}
      <span className={busy ? "opacity-80" : ""}>{children}</span>
    </button>
  );
}

const chipTones: Record<string, string> = {
  pine: "bg-pine-100 text-pine-800 border-pine-200",
  gold: "bg-gold-100 text-gold-700 border-gold-200",
  rust: "bg-rust-100 text-rust-700 border-rust-200",
  steel: "bg-steel-100 text-steel-700 border-steel-100",
  gray: "bg-paper text-soft border-mist",
  dark: "bg-pine-900 text-pine-100 border-pine-800",
};
export function Chip({ tone = "gray", className = "", children }: { tone?: keyof typeof chipTones; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ${chipTones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export const ROLE_META: Record<Role, { label: string; tone: keyof typeof chipTones; dot: string }> = {
  admin: { label: "Administrator", tone: "dark", dot: "bg-gold-400" },
  teacher: { label: "Teacher", tone: "pine", dot: "bg-pine-500" },
  student: { label: "Student", tone: "steel", dot: "bg-steel-500" },
  guardian: { label: "Guardian", tone: "gold", dot: "bg-gold-500" },
};

export function RoleBadge({ role, full }: { role: Role; full?: boolean }) {
  const m = ROLE_META[role];
  return (
    <Chip tone={m.tone}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {full ? m.label : m.label.slice(0, 5)}
    </Chip>
  );
}

export const inputCls =
  "w-full rounded-lg border border-mist bg-card px-3 py-2 text-[13.5px] text-ink placeholder:text-soft/60 outline-none transition-shadow focus:border-pine-500 focus:ring-2 focus:ring-pine-500/20";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${props.className ?? ""}`} {...props} />;
}
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputCls} min-h-[84px] ${props.className ?? ""}`} {...props} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputCls} cursor-pointer ${props.className ?? ""}`} {...props} />;
}

export function Field({ label, required, hint, children, className = "" }: { label: string; required?: boolean; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">
          {label} {required && <span className="text-rust-500">*</span>}
        </span>
        {hint && <span className="text-[11px] text-soft/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Modal({
  title,
  kicker,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-pine-950/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`anim-pop relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-xl border border-pine-900/20 bg-card shadow-2xl ${wide ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="flex items-start justify-between gap-4 border-b border-mist px-5 py-4">
          <div>
            {kicker && <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gold-600">{kicker}</p>}
            <h3 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h3>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1.5 text-soft transition-colors hover:bg-paper hover:text-ink" aria-label="Close">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-mist bg-paper/60 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; icon?: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-mist bg-paper p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-150 ${
            active === t.id ? "bg-pine-800 text-pine-50 shadow-sm" : "text-soft hover:bg-card hover:text-ink"
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-mist bg-card shadow-[0_1px_2px_rgba(13,33,26,0.05)] ${className}`}>{children}</div>;
}

/* ================= loading skeletons =================
 * Shown while a page's lazy-loaded feature group(s) are still in flight
 * (see useLazyGroups in store.tsx) so an empty array mid-fetch never
 * reads as "no records" — the skeleton fills the same slot the real
 * content will occupy once the group finishes loading. */
export function Skel({ className = "" }: { className?: string }) {
  return <div className={`skel rounded-md ${className}`} />;
}

/** Drop-in replacement for a data table's <tbody> while its rows are loading. */
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-mist/70">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className={tdCls()}>
              <Skel className={`h-3.5 ${c === 0 ? "w-28" : "w-16"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A small grid of shimmering stat/card placeholders (dashboards, summaries). */
export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <Panel key={i} className="p-4">
          <Skel className="mb-2 h-3 w-16" />
          <Skel className="h-6 w-12" />
        </Panel>
      ))}
    </div>
  );
}

/** Full-panel loading placeholder for whichever page section is still
 *  waiting on its lazy group — a list of shimmering rows inside a Panel,
 *  standing in for whatever the real content (table, list, cards) will be. */
export function SkeletonPanel({ rows = 5 }: { rows?: number }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skel className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex-1">
              <Skel className="mb-1.5 h-3 w-1/3" />
              <Skel className="h-2.5 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-xl bg-pine-100 text-pine-700">{icon}</div>
      <p className="font-display text-[15px] font-bold text-ink">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-soft">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Ring({ pct, size = 54, stroke = 5, color = "var(--color-pine-600)", label }: { pct: number; size?: number; stroke?: number; color?: string; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-mist)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.22,.9,.3,1)" }} />
      </svg>
      <span className="tnum absolute font-display text-[12px] font-bold text-ink">{label ?? `${Math.round(pct)}%`}</span>
    </div>
  );
}

const avatarColors = ["#2c654c", "#3a6b8c", "#96543f", "#55618f", "#337a77", "#b07e24", "#557d3b", "#8a3325"];
export function Avatar({ student, size = 36, className = "" }: { student: Student; size?: number; className?: string }) {
  const photoUrl = useSignedUrl("student_photo", student.id, student.photo);
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={`inline-block shrink-0 rounded-full object-cover ring-2 ring-white/70 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const color = avatarColors[(student.id.charCodeAt(2) || 0) % avatarColors.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white ring-2 ring-white/70 ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}dd)`, fontSize: size * 0.36 }}
    >
      {initials(student)}
    </span>
  );
}

export function UserAvatar({ name, role, size = 36, className = "" }: { name: string; role: Role; size?: number; className?: string }) {
  const parts = name.replace(/^(Mr\.|Ms\.|Mrs\.)\s*/i, "").split(" ");
  const ini = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  const color = ROLE_META[role].dot.replace("bg-", "");
  const bg = { "gold-400": "#b07e24", "pine-500": "#2c654c", "steel-500": "#3a6b8c" }[color] ?? "#1d4334";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${bg}, ${bg}cc)`, fontSize: size * 0.34 }}
    >
      {ini}
    </span>
  );
}

export function PageHead({ kicker, title, sub, children }: { kicker: string; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="anim-rise mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-gold-600">{kicker}</p>
        <h1 className="font-display text-[21px] font-extrabold leading-tight tracking-tight text-ink sm:text-[26px]">{title}</h1>
        {sub && <p className="mt-0.5 max-w-2xl text-[13px] text-soft">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export const thCls = () => "px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-soft";
export const tdCls = () => "px-3 py-2.5 text-[13px]";

/* ================= username conflict resolution =================
   Shown instead of a flat "username already taken" toast wherever a login
   is created (student registration, guardian, quick-add, admin users page).
   Lets the admin pick how to resolve it rather than just bouncing them
   back to retype something. */
export function UsernameConflictModal({
  existing, username, password, onCancel, onReplace, onUseNew,
}: {
  existing: User;
  username: string;
  password: string;
  onCancel: () => void;
  onReplace: () => Promise<void> | void;
  onUseNew: (username: string, password: string) => Promise<void> | void;
}) {
  const [u, setU] = useState(username);
  const [p, setP] = useState(password);
  const [busy, setBusy] = useState<"replace" | "useNew" | null>(null);
  const valid = u.trim().length > 0 && p.trim().length >= 6 && u.trim().toLowerCase() !== username.toLowerCase();

  const runUseNew = async () => {
    setBusy("useNew");
    try { await onUseNew(u.trim().toLowerCase(), p.trim()); } finally { setBusy(null); }
  };
  const runReplace = async () => {
    setBusy("replace");
    try { await onReplace(); } finally { setBusy(null); }
  };

  return (
    <Modal title="Username already taken" kicker="Choose how to resolve it" onClose={() => { if (!busy) onCancel(); }}>
      <div className="space-y-4">
        <p className="text-[13px] text-soft">
          <span className="rounded bg-paper px-1.5 py-0.5 font-mono font-bold text-ink">@{username}</span> is already used by{" "}
          <span className="font-bold text-ink">{existing.name}</span>{" "}
          <span className="text-[11.5px]">({existing.role}{existing.status === "disabled" ? ", disabled" : ""})</span>.
        </p>

        <div className="rounded-lg border border-mist bg-card p-3.5">
          <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-soft">Use a different username or password instead</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="New username">
              <TextInput value={u} onChange={(e) => setU(e.target.value)} className="font-mono" autoFocus disabled={!!busy} />
            </Field>
            <Field label="New password" hint="min. 6 characters">
              <TextInput value={p} onChange={(e) => setP(e.target.value)} className="font-mono" disabled={!!busy} />
            </Field>
          </div>
          <Btn variant="solid" size="sm" className="mt-3 w-full" disabled={!valid || !!busy} busy={busy === "useNew"} onClick={runUseNew}>
            Save with these credentials
          </Btn>
        </div>

        <div className="rounded-lg border border-rust-200 bg-rust-50 p-3.5">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-rust-700">Replace the existing account</p>
          <p className="mt-1 text-[12px] text-rust-700/85">
            Permanently removes {existing.name}'s login and creates this one with <span className="font-mono font-bold">@{username}</span> in its place. Only do this if that account is stale or unused — {existing.name} will lose access immediately.
          </p>
          <Btn variant="danger" size="sm" className="mt-3 w-full" disabled={!!busy} busy={busy === "replace"} onClick={runReplace}>
            Replace @{existing.username} with this account
          </Btn>
        </div>

        <Btn variant="ghost" size="sm" className="w-full" disabled={!!busy} onClick={onCancel}>Cancel — don't create a login</Btn>
      </div>
    </Modal>
  );
}

export function Stat({ label, value, sub, icon, tone = "pine", onClick, delay = 0 }: { label: string; value: ReactNode; sub?: string; icon?: ReactNode; tone?: "pine" | "gold" | "rust" | "steel"; onClick?: () => void; delay?: number }) {
  const tones = {
    pine: "text-pine-700 bg-pine-100",
    gold: "text-gold-600 bg-gold-100",
    rust: "text-rust-600 bg-rust-100",
    steel: "text-steel-500 bg-steel-100",
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`anim-rise flex items-center gap-3.5 rounded-xl border border-mist bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(13,33,26,0.05)] transition-all duration-200 ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-pine-300 hover:shadow-md" : "cursor-default"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>}
      <span className="min-w-0">
        <span className="block font-display text-[22px] font-extrabold leading-none tracking-tight text-ink">{value}</span>
        <span className="mt-1 block truncate text-[11.5px] font-bold text-soft">{label}{sub ? <span className="font-medium text-soft/70"> · {sub}</span> : null}</span>
      </span>
    </button>
  );
}
