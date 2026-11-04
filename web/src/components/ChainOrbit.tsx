import { LogoMark } from "./Logo";

type Chain = { label: string; icon: string | null | undefined };

// rings from the jar outwards: radius (% of the box), how many logos, seconds per turn
const RINGS = [
  { r: 22, n: 6, turn: 60 },
  { r: 34, n: 9, turn: 90 },
  { r: 44, n: 12, turn: 120 },
];

/**
 * Every network donors pay from, on slow orbits around the jar they all land in. Clipped: a
 * spinning square's corners would otherwise widen the page on phones.
 */
export function ChainOrbit({ chains }: { chains: Chain[] }) {
  const rings = RINGS.map((ring, i) => {
    const from = RINGS.slice(0, i).reduce((n, x) => n + x.n, 0);
    // the outer ring takes whatever is left
    return { ...ring, items: chains.slice(from, i === RINGS.length - 1 ? undefined : from + ring.n) };
  });

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px] overflow-hidden" role="img" aria-label={`Donors pay from ${chains.map((c) => c.label).join(", ")}`}>
      {rings.map((ring, i) => (
        <div key={i} className="absolute inset-0">
          <div
            className="absolute rounded-full border border-line/70"
            style={{ inset: `${50 - ring.r}%` }}
          />
          <div className="orbit absolute inset-0" style={{ animationDuration: `${ring.turn}s`, animationDirection: i % 2 ? "reverse" : "normal" }}>
            {ring.items.map((c, j) => {
              const a = (2 * Math.PI * j) / ring.items.length + i * 0.4;
              return (
                <span
                  key={c.label}
                  title={c.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${50 + ring.r * Math.cos(a)}%`, top: `${50 + ring.r * Math.sin(a)}%` }}
                >
                  <span className="orbit block" style={{ animationDuration: `${ring.turn}s`, animationDirection: i % 2 ? "normal" : "reverse" }}>
                    {c.icon ? (
                      <img src={c.icon} alt="" loading="lazy" className="size-8 rounded-full bg-surface-2 shadow-lg shadow-black/40 ring-4 ring-bg sm:size-10" />
                    ) : (
                      <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs ring-4 ring-bg sm:size-10">{c.label[0]}</span>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <div className="absolute inset-[38%] grid place-items-center rounded-full bg-panel shadow-[0_0_80px_-10px_var(--accent)] ring-1 ring-accent/40">
        <LogoMark size={44} orbit={false} />
      </div>
    </div>
  );
}
