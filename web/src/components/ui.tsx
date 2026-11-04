import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>;
}

/** near.com's main surface: one rounded panel the page sits in. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-panel ${className}`}>{children}</div>;
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "danger" | "warn" }) {
  const c =
    tone === "accent" ? "border-accent/40 text-accent" : tone === "danger" ? "border-danger/40 text-danger" : tone === "warn" ? "border-amber-400/40 text-amber-300" : "border-line text-muted";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${c}`}>{children}</span>;
}

/** near.com tabs: white pill for the active one, plain text for the rest. */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: ReactNode; dot?: boolean }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`no-scrollbar flex gap-1 overflow-x-auto ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
            t.id === value ? "bg-pill text-bg" : "text-muted hover:bg-surface hover:text-text"
          }`}
        >
          {t.label}
          {t.dot && <span aria-label="needs attention" className="size-1.5 rounded-full bg-amber-400" />}
        </button>
      ))}
    </div>
  );
}

/** A list card: rows separated by hairlines, like near.com's asset list. */
export function ListCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface ${className}`}>{children}</div>;
}

/** One list row: icon, label over a hint, a value on the right, a chevron when it opens something. */
export function ListRow({
  icon,
  label,
  hint,
  value,
  onClick,
  chevron = !!onClick,
  className = "",
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate">{label}</span>
        {hint && <span className="truncate text-xs text-muted">{hint}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 text-right text-sm">{value}</span>}
      {chevron && <Chevron />}
    </>
  );
  const cls = `flex w-full items-center gap-3 px-4 py-3.5 ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} transition hover:bg-surface-2`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Chevron({ dir = "right" }: { dir?: "right" | "left" | "down" }) {
  const d = dir === "left" ? "M10 3 5 8l5 5" : dir === "down" ? "M3 6l5 5 5-5" : "M6 3l5 5-5 5";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-muted">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Progress({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Chain / token icon from the SDK catalog; a lettered disc when there is none. */
export function Icon({ src, alt, size = 20 }: { src?: string | null; alt: string; size?: number }) {
  if (!src)
    return (
      <span style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] text-muted">
        {alt.slice(0, 1)}
      </span>
    );
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" className="shrink-0 rounded-full bg-surface-2" />;
}

export function shortAccount(a: string): string {
  return a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

export function money(usd: number, frac = 2): string {
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: frac })}`;
}

export function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
