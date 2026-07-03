// Per-chainId protocol configuration. All chain identity (contract addresses,
// system accounts, RPC quirks) lives here so a future Ritual mainnet is a
// config-only addition. Protocol facts shared across Ritual chains (selectors,
// event signatures, tx type bytes) live in RITUAL_PROTOCOL_BASE and are spread
// into each chain config, so a chain that changes one selector overrides one key.
import type { Address, Hex } from './types.js'

export interface RitualChainConfig {
  chainId: number
  /** Protocol revision this config was verified against (testnet resets bump it). */
  protocolVersion: string
  contracts: {
    asyncJobTracker: Address
    asyncDelivery: Address
    ritualWallet: Address
    scheduler: Address
    agentHeartbeat: Address
    teeRegistry?: Address
  }
  systemAccounts: {
    asyncCommit: Address
    asyncSettlement: Address
  }
  selectors: {
    addJob: Hex
    settle: Hex
    delivery: Hex
    heartbeat: Hex
    slots: Hex
    agentCount: Hex
    agentList: Hex
    getAgentInfo: Hex
  }
  /** 2-byte precompile id -> human label. */
  precompiles: Record<Hex, string>
  /** Precompile ids that complete with a phase-2 delivery tx (vs settle-only SPC flows). */
  twoPhasePrecompiles: readonly Hex[]
  rpc: {
    /** Block timestamps are served in milliseconds on this chain. */
    timestampsInMs: boolean
    /** Logs and receipts below this block are pruned on public RPCs. */
    pruneFloorBlock?: bigint
    /** Server-side result cap for eth_getLogs queries. */
    logResultCap?: number
  }
  explorer: {
    url: string
    /** Etherscan-compatible API root (also the optional flow-resolver accelerator). */
    apiUrl?: string
  }
}

/** Protocol facts shared by every Ritual chain revision so far. */
export const RITUAL_PROTOCOL_BASE = {
  systemAccounts: {
    asyncCommit: '0x000000000000000000000000000000000000fa8e' as Address,
    asyncSettlement: '0x000000000000000000000000000000000000fa9e' as Address,
  },
  selectors: {
    addJob: '0x57528d89' as Hex,
    settle: '0x0aa4dd19' as Hex,
    delivery: '0x20b48f49' as Hex,
    heartbeat: '0x141fec42' as Hex,
    slots: '0x387dd9e9' as Hex,
    agentCount: '0xb7dc1284' as Hex,
    agentList: '0x2f80c54f' as Hex,
    getAgentInfo: '0x152052b0' as Hex,
  },
  precompiles: {
    '0x0800': 'ONNX Inference',
    '0x0801': 'HTTP Call',
    '0x0802': 'LLM Call',
    '0x0803': 'JQ',
    '0x0805': 'Long-Running HTTP',
    '0x0806': 'ZK',
    '0x0807': 'FHE Inference',
    '0x0809': 'TX Hash',
    '0x080c': 'Sovereign Agent',
    '0x0818': 'Image Call',
    '0x0819': 'Audio Call',
    '0x081a': 'Video Call',
    '0x081b': 'DKMS Key',
    '0x0820': 'Persistent Agent',
    '0x0830': 'TX Hash',
  } as Record<Hex, string>,
  twoPhasePrecompiles: [
    '0x0805',
    '0x0806',
    '0x0807',
    '0x080c',
    '0x0818',
    '0x0819',
    '0x081a',
    '0x0820',
  ] as readonly Hex[],
} as const

export const ritualTestnetConfig: RitualChainConfig = {
  chainId: 1979,
  protocolVersion: 'testnet-v1',
  contracts: {
    asyncJobTracker: '0xc069ffca0389f44eca2c626e55491b0ab045aef5',
    asyncDelivery: '0x5a16214ff555848411544b005f7ac063742f39f6',
    ritualWallet: '0x532f0df0896f353d8c3dd8cc134e8129da2a3948',
    scheduler: '0x56e776bae2dd60664b69bd5f865f1180ffb7d58b',
    agentHeartbeat: '0xef505e801f1db392b5289690e2ffc20e840a3aca',
    teeRegistry: '0x9644e8562ce0fe12b4deec4163c064a8862bf47f',
  },
  systemAccounts: RITUAL_PROTOCOL_BASE.systemAccounts,
  selectors: RITUAL_PROTOCOL_BASE.selectors,
  precompiles: RITUAL_PROTOCOL_BASE.precompiles,
  twoPhasePrecompiles: RITUAL_PROTOCOL_BASE.twoPhasePrecompiles,
  rpc: {
    timestampsInMs: true,
    pruneFloorBlock: 39_550_000n,
    logResultCap: 1200,
  },
  explorer: {
    url: 'https://ritualscan.hadesxbt.dev',
    apiUrl: 'https://ritual-indexer.hadesxbt.dev/api',
  },
}

export const ritualChainConfigs: Record<number, RitualChainConfig> = {
  1979: ritualTestnetConfig,
}

/**
 * Resolve the protocol config for a chainId. Throws on unknown chains instead of
 * silently applying testnet constants against a foreign network.
 */
export function resolveRitualConfig(chainId: number | undefined): RitualChainConfig {
  if (chainId !== undefined) {
    const config = ritualChainConfigs[chainId]
    if (config) return config
  }
  throw new Error(
    `ritual-viem: no protocol config for chainId ${chainId}. ` +
      'Known chains: ' +
      Object.keys(ritualChainConfigs).join(', ') +
      '. Pass an explicit RitualChainConfig for custom deployments.',
  )
}
