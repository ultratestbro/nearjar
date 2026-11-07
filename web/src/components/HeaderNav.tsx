"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GridIcon, PlusIcon } from "./ButtonIcons";

const LINKS = [
  { href: "/me", label: "Studio", icon: <GridIcon /> },
  { href: "/new", label: "Create a jar", icon: <PlusIcon /> },
];

/** Header links: tactile buttons from `sm` up, folded into a menu dropdown on phones. */
export function HeaderNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="btn-tactile h-9 px-3.5 text-sm"
          >
            {l.icon}
            {l.label}
          </Link>
        ))}
      </div>

      <div ref={ref} className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
          className="btn-tactile size-9 justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            {open ? (
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 flex w-48 flex-col gap-1 rounded-2xl border border-line bg-surface p-2 shadow-2xl shadow-black/50">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm hover:bg-surface-2"
              >
                {l.icon}
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
