import Link from "next/link";
import { Card, Icon } from "@/components/ui";
import { SOURCE_ASSETS } from "@/lib/assets";

const STEPS = [
  { n: "1", title: "Create a jar", text: "Connect the wallet you use for near.com and sign one message. No gas, no new account." },
  { n: "2", title: "Share the link", text: "Post it anywhere. Donors pay from the wallet and chain they already use, or straight from an exchange." },
  { n: "3", title: "Receive in near.com", text: "NEAR Intents swaps and delivers every donation into your near.com balance, ready to use." },
];

export default function Home() {
  const chains = [...new Map(SOURCE_ASSETS.map((a) => [a.chain, { label: a.chainLabel, icon: a.chainIcon }])).values()];
  return (
    <div className="flex flex-col gap-16 py-6">
      <section className="flex flex-col items-start gap-6 pt-6">
        <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">A concept feature for near.com</span>
        <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          A tip jar for your near.com account. <span className="text-accent">Payable from any chain.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          A near.com address only receives from other near.com users. A NearJar link takes USDC on Solana, ETH on Base,
          BTC, TON, Tron and {chains.length - 5}+ more networks, and delivers it straight into your near.com balance.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/new" className="rounded-full bg-accent px-6 py-3 font-medium text-accent-ink">Create a jar</Link>
          <Link href="/j/demo" className="rounded-full border border-line px-6 py-3 font-medium hover:bg-surface">Try the demo jar</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <Card key={s.n} className="flex flex-col gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-accent/15 font-semibold text-accent">{s.n}</span>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <p className="text-muted">{s.text}</p>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm uppercase tracking-wider text-muted">Donors pay from</h2>
        <div className="flex flex-wrap gap-2">
          {chains.map((c) => (
            <span key={c.label} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
              <Icon src={c.icon} alt={c.label} size={18} />
              {c.label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
