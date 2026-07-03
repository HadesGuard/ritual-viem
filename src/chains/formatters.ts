// Chain formatters that make vanilla viem safe on Ritual:
// - system tx gas (2^64-1, served as a lossy JSON number) becomes the exact
//   SYSTEM_GAS_SENTINEL with an isSystemGasSentinel flag, never the rounded value
// - block timestamps (served in MILLISECONDS) are normalized to seconds, with the
//   original preserved as timestampMs
// - Ritual tx types get names ('scheduled' / 'asyncCommitment' / 'asyncSettlement')
//   and the async custom fields (commitmentTx, spcCalls fees, ...) are surfaced
//   as typed values instead of raw pass-through strings
//
// Follows the viem/op-stack extension pattern: defineTransaction/defineBlock
// compose ON TOP of viem's default formatters. NOTE the default block formatter
// maps embedded transactions with the plain formatTransaction, so the block
// formatter here re-maps them with the Ritual overrides applied (same reason
// op-stack's block formatter does its own transactions mapping).
import { defineBlock, defineTransaction, formatTransaction } from 'viem'
import {
  extractAsyncFields,
  gasQuantity,
  parseIntQuantity,
  parseQuantity,
  txTypeName,
  type RawRitualRpcTransaction,
} from '../protocol/index.js'
import type { Hex } from '../protocol/index.js'

const MS_FLOOR = 10n ** 12n

function ritualTxOverrides(tx: RawRitualRpcTransaction) {
  const typeCode = parseIntQuantity(tx.type) ?? 0
  const out: Record<string, unknown> = {}
  if (typeCode >= 16) {
    out.type = txTypeName(typeCode)
    out.typeCode = typeCode
    out.isSystemTransaction = true
  }
  if (typeof tx.gas === 'number' && !Number.isSafeInteger(tx.gas)) {
    const { gas, isSystemGasSentinel } = gasQuantity(tx.gas)
    out.gas = gas
    out.isSystemGasSentinel = isSystemGasSentinel
  }
  const async = extractAsyncFields(tx, typeCode)
  if (async) out.ritual = async
  if (tx.precompileAddress != null) out.precompileAddress = tx.precompileAddress
  if (tx.callId != null) out.callId = parseQuantity(tx.callId)
  return out
}

export const formatters = {
  transaction: /* @__PURE__ */ defineTransaction({
    format: (tx: RawRitualRpcTransaction) => ritualTxOverrides(tx) as never,
  }),
  block: /* @__PURE__ */ defineBlock({
    format(block: { timestamp?: Hex | number; transactions?: (RawRitualRpcTransaction | Hex)[] }) {
      const raw = parseQuantity(block.timestamp) ?? 0n
      const isMs = raw > MS_FLOOR
      return {
        timestamp: isMs ? raw / 1000n : raw,
        timestampMs: isMs ? raw : raw * 1000n,
        transactions: block.transactions?.map((tx) =>
          typeof tx === 'string' ? tx : { ...formatTransaction(tx as never), ...ritualTxOverrides(tx) },
        ),
      } as never
    },
  }),
} as const

/**
 * op-stack-style bundle to spread into a hand-rolled defineChain call:
 *   defineChain({ ...ritualChainConfig, id: ..., rpcUrls: ... })
 */
export const ritualChainConfig = { formatters } as const
