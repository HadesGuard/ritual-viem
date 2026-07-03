// The async request -> commit -> settle -> delivery lifecycle. Every phase points
// back to one origin (the request tx hash); this module classifies a parsed tx's
// phase, builds its authoritative contribution to the flow, and merges phase
// contributions without letting a later phase clobber an earlier one.
import { ritualTestnetConfig } from './config.js'
import { nzAddress, nzHash } from './hex.js'
import { precompileId } from './precompiles.js'
import type { AsyncFlowContribution, AsyncPhase, ParsedRitualTransaction } from './types.js'

const DELIVERY_SELECTOR = ritualTestnetConfig.selectors.delivery

/**
 * The async phase of a parsed tx, or null when it is not part of an async flow.
 *   request  = a normal user tx that carries a commitmentTx pointer (the origin)
 *   commit   = type 0x11 (addJob), posted by the async-commit system account
 *   settle   = type 0x12 with the settle selector (phase-1 settlement)
 *   delivery = type 0x12 with the delivery selector / a delivery SPC result
 */
export function asyncPhase(tx: ParsedRitualTransaction): AsyncPhase | null {
  const sel = (tx.input || '0x').slice(0, 10).toLowerCase()
  if (tx.typeCode === 17) return 'commit'
  if (tx.typeCode === 18) {
    return sel === DELIVERY_SELECTOR || tx.async?.hasDeliverySpc ? 'delivery' : 'settle'
  }
  if (tx.typeCode < 16 && tx.async?.commitmentTx) return 'request'
  return null
}

/**
 * One async tx's contribution to its flow, keyed by `origin`. Each phase fills
 * ONLY the columns it is authoritative for and leaves the rest null, so
 * mergeAsyncContributions folds the phases into one flow without a later phase
 * clobbering an earlier one (e.g. the settle owns the fee accounting).
 */
export function asyncFlowContribution(tx: ParsedRitualTransaction): AsyncFlowContribution | null {
  const phase = asyncPhase(tx)
  if (!phase) return null
  const r = tx.async
  const self = nzHash(tx.hash)
  const origin = phase === 'request' ? self : nzHash(r?.originTx)
  if (!origin || !self) return null

  const c: AsyncFlowContribution = {
    phase,
    origin,
    request: phase === 'request' ? self : nzHash(r?.originTx),
    commit: phase === 'commit' ? self : nzHash(r?.commitmentTx),
    settle: phase === 'settle' ? self : phase === 'request' ? nzHash(r?.settlementTx) : null,
    delivery: phase === 'delivery' ? self : null,
    blockNumber: tx.blockNumber,
    precompileAddress: nzAddress(r?.precompileAddress),
    precompileId: precompileId(r?.precompileAddress ?? null),
    user: null,
    executor: null,
    commitmentValidator: null,
    inclusionValidator: null,
    totalAmount: null,
    executorFee: null,
    commitmentFee: null,
    inclusionFee: null,
    settlementBlock: null,
    requestSpcOutput: null,
    deliverySpcOutput: null,
  }

  if (phase === 'request') {
    c.requestSpcOutput = r?.spcCall?.output ?? null
  } else if (phase === 'commit') {
    c.commitmentValidator = nzAddress(r?.commitmentValidator)
  } else if (phase === 'settle') {
    c.user = nzAddress(r?.userAddress)
    c.executor = nzAddress(r?.executorAddress)
    c.commitmentValidator = nzAddress(r?.commitmentValidator)
    c.inclusionValidator = nzAddress(r?.inclusionValidator)
    c.totalAmount = r?.totalAmount ?? null
    c.executorFee = r?.executorFee ?? null
    c.commitmentFee = r?.commitmentFee ?? null
    c.inclusionFee = r?.inclusionFee ?? null
    c.settlementBlock = r?.settlementBlock ?? null
  } else if (phase === 'delivery') {
    c.user = nzAddress(r?.userAddress)
    c.executor = nzAddress(r?.executorAddress)
    c.deliverySpcOutput = r?.deliverySpcCall?.output ?? null
  }
  return c
}

/** Per-phase block refs accumulated alongside the merged columns. */
export interface MergedAsyncFlow extends Omit<AsyncFlowContribution, 'phase' | 'blockNumber'> {
  phaseBlocks: Partial<Record<AsyncPhase, bigint>>
}

function emptyMerged(origin: AsyncFlowContribution['origin']): MergedAsyncFlow {
  return {
    origin,
    request: null,
    commit: null,
    settle: null,
    delivery: null,
    precompileAddress: null,
    precompileId: null,
    user: null,
    executor: null,
    commitmentValidator: null,
    inclusionValidator: null,
    totalAmount: null,
    executorFee: null,
    commitmentFee: null,
    inclusionFee: null,
    settlementBlock: null,
    requestSpcOutput: null,
    deliverySpcOutput: null,
    phaseBlocks: {},
  }
}

/**
 * COALESCE-merge a phase contribution into an accumulated flow: a column is only
 * filled when it is currently null, so earlier authoritative values survive.
 */
export function mergeAsyncContributions(
  base: MergedAsyncFlow | null,
  next: AsyncFlowContribution,
): MergedAsyncFlow {
  const acc = base ?? emptyMerged(next.origin)
  const keys = [
    'request',
    'commit',
    'settle',
    'delivery',
    'precompileAddress',
    'precompileId',
    'user',
    'executor',
    'commitmentValidator',
    'inclusionValidator',
    'totalAmount',
    'executorFee',
    'commitmentFee',
    'inclusionFee',
    'settlementBlock',
    'requestSpcOutput',
    'deliverySpcOutput',
  ] as const
  for (const key of keys) {
    if (acc[key] === null && next[key] !== null) {
      ;(acc as unknown as Record<string, unknown>)[key] = next[key]
    }
  }
  if (next.blockNumber !== null && acc.phaseBlocks[next.phase] === undefined) {
    acc.phaseBlocks[next.phase] = next.blockNumber
  }
  return acc
}
