import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import type { PayInstruction, Payer } from "./types";

// Wallets that sign locally broadcast through this node; NearJar never holds NEAR keys.
const NODE = "https://free.rpc.fastnear.com";
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR, the NEP-145 minimum on these tokens
const GAS = 30_000_000_000_000n;

let selector: Promise<WalletSelector> | null = null;

export function getSelector(): Promise<WalletSelector> {
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

let modal: Promise<WalletSelectorModal> | null = null;
let onHide: (() => void) | null = null;

function selectorModal(): Promise<WalletSelectorModal> {
  modal ??= (async () => {
    const [s, { setupModal }] = await Promise.all([getSelector(), import("@near-wallet-selector/modal-ui"), import("@near-wallet-selector/modal-ui/styles.css")]);
    // no contract: NearJar only needs the account and its signatures, never a function-call key
    const m = setupModal(s, { contractId: "", theme: "dark" });
    m.on("onHide", ({ hideReason }) => hideReason === "user-triggered" && onHide?.());
    return m;
  })();
  modal.catch(() => (modal = null));
  return modal;
}

/**
 * Signs in through wallet-selector's modal (Meteor, HERE, Intear — popups, no redirect mid-payment)
 * or, `silent`, only picks up a session it already has.
 */
export async function nearSignIn({ silent = false } = {}) {
  const s = await getSelector();
  const active = () => {
    const st = s.store.getState();
    return st.selectedWalletId ? st.accounts.find((a) => a.active)?.accountId : undefined;
  };
  if (!active()) {
    if (silent) throw new Error("not authorised");
    const m = await selectorModal();
    await new Promise<void>((resolve, reject) => {
      const sub = s.store.observable.subscribe(() => {
        if (!active()) return;
        sub.unsubscribe();
        onHide = null;
        m.hide();
        resolve();
      });
      onHide = () => {
        sub.unsubscribe();
        onHide = null;
        reject(new Error("cancelled"));
      };
      m.show();
    });
  }
  const accountId = active();
  if (!accountId) throw new Error("The wallet returned no NEAR account.");
  const wallet = await s.wallet();
  const meta = s.store.getState().modules.find((x) => x.id === s.store.getState().selectedWalletId)?.metadata;
  return { wallet, accountId, name: meta?.name ?? "NEAR wallet", icon: meta?.iconUrl ?? "" };
}

export async function connectNearPayer(): Promise<Payer> {
  const { wallet, accountId, name } = await nearSignIn();

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
