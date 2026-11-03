"use client";

import { useEffect, useState } from "react";
import { shortAccount } from "./ui";

/** Phones only: a "Donate" bar pinned to the bottom until the donate form scrolls into view. */
export function DonateCta() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const form = document.getElementById("donate");
    if (!form) return;
    const io = new IntersectionObserver(([e]) => setHidden(!!e && (e.isIntersecting || e.boundingClientRect.top < 0)), { threshold: 0.15 });
    io.observe(form);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform lg:hidden ${hidden ? "translate-y-full" : ""}`}
      aria-hidden={hidden}
    >
      <button
        type="button"
        tabIndex={hidden ? -1 : 0}
        onClick={() => document.getElementById("donate")?.scrollIntoView({ behavior: "smooth" })}
        className="w-full rounded-full bg-accent px-5 py-3.5 font-medium text-accent-ink"
      >
        Donate from any chain
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
