// Precompile id helpers. Precompile contracts live at 0x0000...08xx: 18 high
// bytes zero, the 2-byte id in the low bytes.
import { RITUAL_PROTOCOL_BASE } from './config.js'
import type { Address, Hex } from './types.js'

/** 2-byte precompile id (e.g. '0x0805') from a full precompile address; null for any other address. */
export function precompileId(addr: string | null | undefined): Hex | null {
  if (!addr) return null
  const s = String(addr).toLowerCase().replace(/^0x/, '')
  if (!/^0{36}[0-9a-f]{4}$/.test(s)) return null
  return ('0x' + s.slice(-4)) as Hex
}

/** Human label for a 2-byte precompile id ('0x0805' -> 'Long-Running HTTP'); null when unknown. */
export function precompileLabel(
  id: string | null | undefined,
  registry: Record<Hex, string> = RITUAL_PROTOCOL_BASE.precompiles,
): string | null {
  if (!id) return null
  return registry[id.toLowerCase() as Hex] ?? null
}

/** Label for a FULL precompile address; null for any normal address. */
export function precompileAddrLabel(
  addr: Address | string | null | undefined,
  registry: Record<Hex, string> = RITUAL_PROTOCOL_BASE.precompiles,
): string | null {
  const id = precompileId(addr ?? null)
  return id ? precompileLabel(id, registry) : null
}

/** Decimal form of a 2-byte precompile id ('0x0805' -> 2053); null when malformed. */
export function precompileDecimal(id: string | null | undefined): number | null {
  if (!id) return null
  const n = parseInt(id, 16)
  return Number.isFinite(n) ? n : null
}

/** True when the precompile id completes with a phase-2 delivery tx (vs settle-only). */
export function isTwoPhasePrecompile(
  id: string | null | undefined,
  twoPhase: readonly Hex[] = RITUAL_PROTOCOL_BASE.twoPhasePrecompiles,
): boolean {
  if (!id) return false
  return twoPhase.includes(id.toLowerCase() as Hex)
}
