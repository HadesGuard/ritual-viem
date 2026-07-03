// Agent-family classification, derived purely from the tx (precompile id, target,
// selector) so re-parsing the same tx always yields the same value:
//   sovereign  = Sovereign Agent precompile (0x080c)
//   persistent = Persistent Agent precompile (0x0820)
//   heartbeat  = heartbeat() call to the AgentHeartbeat contract (manifest pointer)
//   lifecycle  = other AgentHeartbeat call (revive / dead-man's-switch system tx)
import { ritualTestnetConfig } from './config.js'
import { hexBodyToUtf8 } from './hex.js'
import type { Address, AgentKind, Hex } from './types.js'

/**
 * Decode the manifest path (first string arg) straight off heartbeat calldata:
 * [selector][offset][...][len][utf8 bytes]. Returns null on any malformed input.
 */
export function decodeHeartbeatManifest(input: Hex): string | null {
  try {
    const body = input.slice(10)
    const off = Number(BigInt('0x' + body.slice(0, 64))) * 2
    const len = Number(BigInt('0x' + body.slice(off, off + 64)))
    if (len <= 0 || len > 4096) return null
    const s = hexBodyToUtf8(body.slice(off + 64, off + 64 + len * 2))
    return s || null
  } catch {
    return null
  }
}

export interface AgentClassification {
  kind: AgentKind | null
  manifest: string | null
}

/** Classify a tx's agent family from its precompile id, target address, and calldata. */
export function classifyAgent(
  precompile: Hex | null,
  to: Address | null,
  input: Hex,
  options: { agentHeartbeat?: Address; heartbeatSelector?: Hex } = {},
): AgentClassification {
  const heartbeatContract = options.agentHeartbeat ?? ritualTestnetConfig.contracts.agentHeartbeat
  const heartbeatSelector = options.heartbeatSelector ?? ritualTestnetConfig.selectors.heartbeat
  const p = (precompile || '').toLowerCase()
  if (p === '0x080c') return { kind: 'sovereign', manifest: null }
  if (p === '0x0820') return { kind: 'persistent', manifest: null }
  if (to && to.toLowerCase() === heartbeatContract) {
    const sel = (input || '0x').slice(0, 10).toLowerCase()
    if (sel === heartbeatSelector) return { kind: 'heartbeat', manifest: decodeHeartbeatManifest(input) }
    return { kind: 'lifecycle', manifest: null }
  }
  return { kind: null, manifest: null }
}

/**
 * Decode the reason string from an AgentHeartbeat removal log's data (abi string:
 * [offset][len][utf8 bytes]). Returns e.g. "below minimum balance".
 */
export function decodeRemovalReason(data: Hex): string | null {
  try {
    const b = (data || '0x').replace(/^0x/, '')
    const len = Number(BigInt('0x' + b.slice(64, 128)))
    if (len <= 0 || len > 512) return null
    return hexBodyToUtf8(b.slice(128, 128 + len * 2)).replace(/\0+$/, '') || null
  } catch {
    return null
  }
}
