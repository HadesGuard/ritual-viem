import { defineChain } from 'viem'
import { ritualTestnetConfig } from '../protocol/index.js'
import { formatters } from './formatters.js'

/**
 * Ritual testnet (chainId 1979) with Ritual formatters attached, so standard viem
 * reads (getBlock, getTransaction, waitForTransactionReceipt) are safe against the
 * chain's system transactions and millisecond timestamps.
 */
export const ritualTestnet = /* @__PURE__ */ defineChain({
  id: 1979,
  name: 'Ritual Testnet',
  nativeCurrency: { name: 'RITUAL', symbol: 'RITUAL', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.ritualfoundation.org', 'https://scanner-rpc.ritualfoundation.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'RitualScan',
      url: ritualTestnetConfig.explorer.url,
      apiUrl: ritualTestnetConfig.explorer.apiUrl,
    },
  },
  contracts: {
    asyncJobTracker: { address: ritualTestnetConfig.contracts.asyncJobTracker },
    asyncDelivery: { address: ritualTestnetConfig.contracts.asyncDelivery },
    ritualWallet: { address: ritualTestnetConfig.contracts.ritualWallet },
    scheduler: { address: ritualTestnetConfig.contracts.scheduler },
    agentHeartbeat: { address: ritualTestnetConfig.contracts.agentHeartbeat },
  },
  testnet: true,
  formatters,
})
