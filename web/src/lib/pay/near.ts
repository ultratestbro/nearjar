import type { WalletSelector } from "@near-wallet-selector/core";
import type { PayInstruction, Payer } from "./types";

// Wallets that sign locally broadcast through this node; NearJar never holds NEAR keys.
const NODE = "https://free.rpc.fastnear.com";
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, the NEP-145 minimum on these tokens
const GAS = 30_000_000_000_000n;

let selector: Promise<WalletSelector> | null = null;

function getSelector(): Promise<WalletSelector> {
  selector ??= (async () => {
    const [{ setupWalletSelector }, { setupMeteorWallet }, { setupHereWallet }, { setupIntearWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/here-wallet"),
      import("@near-wallet-selector/intear-wallet"),
    ]);
    return setupWalletSelector({
      network: { networkId: "mainnet", nodeUrl: NODE, helperUrl: "https://helper.mainnet.near.org", explorerUrl: "https://nearblocks.io", indexerUrl: "https://api.kitwallet.app" },
      modules: [setupMeteorWallet(), setupHereWallet(), setupIntearWallet()],
    });
  })();
  selector.catch(() => {
    selector = null;
  });
  return selector;
}

/** NEAR wallets that can sign in a popup (Meteor, HERE, Intear) — no redirect mid-payment. */
export async function nearWalletChoices(): Promise<{ id: string; name: string }[]> {
  const s = await getSelector();
  return s.store
    .getState()
    .modules.filter((m) => m.metadata.available)
    .map((m) => ({ id: m.id, name: m.metadata.name }));
}

export async function connectNearPayer(walletId = "meteor-wallet"): Promise<Payer> {
  const s = await getSelector();
  const wallet = await s.wallet(walletId);
  const accounts = (await wallet.signIn({ contractId: "", methodNames: [], accounts: [] } as never)) as { accountId: string }[] | undefined;
  const accountId = accounts?.[0]?.accountId ?? s.store.getState().accounts.find((a) => a.active)?.accountId;
  if (!accountId) throw new Error("The wallet returned no NEAR account.");
  const name = s.store.getState().modules.find((m) => m.id === walletId)?.metadata.name ?? "NEAR wallet";

  return {
    family: "near",
    label: name,
    address: accountId,
    async pay(p: PayInstruction) {
      const { actionCreators } = await import("@near-wallet-selector/core");
      const call = (method: string, args: object, deposit: bigint) => actionCreators.functionCall(method, args, GAS, deposit);
      // 1Click takes NEAR as wNEAR: wrap and send in the same transaction. Every token transfer first
      // registers the one-time deposit account on the token (storage_deposit refunds if already registered).
      const token = p.contract ?? "wrap.near";
      const actions = [
        ...(p.contract ? [] : [call("storage_deposit", { account_id: accountId, registration_only: true }, STORAGE_DEPOSIT), call("near_deposit", {}, BigInt(p.amount))]),
        call("storage_deposit", { account_id: p.to, registration_only: true }, STORAGE_DEPOSIT),
        call("ft_transfer", { receiver_id: p.to, amount: p.amount, ...(p.memo ? { memo: p.memo } : {}) }, 1n),
      ];
      const outcome = (await wallet.signAndSendTransaction({ signerId: accountId, receiverId: token, actions })) as
        | { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: { Failure?: unknown } }
        | undefined;
      if (outcome?.status?.Failure) throw new Error(`The transaction failed on NEAR: ${JSON.stringify(outcome.status.Failure).slice(0, 160)}`);
      const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
      if (!hash) throw new Error("The wallet did not return the transaction.");
      return hash;
    },
  };
}
