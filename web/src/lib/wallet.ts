// Browser wallets for jar owners and donors: discover them with their names and icons, connect
// (or silently reconnect after a reload), derive the near.com account and sign a NearJar message
// in the envelope intents.near accepts. near.com derives the account from the login wallet the
// same way: EVM → its 0x address, Solana and TON → the hex of the ed25519 public key, NEAR → the
// account id.

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export type WalletFamily = "evm" | "solana" | "near" | "ton";

/** What /api/jars/prepare returns: the text to sign plus what NEP-413 binds next to it. */
export interface SignRequest {
  message: string;
  nonce: string;
  recipient: string;
}

export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export interface WalletOption {
  id: string;
  family: WalletFamily;
  name: string;
  icon: string;
}

export interface ConnectedWallet extends WalletOption {
  /** The address the wallet shows. */
  address: string;
  /** The near.com (intents.near) account id. */
  account: string;
  sign(request: SignRequest): Promise<Record<string, unknown>>;
  /** The EIP-1193 provider (EVM) or Wallet Standard wallet (Solana), for payments. */
  evm?: Eip1193;
  solana?: { wallet: Wallet; account: WalletAccount };
}

type Discovered = WalletOption & { evm?: Eip1193; solana?: Wallet };

const found = new Map<string, Discovered>();

/** Starts EIP-6963 and Wallet Standard discovery; `onChange` fires as wallets announce themselves. */
export function discoverWallets(onChange: (options: WalletOption[]) => void): () => void {
  const emit = () => onChange([...found.values()].map(({ id, family, name, icon }) => ({ id, family, name, icon })));

  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent<{ info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 }>).detail;
    if (!d?.info?.rdns || !d.provider) return;
    found.set(`evm:${d.info.rdns}`, { id: `evm:${d.info.rdns}`, family: "evm", name: d.info.name, icon: d.info.icon, evm: d.provider });
    emit();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const standard = getWallets();
  const addSolana = (ws: readonly Wallet[]) => {
    for (const w of ws) {
      if (!w.chains.some((c) => c.startsWith("solana:")) || !("solana:signMessage" in w.features)) continue;
      found.set(`solana:${w.name}`, { id: `solana:${w.name}`, family: "solana", name: w.name, icon: w.icon, solana: w });
    }
    emit();
  };
  addSolana(standard.get());
  const off = standard.on("register", (...ws) => addSolana(ws));

  // NEAR wallets come from wallet-selector; TON Connect lists its wallets in its own modal
  void import("./pay/near")
    .then(({ nearWalletChoices }) => nearWalletChoices())
    .then((choices) => {
      for (const c of choices) found.set(`near:${c.id}`, { id: `near:${c.id}`, family: "near", name: c.name, icon: c.icon });
      emit();
    })
    .catch(() => {});
  found.set("ton:tonconnect", { id: "ton:tonconnect", family: "ton", name: "TON wallet", icon: TON_ICON });

  // a lone legacy window.ethereum (no EIP-6963) still counts
  const legacy = setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (eth && ![...found.values()].some((w) => w.family === "evm")) {
      found.set("evm:injected", { id: "evm:injected", family: "evm", name: "Browser wallet", icon: "", evm: eth });
      emit();
    }
  }, 500);

  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    off();
    clearTimeout(legacy);
  };
}

/** Connects a discovered wallet. `silent` only succeeds if the site is already authorised (no popup). */
export async function connectWallet(id: string, { silent = false } = {}): Promise<ConnectedWallet> {
  const w = found.get(id);
  if (!w) throw new Error("That wallet is not available in this browser.");
  const base = { id: w.id, family: w.family, name: w.name, icon: w.icon };

  if (w.evm) {
    const eth = w.evm;
    const [address] = (await eth.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" })) as string[];
    if (!address) throw new Error(silent ? "not authorised" : "The wallet returned no account.");
    return {
      ...base,
      address,
      account: address.toLowerCase(),
      evm: eth,
      async sign({ message }) {
        const hexMsg = "0x" + toHex(new TextEncoder().encode(message));
        const sig = (await eth.request({ method: "personal_sign", params: [hexMsg, address] })) as string;
        const bytes = fromHex(sig);
        if (bytes.length !== 65) throw new Error("Unexpected signature length.");
        // wallets return v = 27/28; intents.near expects the recovery id 0/1
        if (bytes[64]! >= 27) bytes[64]! -= 27;
        return { standard: "erc191", payload: message, signature: `secp256k1:${base58(bytes)}` };
      },
    };
  }

  if (w.family === "near") return connectNear(base, id.slice("near:".length), silent);
  if (w.family === "ton") return connectTon(base, silent);

  const wallet = w.solana!;
  const { accounts } = await (wallet.features["standard:connect"] as {
    connect(i?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
  }).connect(silent ? { silent: true } : undefined);
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
  if (!account) throw new Error(silent ? "not authorised" : "The wallet returned no account.");
  const pk = new Uint8Array(account.publicKey);
  return {
    ...base,
    address: account.address,
    account: toHex(pk),
    solana: { wallet, account },
    async sign({ message }) {
      const [out] = await (wallet.features["solana:signMessage"] as {
        signMessage(i: { account: WalletAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]>;
      }).signMessage({ account, message: new TextEncoder().encode(message) });
      if (!out) throw new Error("The wallet returned no signature.");
      return {
        standard: "raw_ed25519",
        payload: message,
        public_key: `ed25519:${base58(pk)}`,
        signature: `ed25519:${base58(out.signature)}`,
      };
    },
  };
}

/** NEAR: NEP-413 signMessage; the near.com account is the NEAR account id. */
async function connectNear(base: WalletOption, walletId: string, silent: boolean): Promise<ConnectedWallet> {
  const { nearSignIn } = await import("./pay/near");
  const { wallet, accountId } = await nearSignIn(walletId, { silent });
  return {
    ...base,
    address: accountId,
    account: accountId,
    async sign({ message, nonce, recipient }) {
      const { Buffer } = await import("buffer");
      const out = await wallet.signMessage({ message, recipient, nonce: Buffer.from(nonce, "base64") });
      if (!out) throw new Error("The wallet returned no signature.");
      return {
        standard: "nep413",
        payload: { message, nonce, recipient },
        public_key: out.publicKey,
        signature: `ed25519:${base58(Uint8Array.from(atob(out.signature), (c) => c.charCodeAt(0)))}`,
      };
    },
  };
}

/** TON: TON Connect signData (text); the near.com account is the hex of the wallet's public key. */
async function connectTon(base: WalletOption, silent: boolean): Promise<ConnectedWallet> {
  const { tonConnect } = await import("./pay/ton");
  const c = await tonConnect({ silent });
  const pk = c.account?.publicKey?.toLowerCase();
  if (!c.account || !pk || !/^[0-9a-f]{64}$/.test(pk)) throw new Error("This TON wallet does not share its public key.");
  const name = c.wallet && "name" in c.wallet ? String(c.wallet.name) : base.name;
  const icon = c.wallet && "imageUrl" in c.wallet ? String(c.wallet.imageUrl) : base.icon;
  return {
    ...base,
    name,
    icon,
    address: c.account.address,
    account: pk,
    async sign({ message }) {
      const out = await c.signData({ type: "text", text: message });
      return {
        standard: "ton_connect",
        address: out.address,
        domain: out.domain,
        timestamp: out.timestamp,
        payload: { type: "text", text: message },
        public_key: `ed25519:${base58(fromHex(pk))}`,
        signature: `ed25519:${base58(Uint8Array.from(atob(out.signature), (ch) => ch.charCodeAt(0)))}`,
      };
    },
  };
}

export async function disconnectWallet(w: ConnectedWallet): Promise<void> {
  if (w.family === "near") {
    const { getSelector } = await import("./pay/near");
    await getSelector()
      .then((s) => s.wallet())
      .then((wallet) => wallet.signOut())
      .catch(() => {});
    return;
  }
  if (w.family === "ton") {
    const { connector } = await import("./pay/ton");
    await connector()
      .then((c) => c.disconnect())
      .catch(() => {});
    return;
  }
  const off = w.solana?.wallet.features["standard:disconnect"] as { disconnect(): Promise<void> } | undefined;
  await off?.disconnect().catch(() => {});
}

const TON_ICON = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png";

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (toHex(bytes) || "0"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
