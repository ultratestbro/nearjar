"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";

export type DropToken = { symbol: string; icon: string; chainIcon: string };

type Flight = { id: number; token: DropToken; angle: number; bend: number };

// where coins start (% of the box from its center), and the jar's mouth they drop into
const FROM = 47;
const MOUTH = { x: 50, y: 45 };
const FLY_MS = 1400;

/**
 * The jar at the middle of the orbits: every second or two a random token from a random network
 * flies in on a curve and drops through the lid, and the jar wobbles like a shaken piggy bank.
 * Nothing flies for people who ask for less motion, or while the tab is hidden.
 */
export function JarDrops({ tokens }: { tokens: DropToken[] }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const jar = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const next = useRef(0);

  useEffect(() => {
    if (!tokens.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setTimeout>;
    const spawn = () => {
      if (document.visibilityState === "visible") {
        const token = tokens[Math.floor(Math.random() * tokens.length)]!;
        // from anywhere but straight below: a coin rising into the jar's bottom looks wrong
        const angle = Math.PI * (0.85 + Math.random() * 1.3);
        const bend = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 10);
        setFlights((f) => [...f, { id: next.current++, token, angle, bend }]);
      }
      timer = setTimeout(spawn, 700 + Math.random() * 1300);
    };
    timer = setTimeout(spawn, 600);
    return () => clearTimeout(timer);
  }, [tokens]);

  const landed = useCallback((id: number) => {
    setFlights((f) => f.filter((x) => x.id !== id));
    // a fresh shake replaces one still running, so quick drops don't stack into a spin
    jar.current?.getAnimations().forEach((a) => a.cancel());
    jar.current?.animate(
      [
        { transform: "rotate(0) scale(1, 1)" },
        { transform: "rotate(0) scale(1.08, 0.9)", offset: 0.12 },
        { transform: "rotate(-12deg) scale(0.97, 1.05)", offset: 0.3 },
        { transform: "rotate(10deg) scale(1)", offset: 0.5 },
        { transform: "rotate(-6deg)", offset: 0.68 },
        { transform: "rotate(3deg)", offset: 0.84 },
        { transform: "rotate(0) scale(1, 1)" },
      ],
      { duration: 650, easing: "ease-out" },
    );
    glow.current?.getAnimations().forEach((a) => a.cancel());
    glow.current?.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
  }, []);

  return (
    <>
      {flights.map((f) => (
        <Coin key={f.id} flight={f} onLanded={landed} />
      ))}
      <div className="absolute inset-[38%] grid place-items-center rounded-full bg-panel shadow-[0_0_80px_-10px_var(--accent)] ring-1 ring-accent/40">
        <div ref={glow} className="pointer-events-none absolute inset-0 rounded-full opacity-0 shadow-[0_0_60px_6px_var(--accent)]" />
        <div ref={jar} style={{ transformOrigin: "50% 85%" }}>
          <LogoMark size={44} orbit={false} />
        </div>
      </div>
    </>
  );
}

function Coin({ flight, onLanded }: { flight: Flight; onLanded: (id: number) => void }) {
  const el = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const { angle, bend } = flight;
    const x0 = 50 + FROM * Math.cos(angle);
    const y0 = 50 + FROM * Math.sin(angle);
    // the curve's midpoint, pushed sideways off the straight line, and a spot just above the lid
    const mx = (x0 + MOUTH.x) / 2 - bend * Math.sin(angle);
    const my = (y0 + MOUTH.y) / 2 + bend * Math.cos(angle) - 6;
    const at = (x: number, y: number) => ({ left: `${x}%`, top: `${y}%` });
    const a = el.current?.animate(
      [
        { ...at(x0, y0), opacity: 0, transform: "translate(-50%, -50%) scale(0.6) rotate(0)" },
        { opacity: 1, offset: 0.12 },
        { ...at(mx, my), transform: "translate(-50%, -50%) scale(1) rotate(200deg)", offset: 0.55 },
        { ...at(MOUTH.x, MOUTH.y - 9), opacity: 1, transform: "translate(-50%, -50%) scale(0.8) rotate(330deg)", offset: 0.85 },
        { ...at(MOUTH.x, MOUTH.y), opacity: 0, transform: "translate(-50%, -50%) scale(0.35) rotate(360deg)" },
      ],
      { duration: FLY_MS, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" },
    );
    if (!a) return;
    a.onfinish = () => onLanded(flight.id);
    return () => a.cancel();
  }, [flight, onLanded]);

  const { token } = flight;
  return (
    <span ref={el} aria-hidden className="pointer-events-none absolute z-10 opacity-0" style={{ left: "50%", top: "50%" }}>
      <span className="relative block">
        <img src={token.icon} alt="" className="size-9 rounded-full bg-surface-2 shadow-[0_0_18px_2px_var(--accent)] ring-2 ring-accent/70 sm:size-10" />
        {token.chainIcon && token.chainIcon !== token.icon && (
          <img src={token.chainIcon} alt="" className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-bg" />
        )}
      </span>
    </span>
  );
}
