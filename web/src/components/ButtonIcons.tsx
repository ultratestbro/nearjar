/** Small stroke icons for the tactile header and hero buttons, drawn in the text color. */
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function GridIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

export function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke} strokeWidth={2.4}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function WalletIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M16 12.5h2M3 9h18" />
    </svg>
  );
}

export function JarIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...stroke}>
      <rect x="6" y="3" width="12" height="4" rx="1.5" />
      <path d="M5 9h14v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
    </svg>
  );
}
