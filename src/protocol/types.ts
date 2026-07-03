// Zero-dependency structural types. Deliberately compatible with viem's Hex and
// Address template-literal types without importing viem, so `ritual-viem/protocol`
// stays importable in environments where viem is not installed.

export type Hex = `0x${string}`
export type Address = Hex
export type Hash = Hex

export type AsyncPhase = 'request' | 'commit' | 'settle' | 'delivery'

export type AgentKind = 'sovereign' | 'persistent' | 'heartbeat' | 'lifecycle'

/** The Ritual async custom fields the RPC attaches to raw transactions. */
export interface RitualAsyncFields {
  originTx: Hash | null
  commitmentTx: Hash | null
  settlementTx: Hash | null
  precompileAddress: Address | null
  userAddress: Address | null
  executorAddress: Address | null
  commitmentValidator: Address | null
  inclusionValidator: Address | null
  totalAmount: bigint | null
  executorFee: bigint | null
  commitmentFee: bigint | null
  inclusionFee: bigint | null
  settlementBlock: bigint | null
  hasDeliverySpc: boolean
  /** First SPC (short-async precompile call) entry: the request's inline result. */
  spcCall: { address: Address; input: Hex | null; output: Hex | null } | null
  /** First delivery SPC entry on a delivery tx: the two-phase result payload. */
  deliverySpcCall: { address: Address; input: Hex | null; output: Hex | null } | null
}

/** A Ritual transaction parsed from the raw RPC shape (block body or by-hash). */
export interface ParsedRitualTransaction {
  hash: Hash
  blockNumber: bigint | null
  transactionIndex: number | null
  from: Address | null
  to: Address | null
  value: bigint
  /** Numeric tx type byte: 0/1/2/3 standard, 16 scheduled, 17 commit, 18 settle or delivery, 119 passkey. */
  typeCode: number
  /** Human name for typeCode ('eip1559', 'scheduled', 'asyncCommitment', ...). */
  typeName: string
  /** True for Ritual system txs (type >= 0x10). */
  isSystem: boolean
  gas: bigint
  /** True when gas carried the 2^64-1 system sentinel (RPC serves it as a lossy JSON number). */
  isSystemGasSentinel: boolean
  nonce: number | null
  input: Hex
  gasPrice: bigint | null
  maxFeePerGas: bigint | null
  maxPriorityFeePerGas: bigint | null
  /** 2-byte precompile id (e.g. '0x0805') when the tx targets a precompile. */
  precompile: Hex | null
  /** Scheduled (0x10) job callId. */
  callId: bigint | null
  /** Scheduled (0x10) execution index. */
  schedIndex: number | null
  agentKind: AgentKind | null
  /** Persistent-agent manifest path decoded off heartbeat calldata. */
  manifest: string | null
  async: RitualAsyncFields | null
}

/**
 * One transaction's authoritative contribution to its async flow, keyed by the
 * origin (request) tx hash. Each phase fills only the columns it owns and leaves
 * the rest null, so merging phases can never let a later phase clobber an earlier
 * one (the settle owns the fee accounting; the delivery never overwrites it).
 */
export interface AsyncFlowContribution {
  phase: AsyncPhase
  origin: Hash
  request: Hash | null
  commit: Hash | null
  settle: Hash | null
  delivery: Hash | null
  /** Block number of the contributing tx itself (fills the phase's block ref). */
  blockNumber: bigint | null
  precompileAddress: Address | null
  precompileId: Hex | null
  user: Address | null
  executor: Address | null
  commitmentValidator: Address | null
  inclusionValidator: Address | null
  totalAmount: bigint | null
  executorFee: bigint | null
  commitmentFee: bigint | null
  inclusionFee: bigint | null
  settlementBlock: bigint | null
  /** Inline SPC result payload (request phase of a short-async flow). */
  requestSpcOutput: Hex | null
  /** Delivery SPC result payload (delivery phase of a two-phase flow). */
  deliverySpcOutput: Hex | null
}

export interface ScheduledSlot {
  callId: bigint | null
  caller: Address
  target: Address
  nextBlock: number | null
  frequency: number | null
  maxExec: number | null
  gasLimit: bigint | null
  ttl: number | null
  selector: Hex | null
}

export interface AgentInfo {
  address: Address
  /** Last heartbeat block. */
  lastBeat: number
  /** Heartbeat interval in blocks. */
  interval: number
  /** Revive-deadline block; 0 when healthy. */
  reviveBlock: number
  /** 0 = active/monitored, non-zero = reviving/at-risk. */
  state: number
}
