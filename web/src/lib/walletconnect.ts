// WalletConnect for phone wallets: a QR on desktop, a wallet list with deep links on phones.
// Reown AppKit is only the modal here (manual WalletConnect control, no wagmi): the Universal
// Provider holds the session, and NearJar asks for one namespace at a time, eip155 or solana,
// so the same session signs the jar message and pays the donation. Loaded on first use.

import type UniversalProvider from "@walletconnect/universal-provider";
import type { AppKit } from "@reown/appkit/core";
import { CC_SOURCE_CHAINS } from "@anywalletkit/swap2-assets";

export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
export const WC_ICON = "https://raw.githubusercontent.com/WalletConnect/walletconnect-assets/master/Icon/Blue%20(Default)/Icon.png";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export type WcNamespace = "eip155" | "solana";

/** Optional namespaces: every EVM chain a donor can pay from, and Solana mainnet. */
const NAMESPACES: Record<WcNamespace, { chains: string[]; methods: string[]; events: string[] }> = {
  eip155: {
    chains: CC_SOURCE_CHAINS.map((c) => c.caip2).filter((c) => c.startsWith("eip155:")),
    methods: ["personal_sign", "eth_sendTransaction", "wallet_switchEthereumChain"],
    events: ["chainChanged", "accountsChanged"],
  },
  solana: {
    chains: [SOLANA_MAINNET],
    methods: ["solana_signMessage", "solana_signAndSendTransaction", "solana_signTransaction"],
    events: [],
  },
};

let loading: Promise<{ provider: UniversalProvider; modal: AppKit }> | null = null;

function load() {
  loading ??= (async () => {
    const [{ default: Universal }, { createAppKit }, { mainnet, solana }] = await Promise.all([
      import("@walletconnect/universal-provider"),
      import("@reown/appkit/core"),
      import("@reown/appkit/networks"),
    ]);
    const origin = window.location.origin;
    const metadata = { name: "NearJar", description: "Donation jars for near.com accounts", url: origin, icons: [`${origin}/icon-180.png`] };
    const provider = await Universal.init({ projectId: WC_PROJECT_ID, metadata });
    const modal = createAppKit({
      projectId: WC_PROJECT_ID,
      metadata,
      networks: [mainnet, solana],
      universalProvider: provider,
      manualWCControl: true,
      enableInjected: false,
      enableEIP6963: false,
      enableCoinbase: false,
      themeMode: "dark",
      themeVariables: { "--w3m-accent": "#6ee7a0" },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false },
    });
    provider.on("display_uri", (uri: string) => void modal.open({ uri }));
    return { provider, modal };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export interface WcSession {
  provider: UniversalProvider;
  /** CAIP-10 accounts the wallet approved in this namespace, e.g. `eip155:8453:0xab…`. */
  accounts: string[];
  methods: string[];
  peer: { name: string; icon: string; redirect?: string };
}

/** Connects (or, `silent`, only restores) a WalletConnect session that covers `ns`. */
export async function wcConnect(ns: WcNamespace, { silent = false } = {}): Promise<WcSession> {
  if (!WC_PROJECT_ID) throw new Error("WalletConnect is not set up on this site.");
  const { provider, modal } = await load();
  const covered = () => (provider.session?.namespaces[ns]?.accounts.length ?? 0) > 0;
  if (!covered()) {
    if (silent) throw new Error("not authorised");
    // a session for the other namespace can't be widened in place: start over
    if (provider.session) await provider.disconnect().catch(() => {});
    let unsubscribe = () => {};
    const closed = new Promise<never>((_, reject) => {
      let opened = false;
      unsubscribe = modal.subscribeState((s) => {
        if (s.open) opened = true;
        else if (opened && !covered()) {
          provider.abortPairingAttempt();
          reject(new Error("cancelled"));
        }
      });
    });
    try {
      await Promise.race([provider.connect({ optionalNamespaces: { [ns]: NAMESPACES[ns] } }), closed]);
    } finally {
      unsubscribe();
      void modal.close();
    }
    if (!covered()) throw new Error(`That wallet didn't approve ${ns === "solana" ? "Solana" : "EVM"} accounts.`);
  }
  const session = provider.session!;
  const { name, icons, redirect } = session.peer.metadata;
  return {
    provider,
    accounts: session.namespaces[ns]!.accounts,
    methods: session.namespaces[ns]!.methods,
    peer: { name, icon: icons[0] ?? WC_ICON, redirect: redirect?.native || redirect?.universal },
  };
}

export async function wcDisconnect(): Promise<void> {
  if (!loading) return;
  const { provider } = await loading;
  if (provider.session) await provider.disconnect().catch(() => {});
}

/** On a phone, a request waits in the wallet app: switch to it, as the wallet's metadata allows. */
export function nudgeWallet(s: WcSession): void {
  if (!s.peer.redirect || !window.matchMedia("(pointer: coarse)").matches) return;
  window.location.href = s.peer.redirect;
}

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** An EIP-1193 face for the session: chain switching stays local to the chains the wallet approved. */
export function wcEip1193(s: WcSession): Eip1193 {
  const chains = [...new Set(s.accounts.map((a) => a.split(":").slice(0, 2).join(":")))];
  const address = s.accounts[0]!.split(":")[2]!;
  let current = chains.includes("eip155:1") ? "eip155:1" : chains[0]!;
  return {
    async request({ method, params }) {
      if (method === "eth_chainId") return `0x${BigInt(current.split(":")[1]!).toString(16)}`;
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "wallet_switchEthereumChain") {
        const id = `eip155:${BigInt((params?.[0] as { chainId: string }).chainId)}`;
        if (!chains.includes(id)) throw Object.assign(new Error("The wallet didn't approve this network."), { code: 4902 });
        current = id;
        return null;
      }
      const out = s.provider.request({ method, params }, current);
      nudgeWallet(s);
      return out;
    },
  };
}
