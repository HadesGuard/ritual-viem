// Decode an AsyncJobTracker JobAdded log into a normalized sovereign-agent job
// record. The event's precompileInput is the 23-field SovereignAgentRequest, so
// model/prompt/cli/consumer come for free with no extra RPC calls.
import { decodeAbiParameters, getAddress } from 'viem'
import { JOB_ADDED_TOPIC, type Address, type Hex } from '../protocol/index.js'
import type { DecodableLog } from './decodeRitualLog.js'

// Non-indexed JobAdded data fields, in order.
const JOB_DATA_TYPES = [
  { name: 'commitBlock', type: 'uint256' },
  { name: 'precompileInput', type: 'bytes' },
  { name: 'senderAddress', type: 'address' },
  { name: 'previousBlockHash', type: 'bytes32' },
  { name: 'previousBlockNumber', type: 'uint256' },
  { name: 'previousBlockTimestamp', type: 'uint256' },
  { name: 'ttl', type: 'uint256' },
  { name: 'createdAt', type: 'uint256' },
] as const

const STRING_TRIPLE = { type: 'tuple', components: [{ type: 'string' }, { type: 'string' }, { type: 'string' }] }

// SovereignAgentRequest tuple: consumer = #6 (callback target), cliType = #11,
// prompt = #12, model = #18. Matches the RitualAgent dApp encoder exactly.
const REQUEST_TYPES = [
  { type: 'address' },
  { type: 'uint256' },
  { type: 'bytes' },
  { type: 'uint64' },
  { type: 'uint64' },
  { type: 'string' },
  { type: 'address' },
  { type: 'bytes4' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint16' },
  { type: 'string' },
  { type: 'bytes' },
  STRING_TRIPLE,
  STRING_TRIPLE,
  { ...STRING_TRIPLE, type: 'tuple[]' },
  STRING_TRIPLE,
  { type: 'string' },
  { type: 'string[]' },
  { type: 'uint16' },
  { type: 'uint32' },
  { type: 'string' },
] as const

export interface SovereignJob {
  jobId: Hex
  executor: Address
  sender: Address
  consumer: Address
  model: string | null
  prompt: string | null
  cliType: number | null
  commitBlock: bigint
  /** previousBlockTimestamp, milliseconds. */
  timestampMs: bigint
  ttl: bigint
}

/** Decode one JobAdded log; null if it is not a JobAdded or the data is malformed. */
export function decodeJobAdded(log: DecodableLog): SovereignJob | null {
  if (!log.topics || log.topics.length < 3) return null
  if (log.topics[0]?.toLowerCase() !== JOB_ADDED_TOPIC) return null
  const executor = getAddress('0x' + log.topics[1]!.slice(-40)) as Address
  const jobId = log.topics[2] as Hex
  let data: readonly unknown[]
  try {
    data = decodeAbiParameters(JOB_DATA_TYPES, log.data as Hex)
  } catch {
    return null
  }
  const sender = getAddress(data[2] as string) as Address
  let consumer: Address = sender
  let model: string | null = null
  let prompt: string | null = null
  let cliType: number | null = null
  try {
    const request = decodeAbiParameters(REQUEST_TYPES as never, data[1] as Hex) as readonly unknown[]
    consumer = (getAddress(request[6] as string) as Address) || sender
    cliType = Number(request[11] ?? 0)
    prompt = String(request[12] ?? '')
    model = String(request[18] ?? '')
  } catch {
    // Keep the job (sender/executor still useful) even if the request will not decode.
  }
  return {
    jobId,
    executor,
    sender,
    consumer,
    model,
    prompt,
    cliType,
    commitBlock: data[0] as bigint,
    timestampMs: data[5] as bigint,
    ttl: data[6] as bigint,
  }
}
