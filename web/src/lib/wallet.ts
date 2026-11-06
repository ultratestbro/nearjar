// Wallets for jar owners and donors: connect (or silently reconnect after a reload), derive the
// near.com account and sign a NearJar message in the envelope intents.near accepts. near.com derives
// the account from the login wallet the same way: EVM → its 0x address, Solana and TON → the hex of
// the ed25519 public key, NEAR → the account id. EVM and Solana connect through Reown AppKit
// (extensions, phone wallets over WalletConnect), NEAR through wallet-selector, TON through TON Connect.

export type WalletFamily = "evm" | "solana" | "near" | "ton";

/** What /api/jars/prepare returns: the text to sign plus what NEP-413 binds next to it. */
export interface SignRequest {
  message: string;
  nonce: string;
  recipient: string;
}

export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export interface ConnectedWallet {
  family: WalletFamily;
  /** The wallet app, as it names itself. */
  name: string;
  icon: string;
  /** The address the wallet shows. */
  address: string;
  /** The near.com (intents.near) account id. */
  account: string;
  sign(request: SignRequest): Promise<Record<string, unknown>>;
  /** EVM payments: an EIP-1193 provider. */
  evm?: Eip1193;
  /** Solana payments: signs and broadcasts a wire transaction, returns its signature. */
  solanaSend?: (wire: Uint8Array) => Promise<string>;
}

export const FAMILIES: WalletFamily[] = ["evm", "solana", "near", "ton"];

/** Connects a wallet of the family in its own modal. `silent` only picks up a session it already has. */
export async function connectWallet(family: WalletFamily, { silent = false } = {}): Promise<ConnectedWallet> {
  if (family === "near") return connectNear(silent);
  if (family === "ton") return connectTon(silent);
  const kit = await import("./appkit");
  if (family === "evm") {
    const a = await kit.kitConnect("eip155", { silent });
    return evmWallet(a, await kit.kitEip1193(), a.address);
  }
  const a = await kit.kitConnect("solana", { silent });
  const sol = await kit.kitSolana();
  const pk = fromBase58(a.address);
  return {
    family: "solana",
    name: a.name,
    icon: a.icon,
    address: a.address,
    account: toHex(pk),
    solanaSend: sol.send,
    async sign({ message }) {
      const signature = await sol.signMessage(new TextEncoder().encode(message));
      return {
        standard: "raw_ed25519",
        payload: message,
        public_key: `ed25519:${a.address}`,
        signature: `ed25519:${base58(signature)}`,
      };
    },
  };
}

/** EVM: personal_sign over the jar message; the near.com account is the lowercased address. */
function evmWallet(base: { name: string; icon: string }, eth: Eip1193, address: string): ConnectedWallet {
  return {
    family: "evm",
    name: base.name,
    icon: base.icon,
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

/** NEAR: NEP-413 signMessage; the near.com account is the NEAR account id. */
async function connectNear(silent: boolean): Promise<ConnectedWallet> {
  const { nearSignIn } = await import("./pay/near");
  const { wallet, accountId, name, icon } = await nearSignIn({ silent });
  return {
    family: "near",
    name,
    icon,
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
async function connectTon(silent: boolean): Promise<ConnectedWallet> {
  const { tonConnect } = await import("./pay/ton");
  const c = await tonConnect({ silent });
  const pk = c.account?.publicKey?.toLowerCase();
  if (!c.account || !pk || !/^[0-9a-f]{64}$/.test(pk)) throw new Error("This TON wallet does not share its public key.");
  const name = c.wallet && "name" in c.wallet ? String(c.wallet.name) : "TON wallet";
  const icon = c.wallet && "imageUrl" in c.wallet ? String(c.wallet.imageUrl) : TON_ICON;
  return {
    family: "ton",
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
  const { kitDisconnect } = await import("./appkit");
  await kitDisconnect(w.family === "evm" ? "eip155" : "solana");
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
function fromBase58(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("Bad base58.");
    n = n * 58n + BigInt(i);
  }
  const hex = n === 0n ? "" : n.toString(16);
  const body = fromHex(hex.length % 2 ? "0" + hex : hex);
  const zeros = s.match(/^1*/)![0].length;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

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
