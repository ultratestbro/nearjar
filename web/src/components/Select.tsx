"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./ui";

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  hint?: string;
}

/** Dropdown in NearJar's style: logos, search for long lists, keyboard (↑ ↓ Enter Esc). */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  label,
  searchable = options.length > 8,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setQuery("");
    setOpen(true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      return openList();
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o) pick(o.value);
    }
  };

  return (
    <div ref={ref} className="relative" onKeyDown={onKey}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`flex w-full items-center gap-3 rounded-xl border bg-surface-2 px-3 py-2.5 text-left ${open ? "border-accent" : "border-line hover:border-muted/50"}`}
      >
        {current?.icon !== undefined && <Icon src={current.icon} alt={current.label} size={22} />}
        <span className={`flex-1 truncate ${current ? "text-text" : "text-muted"}`}>{current?.label ?? placeholder}</span>
        {current?.hint && <span className="text-xs text-muted">{current.hint}</span>}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`shrink-0 text-muted transition ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/50">
          {searchable && (
            <div className="border-b border-line p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search…"
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
            </div>
          )}
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing found</li>}
            {shown.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${i === active ? "bg-surface-2" : ""}`}
              >
                {o.icon !== undefined && <Icon src={o.icon} alt={o.label} size={22} />}
                <span className="flex-1">{o.label}</span>
                {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                {o.value === value && (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-accent">
                    <path d="M3 7.5 6 10 11 4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
