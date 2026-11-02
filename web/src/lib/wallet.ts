// Browser wallets for jar owners: connect, derive the near.com account, sign a NearJar message
// in the envelope intents.near accepts. near.com derives the account from the login wallet the
// same way: EVM → its 0x address, Solana → the hex of its ed25519 public key.

export type WalletKind = "evm" | "solana";

export interface ConnectedWallet {
  kind: WalletKind;
  label: string;
  /** The near.com (intents.near) account id. */
  account: string;
  sign(message: string): Promise<Record<string, string>>;
}

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type SolanaProvider = {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toBytes(): Uint8Array } }>;
  signMessage(msg: Uint8Array, display?: "utf8"): Promise<{ signature: Uint8Array }>;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

export function availableWallets(): WalletKind[] {
  if (typeof window === "undefined") return [];
  const out: WalletKind[] = [];
  if (window.ethereum) out.push("evm");
  if (window.phantom?.solana ?? window.solana) out.push("solana");
  return out;
}

export async function connect(kind: WalletKind): Promise<ConnectedWallet> {
  return kind === "evm" ? connectEvm() : connectSolana();
}

async function connectEvm(): Promise<ConnectedWallet> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!address) throw new Error("The wallet returned no account.");
  const account = address.toLowerCase();
  return {
    kind: "evm",
    label: "EVM wallet",
    account,
    async sign(message) {
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

async function connectSolana(): Promise<ConnectedWallet> {
  const sol = window.phantom?.solana ?? window.solana;
  if (!sol) throw new Error("No Solana wallet found. Install Phantom.");
  const { publicKey } = await sol.connect();
  const pk = publicKey.toBytes();
  return {
    kind: "solana",
    label: "Solana wallet",
    account: toHex(pk),
    async sign(message) {
      const { signature } = await sol.signMessage(new TextEncoder().encode(message), "utf8");
      return {
        standard: "raw_ed25519",
        payload: message,
        public_key: `ed25519:${base58(pk)}`,
        signature: `ed25519:${base58(signature)}`,
      };
    },
  };
}

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
