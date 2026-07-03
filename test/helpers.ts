// Shared fixture loading + a stub viem transport that replays recorded RPC
// responses, so the default test mode is deterministic and network-free.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, custom, defineChain, type PublicClient } from 'viem'
import { formatters } from '../src/chains/formatters.js'

export interface Fixtures {
  blocks: Record<string, { number: string; transactions: Record<string, unknown>[] }>
  meta: {
    flowA: Record<string, string | number>
    flowB: Record<string, string | number>
  }
  deliveryBlockReceipts: { transactionHash: string; logs: RawLog[] }[]
  commitBlockReceipts: { transactionHash: string; logs: RawLog[] }[]
  requestBlockReceipts: { transactionHash: string; logs: RawLog[] }[]
  sovereignJobAddedLog: RawLog
}

interface RawLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'r4-fixtures.json'), 'utf8'))
}

/** All receipts in the fixture set, keyed by tx hash. */
function receiptIndex(fixtures: Fixtures) {
  const all = [
    ...(fixtures.deliveryBlockReceipts ?? []),
    ...(fixtures.commitBlockReceipts ?? []),
    ...(fixtures.requestBlockReceipts ?? []),
  ]
  return new Map(all.map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]))
}

/** Stub EIP-1193 provider replaying the recorded fixture responses. */
export function fixtureTransport(fixtures: Fixtures) {
  const receipts = receiptIndex(fixtures)
  const logsByTx = [...receipts.values()].flatMap((receipt) => receipt.logs ?? [])
  return custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_getBlockByNumber': {
          const n = String(parseInt(params?.[0] as string, 16))
          return fixtures.blocks[n] ?? null
        }
        case 'eth_getTransactionByHash': {
          const hash = (params?.[0] as string).toLowerCase()
          for (const block of Object.values(fixtures.blocks)) {
            const tx = block.transactions.find(
              (t) => String((t as { hash?: string }).hash).toLowerCase() === hash,
            )
            if (tx) return tx
          }
          return null
        }
        case 'eth_getTransactionReceipt':
          return receipts.get((params?.[0] as string).toLowerCase()) ?? null
        case 'eth_getBlockReceipts': {
          const n = parseInt(params?.[0] as string, 16)
          const matches = [...receipts.values()].filter((receipt) =>
            receipt.logs?.some((log) => parseInt(log.blockNumber, 16) === n),
          )
          return matches.length ? matches : []
        }
        case 'eth_getLogs': {
          const filter = params?.[0] as {
            address?: string | string[]
            topics?: (string | string[] | null)[]
            fromBlock?: string
            toBlock?: string
          }
          const addresses = (Array.isArray(filter.address) ? filter.address : [filter.address])
            .filter(Boolean)
            .map((a) => a!.toLowerCase())
          const from = filter.fromBlock ? parseInt(filter.fromBlock, 16) : 0
          const to = filter.toBlock ? parseInt(filter.toBlock, 16) : Number.MAX_SAFE_INTEGER
          return logsByTx.filter((log) => {
            const blockNumber = parseInt(log.blockNumber, 16)
            if (blockNumber < from || blockNumber > to) return false
            if (addresses.length && !addresses.includes(log.address.toLowerCase())) return false
            const topics = filter.topics ?? []
            return topics.every((want, i) => {
              if (want === null || want === undefined) return true
              const got = log.topics[i]?.toLowerCase()
              return Array.isArray(want)
                ? want.some((w) => w.toLowerCase() === got)
                : want.toLowerCase() === got
            })
          })
        }
        case 'eth_blockNumber': {
          const max = Math.max(...Object.keys(fixtures.blocks).map(Number))
          return '0x' + max.toString(16)
        }
        default:
          throw new Error(`fixtureTransport: unstubbed method ${method}`)
      }
    },
  })
}

export const testChain = /* @__PURE__ */ defineChain({
  id: 1979,
  name: 'Ritual Testnet (fixtures)',
  nativeCurrency: { name: 'RITUAL', symbol: 'RITUAL', decimals: 18 },
  rpcUrls: { default: { http: ['http://fixtures.invalid'] } },
  formatters,
})

export function fixtureClient(fixtures: Fixtures): PublicClient {
  return createPublicClient({
    chain: testChain,
    transport: fixtureTransport(fixtures),
  }) as unknown as PublicClient
}
