// Client decorator, viem/op-stack style: client.extend(ritualActions()).
import type { Account, Chain, Client, Transport } from 'viem'
import type { RitualChainConfig } from '../protocol/index.js'
import { getAsyncFlow, type AsyncFlow, type GetAsyncFlowParameters } from './getAsyncFlow.js'
import { waitForAsyncResult, type AsyncResult, type WaitForAsyncResultParameters } from './waitForAsyncResult.js'
import {
  getTransactionReceiptSafe,
  waitForTransactionReceiptSafe,
  type GetTransactionReceiptSafeParameters,
  type RitualTransactionReceipt,
  type WaitForTransactionReceiptSafeParameters,
} from './receipt.js'

// NOTE: a type literal (not an interface) so it satisfies viem's extend()
// constraint, which requires an implicit string index signature.
export type RitualActions = {
  getAsyncFlow(parameters: GetAsyncFlowParameters): Promise<AsyncFlow | null>
  waitForAsyncResult(parameters: WaitForAsyncResultParameters): Promise<AsyncResult>
  getTransactionReceiptSafe(
    parameters: GetTransactionReceiptSafeParameters,
  ): Promise<RitualTransactionReceipt | null>
  waitForTransactionReceiptSafe(
    parameters: WaitForTransactionReceiptSafeParameters,
  ): Promise<RitualTransactionReceipt>
}

/**
 * Ritual actions decorator:
 *
 *   const client = createPublicClient({ chain: ritualTestnet, transport: http() })
 *     .extend(ritualActions())
 *
 * Pass an explicit config to target a custom Ritual deployment; by default the
 * client chain's id resolves against the known Ritual chain configs.
 */
export function ritualActions(config?: RitualChainConfig) {
  return <
    transport extends Transport,
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined,
  >(
    client: Client<transport, chain, account>,
  ): RitualActions => ({
    getAsyncFlow: (parameters) => getAsyncFlow(client as Client, { config, ...parameters }),
    waitForAsyncResult: (parameters) => waitForAsyncResult(client as Client, { config, ...parameters }),
    getTransactionReceiptSafe: (parameters) => getTransactionReceiptSafe(client as Client, parameters),
    waitForTransactionReceiptSafe: (parameters) => waitForTransactionReceiptSafe(client as Client, parameters),
  })
}
