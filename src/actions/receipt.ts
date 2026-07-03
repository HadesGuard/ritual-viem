// Receipt reads that survive Ritual's quirks without relying on chain formatters:
// raw JSON-RPC via client.request, parsed by a minimal quirk-safe parser. Vanilla
// viem receipt parsing works near the tip, but these actions also fall back to
// eth_getBlockReceipts (served much longer than by-hash receipt lookups) and use
// Ritual-tuned defaults (350ms blocks).
import type { Client } from 'viem'
import { parseIntQuantity, parseQuantity } from '../protocol/index.js'
import type { Address, Hash, Hex } from '../protocol/index.js'

export interface RitualRawLog {
  address: Address
  topics: Hex[]
  data: Hex
  blockNumber: bigint | null
  logIndex: number | null
  transactionHash: Hash | null
}

export interface RitualTransactionReceipt {
  transactionHash: Hash
  blockNumber: bigint | null
  blockHash: Hex | null
  transactionIndex: number | null
  status: 'success' | 'reverted' | null
  from: Address | null
  to: Address | null
  contractAddress: Address | null
  gasUsed: bigint | null
  effectiveGasPrice: bigint | null
  typeHex: Hex | null
  logs: RitualRawLog[]
}

interface RawRpcReceipt {
  transactionHash?: string
  blockNumber?: string | number
  blockHash?: string
  transactionIndex?: string | number
  status?: string
  from?: string
  to?: string | null
  contractAddress?: string | null
  gasUsed?: string | number
  effectiveGasPrice?: string | number
  type?: string
  logs?: {
    address?: string
    topics?: string[]
    data?: string
    blockNumber?: string | number
    logIndex?: string | number
    transactionHash?: string
  }[]
}

function parseReceipt(raw: RawRpcReceipt): RitualTransactionReceipt {
  return {
    transactionHash: raw.transactionHash as Hash,
    blockNumber: parseQuantity(raw.blockNumber),
    blockHash: (raw.blockHash as Hex) ?? null,
    transactionIndex: parseIntQuantity(raw.transactionIndex),
    status: raw.status === '0x1' ? 'success' : raw.status === '0x0' ? 'reverted' : null,
    from: (raw.from as Address) ?? null,
    to: (raw.to as Address) ?? null,
    contractAddress: (raw.contractAddress as Address) ?? null,
    gasUsed: parseQuantity(raw.gasUsed),
    effectiveGasPrice: parseQuantity(raw.effectiveGasPrice),
    typeHex: (raw.type as Hex) ?? null,
    logs: (raw.logs ?? []).map((log) => ({
      address: log.address as Address,
      topics: (log.topics ?? []) as Hex[],
      data: (log.data ?? '0x') as Hex,
      blockNumber: parseQuantity(log.blockNumber),
      logIndex: parseIntQuantity(log.logIndex),
      transactionHash: (log.transactionHash as Hash) ?? null,
    })),
  }
}

export interface GetTransactionReceiptSafeParameters {
  hash: Hash
  /** Known block number: enables the eth_getBlockReceipts fallback off-tip. */
  blockNumber?: bigint
}

/**
 * One safe receipt read. Tries eth_getTransactionReceipt; when that returns null
 * and a blockNumber is known, falls back to eth_getBlockReceipts, which Ritual
 * RPCs keep serving after by-hash lookups are pruned. Returns null when neither
 * source has the receipt (pruned history or not yet mined).
 */
export async function getTransactionReceiptSafe(
  client: Client,
  { hash, blockNumber }: GetTransactionReceiptSafeParameters,
): Promise<RitualTransactionReceipt | null> {
  const raw = (await client.request({
    method: 'eth_getTransactionReceipt',
    params: [hash],
  })) as RawRpcReceipt | null
  if (raw) return parseReceipt(raw)
  if (blockNumber === undefined) return null
  const blockReceipts = (await client
    .request({
      method: 'eth_getBlockReceipts' as never,
      params: ['0x' + blockNumber.toString(16)] as never,
    })
    .catch(() => null)) as RawRpcReceipt[] | null
  if (!Array.isArray(blockReceipts)) return null
  const match = blockReceipts.find((r) => r.transactionHash?.toLowerCase() === hash.toLowerCase())
  return match ? parseReceipt(match) : null
}

export interface WaitForTransactionReceiptSafeParameters {
  hash: Hash
  /** Milliseconds between polls. Ritual blocks land every ~350ms. Default 500. */
  pollingInterval?: number
  /** Give up after this many milliseconds. Default 60_000. */
  timeout?: number
  /** Throw WaitForReceiptRevertedError when the tx reverted. Default true. */
  throwOnRevert?: boolean
}

export class WaitForReceiptTimeoutError extends Error {
  override name = 'WaitForReceiptTimeoutError'
  constructor(hash: Hash, timeout: number) {
    super(`Timed out after ${timeout}ms waiting for receipt of ${hash}`)
  }
}

export class WaitForReceiptRevertedError extends Error {
  override name = 'WaitForReceiptRevertedError'
  receipt: RitualTransactionReceipt
  constructor(receipt: RitualTransactionReceipt) {
    super(`Transaction ${receipt.transactionHash} reverted`)
    this.receipt = receipt
  }
}

/**
 * Poll raw eth_getTransactionReceipt until the tx lands. Never touches viem's
 * block-parsing paths, so it works on any client regardless of chain formatters
 * (the proven replacement for the hand-rolled pollers Ritual dApps carry today).
 */
export async function waitForTransactionReceiptSafe(
  client: Client,
  { hash, pollingInterval = 500, timeout = 60_000, throwOnRevert = true }: WaitForTransactionReceiptSafeParameters,
): Promise<RitualTransactionReceipt> {
  const deadline = Date.now() + timeout
  for (;;) {
    const receipt = await getTransactionReceiptSafe(client, { hash })
    if (receipt) {
      if (throwOnRevert && receipt.status === 'reverted') throw new WaitForReceiptRevertedError(receipt)
      return receipt
    }
    if (Date.now() >= deadline) throw new WaitForReceiptTimeoutError(hash, timeout)
    await new Promise((resolve) => setTimeout(resolve, pollingInterval))
  }
}
