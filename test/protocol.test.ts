// Pure protocol layer against REAL recorded chain data: quantity parsing with the
// gas sentinel, tx normalization, phase classification, and contribution merging.
import { describe, expect, it } from 'vitest'
import {
  SYSTEM_GAS_SENTINEL,
  asyncFlowContribution,
  asyncPhase,
  gasQuantity,
  mergeAsyncContributions,
  parseQuantity,
  parseRitualTransaction,
  precompileId,
  precompileLabel,
  isTwoPhasePrecompile,
  type MergedAsyncFlow,
  type RawRitualRpcTransaction,
} from '../src/protocol/index.js'
import { loadFixtures } from './helpers.js'

const fixtures = loadFixtures()
const flowA = fixtures.meta.flowA
const flowB = fixtures.meta.flowB

function txOf(blockNumber: string | number, hash: string): RawRitualRpcTransaction {
  const block = fixtures.blocks[String(blockNumber)]!
  return block.transactions.find(
    (t) => String((t as { hash?: string }).hash).toLowerCase() === hash.toLowerCase(),
  ) as RawRitualRpcTransaction
}

describe('parseQuantity / gasQuantity', () => {
  it('parses hex quantities', () => {
    expect(parseQuantity('0x2baf524c400')).toBe(3002000000000n)
  })
  it('parses bare JSON numbers (Ritual serves some fields unhexed)', () => {
    expect(parseQuantity(40793058)).toBe(40793058n)
  })
  it('returns null on malformed input instead of throwing', () => {
    expect(parseQuantity('0x')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('nope')).toBeNull()
    expect(parseQuantity(Number.POSITIVE_INFINITY)).toBeNull()
  })
  it('recovers the exact 2^64-1 system gas from the JSON.parse-rounded double', () => {
    // JSON.parse turns 18446744073709551615 into 18446744073709552000.
    const { gas, isSystemGasSentinel } = gasQuantity(18446744073709552000)
    expect(gas).toBe(SYSTEM_GAS_SENTINEL)
    expect(gas).toBe(18446744073709551615n)
    expect(isSystemGasSentinel).toBe(true)
  })
  it('leaves normal gas untouched', () => {
    const { gas, isSystemGasSentinel } = gasQuantity('0x5208')
    expect(gas).toBe(21000n)
    expect(isSystemGasSentinel).toBe(false)
  })
})

describe('parseRitualTransaction on real chain data', () => {
  it('parses the settle (0x12) system tx of flow A', () => {
    const tx = parseRitualTransaction(txOf(flowA.settleBlock!, flowA.settle as string))
    expect(tx.typeCode).toBe(18)
    expect(tx.typeName).toBe('asyncSettlement')
    expect(tx.isSystem).toBe(true)
    expect(tx.gas).toBe(SYSTEM_GAS_SENTINEL)
    expect(tx.isSystemGasSentinel).toBe(true)
    expect(tx.async?.originTx).toBe(flowA.request)
    expect(tx.async?.totalAmount).toBeTypeOf('bigint')
    expect(tx.async?.settlementBlock).toBe(BigInt(flowA.settleBlock as number))
  })

  it('parses the request (user tx with async pointers + inline SPC result)', () => {
    const tx = parseRitualTransaction(txOf(flowA.requestBlock!, flowA.request as string))
    expect(tx.typeCode).toBe(2)
    expect(tx.isSystem).toBe(false)
    expect(tx.async?.commitmentTx).toBe(flowA.commit)
    expect(tx.async?.settlementTx).toBe(flowA.settle)
    expect(tx.async?.spcCall?.address).toBe(flowA.family)
    expect(tx.async?.spcCall?.output).toMatch(/^0x/)
  })

  it('parses the commit (0x11) system tx', () => {
    const tx = parseRitualTransaction(txOf(flowA.commitBlock!, flowA.commit as string))
    expect(tx.typeCode).toBe(17)
    expect(tx.typeName).toBe('asyncCommitment')
    expect(tx.input.toLowerCase().startsWith('0x57528d89')).toBe(true)
  })

  it('parses the delivery (0x12 with delivery selector) system tx', () => {
    const tx = parseRitualTransaction(txOf(flowB.deliveryBlock!, flowB.delivery as string))
    expect(tx.typeCode).toBe(18)
    expect(tx.input.toLowerCase().startsWith('0x20b48f49')).toBe(true)
    expect(tx.async?.hasDeliverySpc).toBe(true)
    expect(tx.async?.deliverySpcCall?.address).toBe(flowB.family)
  })
})

describe('asyncPhase', () => {
  it('classifies all four phases from real txs', () => {
    expect(asyncPhase(parseRitualTransaction(txOf(flowA.requestBlock!, flowA.request as string)))).toBe('request')
    expect(asyncPhase(parseRitualTransaction(txOf(flowA.commitBlock!, flowA.commit as string)))).toBe('commit')
    expect(asyncPhase(parseRitualTransaction(txOf(flowA.settleBlock!, flowA.settle as string)))).toBe('settle')
    expect(asyncPhase(parseRitualTransaction(txOf(flowB.deliveryBlock!, flowB.delivery as string)))).toBe('delivery')
  })
  it('returns null for a plain tx with no async fields', () => {
    const plain = parseRitualTransaction({ hash: '0x' + 'ab'.repeat(32), type: '0x2', gas: '0x5208' })
    expect(asyncPhase(plain)).toBeNull()
  })
})

describe('asyncFlowContribution + mergeAsyncContributions', () => {
  it('merges the four phases into one flow keyed by origin, settle owning fees', () => {
    let merged: MergedAsyncFlow | null = null
    for (const [block, hash] of [
      [flowA.requestBlock, flowA.request],
      [flowA.commitBlock, flowA.commit],
      [flowA.settleBlock, flowA.settle],
    ] as [number, string][]) {
      const contribution = asyncFlowContribution(parseRitualTransaction(txOf(block, hash)))
      expect(contribution).not.toBeNull()
      expect(contribution!.origin).toBe(flowA.request)
      merged = mergeAsyncContributions(merged, contribution!)
    }
    expect(merged!.request).toBe(flowA.request)
    expect(merged!.commit).toBe(flowA.commit)
    expect(merged!.settle).toBe(flowA.settle)
    expect(merged!.totalAmount).toBeTypeOf('bigint')
    expect(merged!.requestSpcOutput).toMatch(/^0x/)
    expect(merged!.phaseBlocks.request).toBe(BigInt(flowA.requestBlock as number))
    expect(merged!.phaseBlocks.commit).toBe(BigInt(flowA.commitBlock as number))
  })

  it('a later phase never clobbers an earlier authoritative value', () => {
    const settle = asyncFlowContribution(parseRitualTransaction(txOf(flowA.settleBlock!, flowA.settle as string)))!
    let merged = mergeAsyncContributions(null, settle)
    const before = merged.totalAmount
    // Re-merging a request contribution (all fee columns null) must not clear fees.
    const request = asyncFlowContribution(parseRitualTransaction(txOf(flowA.requestBlock!, flowA.request as string)))!
    merged = mergeAsyncContributions(merged, request)
    expect(merged.totalAmount).toBe(before)
  })
})

describe('precompile registry', () => {
  it('maps full addresses to 2-byte ids and labels', () => {
    expect(precompileId(flowA.family as string)).toBe('0x081b')
    expect(precompileLabel('0x081b')).toBe('DKMS Key')
    expect(precompileId('0x532f0df0896f353d8c3dd8cc134e8129da2a3948')).toBeNull()
  })
  it('classifies two-phase vs settle-only families (verified against real flows)', () => {
    // Flow A (DKMS) completed at settle with an inline SPC result: short-async.
    expect(isTwoPhasePrecompile('0x081b')).toBe(false)
    // Flow B (ZK) completed with a delivery tx 100 blocks later: two-phase.
    expect(isTwoPhasePrecompile('0x0806')).toBe(true)
  })
})
