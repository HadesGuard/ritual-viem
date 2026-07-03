// Optional accelerator over the RitualScan Etherscan-compatible API. Used only to
// LOCATE transactions the public RPC has pruned from by-hash lookups; correctness
// never depends on it and RPC-only mode is the tested default.
import { parseQuantity, ritualTestnetConfig, type Hash } from '../protocol/index.js'

export interface RitualScanClient {
  /** Block number of a tx by hash, or null when the index does not know it. */
  getTransactionBlockNumber(hash: Hash): Promise<bigint | null>
}

/**
 * Create a RitualScan API accelerator. Defaults to the public RitualScan index
 * for Ritual testnet. Any Etherscan-compatible API root works.
 */
export function createRitualScanClient(
  baseUrl: string = ritualTestnetConfig.explorer.apiUrl ?? '',
): RitualScanClient {
  const root = baseUrl.replace(/\/$/, '')
  return {
    async getTransactionBlockNumber(hash) {
      if (!root) return null
      const url = `${root}?module=proxy&action=eth_getTransactionByHash&txhash=${hash}`
      const response = await fetch(url)
      if (!response.ok) return null
      const json = (await response.json().catch(() => null)) as {
        result?: { blockNumber?: string } | null
      } | null
      return parseQuantity(json?.result?.blockNumber)
    },
  }
}
