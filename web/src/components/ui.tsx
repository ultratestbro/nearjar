import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "danger" }) {
  const c = tone === "accent" ? "border-accent/40 text-accent" : tone === "danger" ? "border-danger/40 text-danger" : "border-line text-muted";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${c}`}>{children}</span>;
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
