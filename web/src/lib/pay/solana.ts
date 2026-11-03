import { WalletAccountReadOnlySolana } from "@anywalletkit/wallet-solana";
import { compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { PayInstruction, Payer } from "./types";

/**
 * Exposes Any Wallet Kit's Solana transfer builders (native SOL, SPL with the recipient's token
 * account created idempotently, compute budget, simulation) for an external wallet to sign.
 */
class DepositBuilder extends WalletAccountReadOnlySolana {
  async depositWire(p: PayInstruction): Promise<Uint8Array> {
    const built = p.contract
      ? await this.buildTokenTransfer(p.contract, p.to, BigInt(p.amount))
      : { message: await this.buildNativeTransfer(p.to, BigInt(p.amount)), tokenFee: 0n };
    // simulate before the wallet sees it: a transfer that would fail never asks for a signature
    const plan = await this.planMessage(built.message, { simulate: true, tokenFee: built.tokenFee });
    const tx = plan.transaction ?? compileTransaction(plan.message as never);
    const wire = getBase64EncodedWireTransaction(tx as never);
    return Uint8Array.from(atob(wire), (c) => c.charCodeAt(0));
  }
}

type SignAndSend = {
  signAndSendTransaction(i: { transaction: Uint8Array; account: WalletAccount; chain: string }): Promise<readonly { signature: Uint8Array }[]>;
};

/** A connected Wallet Standard wallet (Phantom, Solflare, Backpack…): SDK-built transfer, signed and sent by the wallet. */
export function solanaPayer(wallet: Wallet, account: WalletAccount): Payer {
  if (!("solana:signAndSendTransaction" in wallet.features)) throw new Error(`${wallet.name} can't send transactions here.`);
  const builder = new DepositBuilder(account.address, { provider: `${window.location.origin}/api/rpc/solana` });
  return {
    family: "solana",
    label: wallet.name,
    address: account.address,
    async pay(p) {
      const transaction = await builder.depositWire(p);
      const [out] = await (wallet.features["solana:signAndSendTransaction"] as SignAndSend).signAndSendTransaction({
        transaction,
        account,
        chain: "solana:mainnet",
      });
      if (!out) throw new Error("The wallet returned no signature.");
      return base58(out.signature);
    },
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = "1" + s;
  }
  return s;
}
