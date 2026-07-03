// Typed failures. Every off-tip / pruned case is an explicit error carrying a
// remediation hint, never a silent null.
import type { AsyncPhase, Hash } from './protocol/index.js'
import type { AsyncFlow } from './actions/getAsyncFlow.js'

export class RitualViemError extends Error {
  override name = 'RitualViemError'
}

export class UnknownRitualChainError extends RitualViemError {
  override name = 'UnknownRitualChainError'
  constructor(chainId: number | undefined) {
    super(
      `No Ritual protocol config for chainId ${chainId}. ` +
        'Pass { config } explicitly or use a client whose chain is a known Ritual chain.',
    )
  }
}

export class TransactionOffTipError extends RitualViemError {
  override name = 'TransactionOffTipError'
  hash: Hash
  constructor(hash: Hash) {
    super(
      `Cannot locate the block of ${hash}: the transaction is either not mined yet, or ` +
        'by-hash lookups are pruned for it on Ritual public RPCs (they only serve a recent window). ' +
        'For historical transactions pass { blockNumber } if you know it, or pass an ' +
        '{ accelerator } (createRitualScanClient()) to resolve it from the RitualScan index.',
    )
    this.hash = hash
  }
}

export class AsyncFlowTimeoutError extends RitualViemError {
  override name = 'AsyncFlowTimeoutError'
  /** Whatever part of the flow was resolved before the timeout. */
  flow: AsyncFlow | null
  constructor(hash: Hash, timeout: number, flow: AsyncFlow | null) {
    super(
      `Timed out after ${timeout}ms waiting for the async result of ${hash}` +
        (flow ? ` (resolved so far: ${describeProgress(flow)})` : ' (no flow resolved)'),
    )
    this.flow = flow
  }
}

export class AsyncDeliveryFailedError extends RitualViemError {
  override name = 'AsyncDeliveryFailedError'
  flow: AsyncFlow
  constructor(flow: AsyncFlow) {
    super(
      `Async delivery for origin ${flow.origin} reported success=false` +
        (flow.delivery ? ` (delivery tx ${flow.delivery.hash})` : ''),
    )
    this.flow = flow
  }
}

export class NotAsyncTransactionError extends RitualViemError {
  override name = 'NotAsyncTransactionError'
  constructor(hash: Hash) {
    super(`${hash} is not part of a Ritual async flow (no request/commit/settle/delivery phase found).`)
  }
}

function describeProgress(flow: AsyncFlow): string {
  const phases: AsyncPhase[] = ['request', 'commit', 'settle', 'delivery']
  return phases.map((p) => `${p}=${flow[p] ? 'yes' : 'no'}`).join(' ')
}
