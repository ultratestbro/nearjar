import { connectBtcPayer } from "./btc";
import { connectNearPayer } from "./near";
import { connectTonPayer } from "./ton";
import { connectTronPayer } from "./tron";
import type { Payer } from "./types";

export { familyOf, type PayInstruction, type Payer } from "./types";

export { evmPayer } from "./evm";
export { solanaPayer } from "./solana";

/**
 * Chain families whose wallets connect here, per payment. EVM and Solana wallets come from the
 * shared wallet picker (WalletProvider) instead, so a donor picks MetaMask / Phantom by logo once.
 */
export const PAYERS: Record<string, { label: string; connect: () => Promise<Payer> }> = {
  tron: { label: "TronLink", connect: connectTronPayer },
  ton: { label: "TON wallet", connect: connectTonPayer },
  near: { label: "NEAR wallet (Meteor)", connect: () => connectNearPayer("meteor-wallet") },
  bitcoin: { label: "Bitcoin wallet", connect: connectBtcPayer },
};
