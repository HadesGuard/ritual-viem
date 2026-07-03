// Chain formatters through viem's real formatting pipeline (getBlock and
// getTransaction against a stub transport replaying recorded responses).
import { describe, expect, it } from 'vitest'
import { SYSTEM_GAS_SENTINEL, type RitualAsyncFields } from '../src/protocol/index.js'
import { fixtureClient, loadFixtures } from './helpers.js'

const fixtures = loadFixtures()
const flowA = fixtures.meta.flowA
const client = fixtureClient(fixtures)

interface FormattedTx {
  hash: string
  type?: string
  gas?: bigint
  isSystemGasSentinel?: boolean
  isSystemTransaction?: boolean
  ritual?: RitualAsyncFields
}

interface FormattedBlock {
  timestamp: bigint
  timestampMs?: bigint
  transactions: (FormattedTx | string)[]
}

async function getBlock(blockNumber: number): Promise<FormattedBlock> {
  return (await client.getBlock({
    blockNumber: BigInt(blockNumber),
    includeTransactions: true,
  })) as unknown as FormattedBlock
}

async function getTx(hash: string): Promise<FormattedTx> {
  return (await client.getTransaction({ hash: hash as `0x${string}` })) as unknown as FormattedTx
}

describe('ritual chain formatters', () => {
  it('getBlock: normalizes ms timestamps to seconds and keeps timestampMs', async () => {
    const block = await getBlock(flowA.requestBlock as number)
    expect(block.timestamp).toBeLessThan(10n ** 12n)
    expect(block.timestampMs!).toBeGreaterThan(10n ** 12n)
    expect(block.timestampMs! / 1000n).toBe(block.timestamp)
  })

  it('getBlock: embedded system txs carry the exact gas sentinel and named type', async () => {
    const block = await getBlock(flowA.settleBlock as number)
    const settle = block.transactions.find(
      (tx): tx is FormattedTx => typeof tx !== 'string' && tx.hash === flowA.settle,
    )!
    expect(settle.type).toBe('asyncSettlement')
    expect(settle.gas).toBe(SYSTEM_GAS_SENTINEL)
    expect(settle.isSystemGasSentinel).toBe(true)
    expect(settle.isSystemTransaction).toBe(true)
    expect(settle.ritual?.originTx).toBe(flowA.request)
    expect(settle.ritual?.totalAmount).toBeTypeOf('bigint')
  })

  it('getTransaction: by-hash path applies the same overrides', async () => {
    const tx = await getTx(flowA.settle as string)
    expect(tx.gas).toBe(SYSTEM_GAS_SENTINEL)
    expect(tx.ritual?.commitmentTx).toBe(flowA.commit)
  })

  it('getTransaction: user txs keep standard viem semantics plus ritual fields', async () => {
    const tx = await getTx(flowA.request as string)
    expect(tx.type).toBe('eip1559')
    expect(tx.isSystemTransaction).toBeUndefined()
    expect(tx.ritual?.settlementTx).toBe(flowA.settle)
    expect(tx.ritual?.spcCall?.output).toMatch(/^0x/)
  })
})
