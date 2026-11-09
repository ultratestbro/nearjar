import Link from "next/link";
import { HeartIcon, PlusIcon } from "@/components/ButtonIcons";
import { ChainOrbit } from "@/components/ChainOrbit";
import { LogoMark } from "@/components/Logo";
import { SOURCE_ASSETS } from "@/lib/assets";
import { SUPPORT_JAR_SLUG } from "@/lib/pageData";

const STEPS = [
  { title: "Create a jar", text: "Connect the wallet you use for near.com and sign one message. No gas, no new account." },
  { title: "Share the link", text: "Post it anywhere. Donors pay from the wallet and chain they already use, or straight from an exchange." },
  { title: "Receive in near.com", text: "NEAR Intents swaps and delivers every donation into your near.com balance, ready to use." },
];

const chip = "flex items-center gap-2 self-start rounded-full bg-surface px-3 py-1.5 text-sm";

export default function Home() {
  const chains = [...new Map(SOURCE_ASSETS.map((a) => [a.chain, { label: a.chainLabel, icon: a.chainIcon }])).values()];
  // the coins flying into the jar: each token with the network it really lives on
  const tokens = SOURCE_ASSETS.filter((a) => a.icon).map((a) => ({ symbol: a.symbol, icon: a.icon, chain: a.chainLabel, chainIcon: a.chainIcon }));
  return (
    <div className="flex flex-col gap-16 py-6">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col items-start gap-6">
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            A tip jar for your near.com account. <span className="text-accent">Payable from any chain.</span>
          </h1>
          <div className="flex flex-wrap gap-3">
            <Link href="/new" className="btn-tactile-accent btn-tactile-lg h-14 gap-2.5 px-6 text-[17px]"><PlusIcon size={18} />Create a jar</Link>
            <Link href={`/j/${SUPPORT_JAR_SLUG}`} className="btn-tactile btn-tactile-lg h-14 gap-2.5 px-6 text-[17px] font-medium"><HeartIcon size={18} />Support the developer</Link>
          </div>
        </div>
        <div className="flex flex-col items-center gap-4">
          <ChainOrbit chains={chains} tokens={tokens} />
          <p className="max-w-sm text-center text-lg text-muted">
            Donors pay from {chains.length} networks. It all lands in your near.com balance.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-10">
        <div className="flex max-w-2xl flex-col gap-3">
          <p className="text-sm uppercase tracking-wider text-accent">How it works</p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">From any chain to one near.com balance.</h2>
          <p className="text-lg text-muted">Three steps for you. For your donors, one: pay the way they already do.</p>
        </div>

        <ol className="grid gap-10 lg:grid-cols-3 lg:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative flex flex-col gap-3 pl-14 lg:pl-0 lg:pt-16">
              {/* the line to the next step: down on phones, across on desktops */}
              {i < STEPS.length - 1 && (
                <span aria-hidden className="absolute bottom-[-2.5rem] left-5 top-12 w-px bg-gradient-to-b from-accent/60 to-line lg:bottom-auto lg:left-14 lg:right-[-2rem] lg:top-5 lg:h-px lg:w-auto lg:bg-gradient-to-r" />
              )}
              <span className="absolute left-0 top-0 grid size-10 place-items-center rounded-full bg-panel font-semibold text-accent ring-1 ring-accent/50">{i + 1}</span>
              <h3 className="text-xl font-semibold">{s.title}</h3>
              <p className="max-w-sm text-muted">{s.text}</p>
              {i === 0 && (
                <span className={chip}>
                  <span className="size-2 rounded-full bg-accent" />
                  Sign 1 message · $0 gas
                </span>
              )}
              {i === 1 && (
                <span className={chip}>
                  <span className="whitespace-nowrap font-mono text-text">nearjar.xyz/j/ana</span>
                  <span className="flex -space-x-1.5">
                    {chains.slice(0, 4).map((c) => (c.icon ? <img key={c.label} src={c.icon} alt="" className="size-5 rounded-full ring-2 ring-surface" /> : null))}
                  </span>
                  <span className="text-muted">+{chains.length - 4}</span>
                </span>
              )}
              {i === 2 && (
                <span className={chip}>
                  <LogoMark size={16} orbit={false} />
                  <span className="text-muted">near.com balance</span>
                  <span className="font-medium text-accent">+25.00 USDC</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

    </div>
  );
}
