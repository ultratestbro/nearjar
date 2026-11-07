"use client";

import { useEffect, useState } from "react";
import { money, shortAccount } from "./ui";

/**
 * Phones only: the total and a "Donate" button pinned to the bottom whenever the donate form is
 * off screen (it sits near the top, so this is what people see while reading supporters).
 */
export function DonateCta({ raisedUsd, goalUsd }: { raisedUsd: number; goalUsd: number | null }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const form = document.getElementById("donate");
    if (!form) return;
    const io = new IntersectionObserver(([e]) => setHidden(!!e && e.isIntersecting), { threshold: 0.15 });
    io.observe(form);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-bg/95 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform lg:hidden ${hidden ? "translate-y-full" : ""}`}
      aria-hidden={hidden}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {money(raisedUsd)} {goalUsd ? <span className="font-normal text-muted">of {money(goalUsd, 0)}</span> : <span className="font-normal text-muted">raised</span>}
        </p>
        {goalUsd && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (raisedUsd / goalUsd) * 100)}%` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        tabIndex={hidden ? -1 : 0}
        onClick={() => document.getElementById("donate")?.scrollIntoView({ behavior: "smooth" })}
        className="h-12 shrink-0 rounded-full bg-accent px-[26px] font-semibold text-accent-ink"
      >
        Donate
      </button>
    </div>
  );
}

/** A near.com account shortened for reading, copied in full on tap. */
export function CopyAccount({ account }: { account: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`nearcom:${account}`}
      onClick={() => {
        void navigator.clipboard.writeText(`nearcom:${account}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md font-mono text-text underline decoration-line underline-offset-4 hover:decoration-accent"
    >
      {copied ? "copied" : `nearcom:${shortAccount(account)}`}
    </button>
  );
}
