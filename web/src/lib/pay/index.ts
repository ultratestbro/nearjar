import { connectEvmPayer } from "./evm";
import type { Payer } from "./types";

export { familyOf, type PayInstruction, type Payer } from "./types";

/** Chain families a donor can pay from with a connected wallet, in rollout order. */
export const PAYERS: Record<string, { label: string; connect: () => Promise<Payer> }> = {
  evm: { label: "EVM wallet", connect: connectEvmPayer },
};
