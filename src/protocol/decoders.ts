// Pure word-layout parsers for Scheduler and AgentHeartbeat return data. These
// take raw eth_call return hex and never touch the network. Word layouts were
// verified on-chain (see each function's comment).
import { word } from './hex.js'
import type { Address, AgentInfo, Hex, ScheduledSlot } from './types.js'

/**
 * Decode one Scheduler `slots(uint256)` return struct. Word layout verified
 * on-chain (every slot has an identical head): w0 caller, w1 target, w2
 * nextBlock, w3 frequency, w4 maxExecutions, w5 gasLimit, w6 ttl, w11 calldata
 * offset, w12 callId, then [len, calldata...]. Null when the slot is empty.
 */
export function decodeScheduledSlot(hex: Hex | null | undefined): ScheduledSlot | null {
  if (!hex || hex === '0x') return null
  const body = hex.slice(2)
  const num = (i: number) => {
    try {
      return Number(BigInt('0x' + word(body, i)))
    } catch {
      return null
    }
  }
  const big = (i: number) => {
    try {
      return BigInt('0x' + word(body, i))
    } catch {
      return null
    }
  }
  const addr = (i: number) => ('0x' + word(body, i).slice(24)) as Address
  let selector: Hex | null = null
  try {
    const dataWord = word(body, Number(BigInt('0x' + word(body, 11))) / 32 + 1)
    if (dataWord) selector = ('0x' + dataWord.slice(0, 8)) as Hex
  } catch {
    // leave selector null on malformed calldata section
  }
  return {
    callId: big(12),
    caller: addr(0),
    target: addr(1),
    nextBlock: num(2),
    frequency: num(3),
    maxExec: num(4),
    gasLimit: big(5),
    ttl: num(6),
    selector,
  }
}

/**
 * Decode an AgentHeartbeat `getAgentInfo(address)` return. Verified word layout
 * (w0 = tuple offset, then fields): w2 agent address, w4 last-heartbeat block,
 * w5 heartbeat interval, w6 revive-deadline block (0 when healthy), w8 state
 * enum (0 = active/monitored). A not-registered address comes back zeroed.
 */
export function decodeAgentInfo(addr: Address, hex: Hex | null | undefined): AgentInfo | null {
  if (!hex || hex === '0x') return null
  const b = hex.replace(/^0x/, '')
  const num = (i: number) => {
    try {
      return Number(BigInt('0x' + word(b, i)))
    } catch {
      return 0
    }
  }
  const agent = '0x' + (word(b, 2) || '').slice(24)
  if (!/^0x[0-9a-f]{40}$/i.test(agent) || agent === '0x' + '0'.repeat(40)) return null
  return {
    address: addr.toLowerCase() as Address,
    lastBeat: num(4),
    interval: num(5),
    reviveBlock: num(6),
    state: num(8),
  }
}
