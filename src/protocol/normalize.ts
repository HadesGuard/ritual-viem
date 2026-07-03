// Parse raw Ritual RPC transactions into a safe, typed shape. This is the
// canonical knowledge of Ritual's custom tx types (0x10 scheduled, 0x11 async
// commitment, 0x12 async settlement/delivery, 0x77 passkey) and the async custom
// fields the node attaches to raw transactions. Works on tx objects from block
// bodies (the durable source once by-hash reads are pruned) and by-hash reads.
import { gasQuantity, parseIntQuantity, parseQuantity } from './hex.js'
import { classifyAgent } from './agents.js'
import { precompileId } from './precompiles.js'
import type { Address, Hash, Hex, ParsedRitualTransaction, RitualAsyncFields } from './types.js'

export const RITUAL_TX_TYPE_NAMES: Record<number, string> = {
  0: 'legacy',
  1: 'eip2930',
  2: 'eip1559',
  3: 'eip4844',
  4: 'eip7702',
  16: 'scheduled',
  17: 'asyncCommitment',
  18: 'asyncSettlement',
  119: 'passkey',
}

/** Human name for a numeric Ritual tx type byte. */
export function txTypeName(typeCode: number): string {
  return RITUAL_TX_TYPE_NAMES[typeCode] ?? `type-${typeCode}`
}

interface RawSpcCall {
  address?: string
  input?: string
  output?: string
}

/** Loose view of a raw Ritual RPC transaction (hex quantities may arrive as JSON numbers). */
export interface RawRitualRpcTransaction {
  hash?: string
  type?: string | number
  blockNumber?: string | number
  transactionIndex?: string | number
  from?: string
  to?: string | null
  value?: string | number
  gas?: string | number
  nonce?: string | number
  input?: string
  gasPrice?: string | number
  maxFeePerGas?: string | number
  maxPriorityFeePerGas?: string | number
  precompileAddress?: string
  callId?: string | number
  index?: string | number
  originTx?: string
  commitmentTx?: string
  settlementTx?: string
  userAddress?: string
  executorAddress?: string
  commitmentValidator?: string
  inclusionValidator?: string
  totalAmount?: string | number
  executorFee?: string | number
  commitmentFee?: string | number
  inclusionFee?: string | number
  settlementBlock?: string | number
  spcCalls?: RawSpcCall[] | null
  deliverySpcCalls?: RawSpcCall[] | null
  [key: string]: unknown
}

function spcEntry(call: RawSpcCall | undefined | null) {
  if (!call || typeof call.address !== 'string') return null
  return {
    address: call.address.toLowerCase() as Address,
    input: typeof call.input === 'string' ? (call.input as Hex) : null,
    output: typeof call.output === 'string' ? (call.output as Hex) : null,
  }
}

/**
 * Extract the Ritual async custom fields off a raw tx, or null when it has none.
 * The four phases carry different subsets: the request (a normal user tx) has
 * commitmentTx/settlementTx plus inline spcCalls, the commit (0x11) and the
 * settle/delivery (0x12) carry the party and fee accounting.
 */
export function extractAsyncFields(tx: RawRitualRpcTransaction, typeCode: number): RitualAsyncFields | null {
  const hasLink = tx.originTx || tx.commitmentTx || tx.settlementTx
  if (!hasLink && typeCode !== 17 && typeCode !== 18) return null
  const spc = Array.isArray(tx.spcCalls) ? spcEntry(tx.spcCalls[0]) : null
  const deliverySpc = Array.isArray(tx.deliverySpcCalls) ? spcEntry(tx.deliverySpcCalls[0]) : null
  return {
    originTx: (tx.originTx as Hash) ?? null,
    commitmentTx: (tx.commitmentTx as Hash) ?? null,
    settlementTx: (tx.settlementTx as Hash) ?? null,
    precompileAddress:
      ((tx.precompileAddress as Address) ?? spc?.address ?? deliverySpc?.address ?? null),
    userAddress: (tx.userAddress as Address) ?? null,
    executorAddress: (tx.executorAddress as Address) ?? null,
    commitmentValidator: (tx.commitmentValidator as Address) ?? null,
    inclusionValidator: (tx.inclusionValidator as Address) ?? null,
    totalAmount: parseQuantity(tx.totalAmount),
    executorFee: parseQuantity(tx.executorFee),
    commitmentFee: parseQuantity(tx.commitmentFee),
    inclusionFee: parseQuantity(tx.inclusionFee),
    settlementBlock: parseQuantity(tx.settlementBlock),
    hasDeliverySpc: Array.isArray(tx.deliverySpcCalls) && tx.deliverySpcCalls.length > 0,
    spcCall: spc,
    deliverySpcCall: deliverySpc,
  }
}

/** Parse one raw Ritual RPC transaction into the typed, quirk-safe shape. */
export function parseRitualTransaction(tx: RawRitualRpcTransaction): ParsedRitualTransaction {
  const typeCode = parseIntQuantity(tx.type) ?? 0
  const { gas, isSystemGasSentinel } = gasQuantity(tx.gas)
  const precompile = tx.precompileAddress
    ? ((('0x' + String(tx.precompileAddress).toLowerCase().replace(/^0x/, '').slice(-4)) as Hex))
    : null
  const to = (tx.to as Address) ?? null
  const input = (tx.input as Hex) ?? '0x'
  const { kind: agentKind, manifest } = classifyAgent(precompile, to, input)
  const blockNumber = parseQuantity(tx.blockNumber)
  return {
    hash: tx.hash as Hash,
    blockNumber,
    transactionIndex: parseIntQuantity(tx.transactionIndex),
    from: (tx.from as Address) ?? null,
    to,
    value: parseQuantity(tx.value) ?? 0n,
    typeCode,
    typeName: txTypeName(typeCode),
    isSystem: typeCode >= 16,
    gas,
    isSystemGasSentinel,
    nonce: parseIntQuantity(tx.nonce),
    input,
    gasPrice: parseQuantity(tx.gasPrice),
    maxFeePerGas: parseQuantity(tx.maxFeePerGas),
    maxPriorityFeePerGas: parseQuantity(tx.maxPriorityFeePerGas),
    precompile,
    callId: parseQuantity(tx.callId),
    schedIndex: tx.index != null ? parseIntQuantity(tx.index) : null,
    agentKind,
    manifest,
    async: extractAsyncFields(tx, typeCode),
  }
}

/** Precompile id of a parsed tx's async flow, from either the tx or its SPC calls. */
export function asyncPrecompileId(tx: ParsedRitualTransaction): Hex | null {
  return tx.precompile ?? precompileId(tx.async?.precompileAddress ?? null)
}
