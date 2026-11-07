import type { LinkKind } from "@/lib/pageData";

/** Monochrome marks for the jar's links, drawn in the text color. */
export function LinkIcon({ kind, size = 16 }: { kind: LinkKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, className: "shrink-0" } as const;
  if (kind === "website")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3.5 9h17M3.5 15h17" />
      </svg>
    );
  if (kind === "x")
    return (
      <svg {...common} fill="currentColor">
        <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" transform="translate(2.4 2.4) scale(0.8)" />
      </svg>
    );
  if (kind === "telegram")
    return (
      <svg {...common} fill="currentColor">
        <path d="M21.2 3.6 2.9 10.7c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.5c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.2-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.8-1.5-1.3ZM9.4 13.4l8.5-5.4c.4-.2.7-.1.4.2l-7.1 6.4-.3 3.2-1.5-4.4Z" />
      </svg>
    );
  return (
    <svg {...common} fill="currentColor">
      <path fillRule="evenodd" d="M2 9.5C2 7 3.8 5.2 6.2 5c3.9-.3 7.7-.3 11.6 0C20.2 5.2 22 7 22 9.5v5c0 2.5-1.8 4.3-4.2 4.5-3.9.3-7.7.3-11.6 0C3.8 18.8 2 17 2 14.5v-5ZM10 9v6l5.2-3L10 9Z" />
    </svg>
  );
}
