import Link from "next/link";

export default function Home() {
  return (
    <section className="flex flex-col gap-6 py-10">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
        A tip jar for your near.com account that anyone can pay from any chain.
      </h1>
      <p className="max-w-2xl text-muted">
        Your near.com address only receives from other near.com users. A NearJar link takes USDC on Solana, ETH on
        Base, BTC, TON and more, and delivers it straight into your near.com balance through NEAR Intents.
      </p>
      <div className="flex gap-3">
        <Link href="/new" className="rounded-full bg-accent px-5 py-2.5 font-medium text-accent-ink">
          Create a jar
        </Link>
        <Link href="/j/demo" className="rounded-full border border-line px-5 py-2.5 font-medium">
          Try the demo jar
        </Link>
      </div>
    </section>
  );
}
