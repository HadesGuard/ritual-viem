// Canonical enum-code maps shared with the RitualScan indexer. These codes are an
// on-disk contract there: only append, never renumber. Exposed here so consumers
// that exchange data with RitualScan (or any store using the same codes) map
// label <-> code identically.

export interface Bimap {
  code: (label: string | null | undefined) => number | null
  label: (code: number | null | undefined) => string | null
}

function bimap(entries: [number, string][]): Bimap {
  const toCode = new Map<string, number>()
  const toLabel = new Map<number, string>()
  for (const [code, label] of entries) {
    toCode.set(label, code)
    toLabel.set(code, label)
  }
  return {
    code: (label) => (label == null ? null : toCode.get(label) ?? 0),
    label: (code) => (code == null ? null : toLabel.get(code) ?? null),
  }
}

export const AGENT_KIND: Bimap = bimap([
  [1, 'sovereign'],
  [2, 'persistent'],
  [3, 'heartbeat'],
  [4, 'lifecycle'],
])

export const TRACE_TYPE: Bimap = bimap([
  [1, 'CALL'],
  [2, 'DELEGATECALL'],
  [3, 'STATICCALL'],
  [4, 'CALLCODE'],
  [5, 'CREATE'],
  [6, 'CREATE2'],
  [7, 'SELFDESTRUCT'],
])

export const TOKEN_STANDARD: Bimap = bimap([
  [1, 'erc20'],
  [2, 'erc721'],
  [3, 'erc1155'],
])
