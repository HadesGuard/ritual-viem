// The hero action: wait for the terminal phase of an async flow and return the
// decoded result. Accepts ANY phase hash (request, commit, settle, delivery).
//
// Short-async (SPC) flows terminate at the settle: the result payload is inline
// on the request tx (spcCalls[0].output). Two-phase flows terminate at the
// delivery tx: the payload is deliverySpcCalls[0].output, with the system events
// on the delivery receipt carrying the success flag.
import type { Client } from 'viem'
import type { Hash, Hex, RitualChainConfig } from '../protocol/index.js'
import { AsyncDeliveryFailedError, AsyncFlowTimeoutError } from '../errors.js'
import { createFlowCache, getAsyncFlow, type AsyncFlow, type FlowCache } from './getAsyncFlow.js'
import { getTransactionReceiptSafe } from './receipt.js'
import { decodeRitualLog, type RitualDecodedLog } from './decodeRitualLog.js'
import type { RitualScanClient } from '../accelerator/ritualscan.js'
import type { AsyncPhase } from '../protocol/index.js'

export interface AsyncResult {
  flow: AsyncFlow
  /** Terminal phase reached: 'delivered' for two-phase flows, 'settled' for SPC flows. */
  status: 'delivered' | 'settled'
  /** The precompile result payload (SPC output), when the node exposes it. */
  result: Hex | null
  /** Success flag from the Delivered / ResultDelivered / Settled system events; null if unseen. */
  success: boolean | null
  /** The terminal tx (delivery for two-phase, settle for SPC). */
  terminalTx: Hash
  /** Decoded system events on the terminal receipt (best effort; empty off-tip). */
  logs: RitualDecodedLog[]
}

export interface WaitForAsyncResultParameters {
  /** Any phase hash of the flow. */
  hash: Hash
  /** Known block number of `hash` (required for txs outside the by-hash window). */
  blockNumber?: bigint
  /** Milliseconds between resolution polls. Default 1_000 (~3 blocks). */
  pollingInterval?: number
  /** Give up after this many milliseconds. Default 300_000. */
  timeout?: number
  /** Called once per newly observed phase, in lifecycle order. */
  onPhase?: (phase: AsyncPhase, flow: AsyncFlow) => void
  config?: RitualChainConfig
  accelerator?: RitualScanClient
  /** Throw AsyncDeliveryFailedError when the delivery reports success=false. Default true. */
  throwOnFailure?: boolean
}

const PHASE_ORDER: AsyncPhase[] = ['request', 'commit', 'settle', 'delivery']

/**
 * Wait until the async flow that `hash` belongs to reaches its terminal phase,
 * then return the decoded result. Never resolves on a partial flow: rejects with
 * AsyncFlowTimeoutError (carrying the partial flow) on timeout.
 */
export async function waitForAsyncResult(
  client: Client,
  parameters: WaitForAsyncResultParameters,
): Promise<AsyncResult> {
  const {
    hash,
    blockNumber,
    pollingInterval = 1_000,
    timeout = 300_000,
    onPhase,
    config,
    accelerator,
    throwOnFailure = true,
  } = parameters
  const cache: FlowCache = createFlowCache()
  const deadline = Date.now() + timeout
  const seenPhases = new Set<AsyncPhase>()
  let lastFlow: AsyncFlow | null = null

  for (;;) {
    let flow: AsyncFlow | null = null
    try {
      flow = await getAsyncFlow(client, { hash, blockNumber, config, cache, accelerator })
    } catch (error) {
      // A fresh tx may not be visible yet; keep polling until the deadline.
      if (Date.now() >= deadline) throw error
    }
    if (flow) {
      lastFlow = flow
      if (onPhase) {
        for (const phase of PHASE_ORDER) {
          if (flow[phase] && !seenPhases.has(phase)) {
            seenPhases.add(phase)
            onPhase(phase, flow)
          }
        }
      }
      const terminal = terminalOf(flow)
      if (terminal) {
        const outcome = await finalize(client, flow, terminal)
        if (throwOnFailure && outcome.success === false) throw new AsyncDeliveryFailedError(flow)
        return outcome
      }
    }
    if (Date.now() >= deadline) throw new AsyncFlowTimeoutError(hash, timeout, lastFlow)
    await new Promise((resolve) => setTimeout(resolve, pollingInterval))
    // Force re-reads of flow-relevant state on the next resolution round while
    // keeping fetched historical blocks: only the flows index is rebuilt.
    cache.flows.clear()
    cache.hashIndex.clear()
    // Historical blocks are immutable, but the tip block we read while the flow
    // was in progress may have been mid-import: drop the newest cached block.
    const newest = [...cache.blocks.keys()].sort((a, b) => (a < b ? -1 : 1)).pop()
    if (newest !== undefined) cache.blocks.delete(newest)
  }
}

function terminalOf(flow: AsyncFlow): { phase: 'delivered' | 'settled'; tx: Hash; blockNumber: bigint | null } | null {
  if (flow.isTwoPhase) {
    return flow.delivery ? { phase: 'delivered', tx: flow.delivery.hash, blockNumber: flow.delivery.blockNumber } : null
  }
  return flow.settle ? { phase: 'settled', tx: flow.settle.hash, blockNumber: flow.settle.blockNumber } : null
}

async function finalize(
  client: Client,
  flow: AsyncFlow,
  terminal: { phase: 'delivered' | 'settled'; tx: Hash; blockNumber: bigint | null },
): Promise<AsyncResult> {
  const receipt = await getTransactionReceiptSafe(client, {
    hash: terminal.tx,
    blockNumber: terminal.blockNumber ?? undefined,
  }).catch(() => null)
  const logs = (receipt?.logs ?? [])
    .map((log) => decodeRitualLog(log))
    .filter((decoded): decoded is RitualDecodedLog => decoded !== null)
  let success: boolean | null = null
  for (const decoded of logs) {
    if (
      (decoded.name === 'Delivered' || decoded.name === 'ResultDelivered' || decoded.name === 'Settled') &&
      typeof decoded.args.success === 'boolean'
    ) {
      success = decoded.args.success
      if (decoded.name === 'Delivered') break
    }
  }
  const result =
    terminal.phase === 'delivered'
      ? (flow.deliverySpcOutput ?? longRunningResult(logs))
      : flow.requestSpcOutput
  return { flow, status: terminal.phase, result, success, terminalTx: terminal.tx, logs }
}

function longRunningResult(logs: RitualDecodedLog[]): Hex | null {
  const hit = logs.find((decoded) => decoded.name === 'LongRunningResultDelivered')
  const result = hit?.args.result
  return typeof result === 'string' ? (result as Hex) : null
}
