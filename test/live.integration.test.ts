// Live testnet integration (RITUAL_LIVE=1). Verifies the recorded assumptions
// still hold against the real chain: the gas-overflow behavior, formatter
// output, and flow resolution near the tip. Tolerant of transient RPC failures.
import { describe, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { ritualTestnet } from '../src/chains/index.js'
import { getAsyncFlow } from '../src/actions/getAsyncFlow.js'
import { SYSTEM_GAS_SENTINEL } from '../src/protocol/index.js'

const RPC = process.env.RITUAL_RPC ?? 'https://scanner-rpc.ritualfoundation.org'

const client = createPublicClient({
  chain: ritualTestnet,
  transport: http(RPC, { retryCount: 3 }),
})

interface LiveTx {
  hash: `0x${string}`
  input: string
  typeCode?: number
  isSystemTransaction?: boolean
  gas: bigint
  isSystemGasSentinel?: boolean
}

async function scanRecentBlocks(
  span: bigint,
  match: (tx: LiveTx) => boolean,
): Promise<{ tx: LiveTx; blockNumber: bigint } | null> {
  const tip = await client.getBlockNumber()
  for (let n = tip - 2n; n > tip - span; n--) {
    const block = await client.getBlock({ blockNumber: n, includeTransactions: true })
    for (const raw of block.transactions) {
      if (typeof raw === 'string') continue
      const tx = raw as unknown as LiveTx
      if (match(tx)) return { tx, blockNumber: n }
    }
  }
  return null
}

describe('live testnet', () => {
  it('parses blocks containing system txs with the exact gas sentinel', async () => {
    const found = await scanRecentBlocks(400n, (tx) => tx.isSystemTransaction === true)
    expect(found).not.toBeNull()
    const tx = (await client.getTransaction({ hash: found!.tx.hash })) as unknown as LiveTx
    expect(tx.gas).toBe(SYSTEM_GAS_SENTINEL)
    expect(tx.isSystemGasSentinel).toBe(true)
  }, 120_000)

  it('normalizes block timestamps to seconds', async () => {
    const block = (await client.getBlock()) as unknown as { timestamp: bigint; timestampMs?: bigint }
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(block.timestamp).toBeGreaterThan(now - 3600n)
    expect(block.timestamp).toBeLessThan(now + 3600n)
    expect(block.timestampMs!).toBeGreaterThan(10n ** 12n)
  }, 60_000)

  it('resolves a live async flow end to end from a recent settle tx', async () => {
    const found = await scanRecentBlocks(
      2000n,
      (tx) => tx.typeCode === 18 && tx.input.toLowerCase().startsWith('0x0aa4dd19'),
    )
    expect(found).not.toBeNull()
    const flow = await getAsyncFlow(client, { hash: found!.tx.hash, blockNumber: found!.blockNumber })
    expect(flow).not.toBeNull()
    expect(flow!.phaseOf).toBe('settle')
    expect(flow!.request).not.toBeNull()
    expect(flow!.commit).not.toBeNull()
    expect(flow!.fees?.totalAmount).toBeTypeOf('bigint')
  }, 120_000)
})
