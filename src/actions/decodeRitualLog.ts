// Decode any Ritual system event by its topic0 against the built-in registry.
// Returns null on unknown topics or layout mismatches, NEVER a guess: a wrong
// decode is worse than no decode.
import { decodeEventLog } from 'viem'
import { SYSTEM_EVENT_BY_TOPIC, type Hex } from '../protocol/index.js'

export interface RitualDecodedLog {
  /** Event name (e.g. 'Delivered'). */
  name: string
  /** Canonical signature the topic0 was derived from. */
  signature: string
  topic0: Hex
  /** Decoded arguments keyed by name. */
  args: Record<string, unknown>
}

export interface DecodableLog {
  address?: string
  topics: readonly string[] | string[]
  data: string
}

/** Decode one log against the Ritual system event registry; null when unknown. */
export function decodeRitualLog(log: DecodableLog): RitualDecodedLog | null {
  const topic0 = log.topics?.[0]?.toLowerCase() as Hex | undefined
  if (!topic0) return null
  const entry = SYSTEM_EVENT_BY_TOPIC[topic0]
  if (!entry) return null
  try {
    const decoded = decodeEventLog({
      abi: [entry.abi],
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    })
    return {
      name: entry.name,
      signature: entry.signature,
      topic0: entry.topic0,
      args: (decoded.args ?? {}) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}
