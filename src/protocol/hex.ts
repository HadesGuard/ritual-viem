// Quantity and hex helpers tolerant of Ritual's RPC quirks. The node serves some
// numeric fields (system tx gas, settlementBlock) as bare JSON NUMBERS instead of
// hex quantity strings, and JSON.parse silently rounds anything past 2^53. See
// gasQuantity for how the 2^64-1 system gas sentinel is recovered exactly.
import type { Address, Hex } from './types.js'

/** Exact system gas marker Ritual puts on 0x11/0x12 system txs (2^64 - 1). */
export const SYSTEM_GAS_SENTINEL = 18446744073709551615n // 2n ** 64n - 1n

const UNSAFE_GAS_FLOOR = 1n << 63n

/**
 * Parse a JSON-RPC quantity that may be a hex string OR a bare JSON number.
 * Numbers above 2^53 have already lost precision in JSON.parse; callers that can
 * hit that range must go through gasQuantity instead. Returns null on malformed
 * input, never NaN and never a throw.
 */
export function parseQuantity(v: unknown): bigint | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return BigInt(Math.trunc(v))
  }
  if (typeof v === 'string') {
    if (v === '' || v === '0x') return null
    try {
      return BigInt(v)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Parse a gas-family quantity, recovering the exact 2^64-1 system sentinel that
 * the RPC serves as a lossy JSON number (JSON.parse rounds it to 2^64). Any value
 * at or above 2^63 is treated as the sentinel: no real gas limit lives up there,
 * and emitting the rounded double-derived value would be silently wrong.
 */
export function gasQuantity(v: unknown): { gas: bigint; isSystemGasSentinel: boolean } {
  const parsed = parseQuantity(v) ?? 0n
  if (parsed >= UNSAFE_GAS_FLOOR) return { gas: SYSTEM_GAS_SENTINEL, isSystemGasSentinel: true }
  return { gas: parsed, isSystemGasSentinel: false }
}

/** Parse a small integer quantity (index, nonce). Null on malformed input. */
export function parseIntQuantity(v: unknown): number | null {
  const b = parseQuantity(v)
  if (b === null) return null
  const n = Number(b)
  return Number.isSafeInteger(n) ? n : null
}

const textDecoder = /* @__PURE__ */ new TextDecoder()

/** Decode a bare hex string (no 0x) to utf8. Browser-safe (TextDecoder). */
export function hexBodyToUtf8(body: string): string {
  const clean = body.length % 2 === 0 ? body : body.slice(0, -1)
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return textDecoder.decode(bytes)
}

const ZERO20 = ('0x' + '0'.repeat(40)) as Address

/** Lowercase a 20-byte address, dropping the zero address and malformed input. */
export function nzAddress(v: unknown): Address | null {
  if (typeof v !== 'string') return null
  const s = v.toLowerCase()
  if (s === ZERO20 || !/^0x[0-9a-f]{40}$/.test(s)) return null
  return s as Address
}

/** Lowercase a 32-byte hash, dropping malformed or wrong-width input. */
export function nzHash(v: unknown): Hex | null {
  if (typeof v !== 'string') return null
  const s = v.toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(s)) return null
  return s as Hex
}

/** i-th 32-byte word of a bare hex body as a slice helper. */
export function word(body: string, i: number): string {
  return body.slice(i * 64, (i + 1) * 64)
}
