import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import type { Role, Student } from "./types";
import { initials } from "./store";

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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-semibold tracking-tight transition-all duration-150 disabled:opacity-45 disabled:pointer-events-none cursor-pointer whitespace-nowrap ${btnVariants[variant]} ${btnSizes[size]} ${className}`}
      {...props}
    />
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
