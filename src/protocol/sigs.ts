// Built-in Ritual system event and function signatures.
//
// The protocol contracts and the SDK-generated precompile consumers are deployed
// unverified, so their events and calldata have no public ABI to decode against.
// These signatures are part of the Ritual on-chain SDK, seeded here so any log or
// calldata can be resolved for ANY emitter.
//
// Every topic0/selector below is an authored LITERAL, not derived at runtime, so
// the package works without keccak at import time. The unit test suite re-derives
// each literal from its signature string with viem's toEventSelector and
// toFunctionSelector, so a typo cannot silently ship.
//
// The `indexed` flags match the on-chain emission, not just the SDK source: each
// was set from the observed topic count of real logs (an indexed arg consumes a
// topic, a non-indexed one a data word). Notably PrecompileCalled is emitted
// fully NON-indexed even though the SDK example declares `address indexed
// precompile`; `indexed` does not change topic0, only where each argument is read.
import type { Hex } from './types.js'

export interface AbiEventParam {
  name: string
  type: string
  indexed: boolean
  components?: { name: string; type: string }[]
}

export interface RitualEventSig {
  topic0: Hex
  name: string
  signature: string
  abi: { type: 'event'; name: string; inputs: AbiEventParam[] }
}

export interface RitualFunctionSig {
  selector: Hex
  name: string
  signature: string
  abi: {
    type: 'function'
    name: string
    stateMutability: 'nonpayable'
    inputs: { name: string; type: string }[]
    outputs: never[]
  }
}

type RawEvent = [signature: string, topic0: Hex, params: [name: string, type: string, indexed: boolean][]]

const EVENT_RAW: RawEvent[] = [
  // Emitted by precompile consumers after a raw precompile call. Fully NON-indexed:
  // data[0] = precompile address, then input/output.
  [
    'PrecompileCalled(address,bytes,bytes)',
    '0x57fb3a94d7445a269580b6ce87a86bf179428bfd6d1c3caebc52fdad5663805c',
    [['precompile', 'address', false], ['input', 'bytes', false], ['output', 'bytes', false]],
  ],
  // RitualWallet accounting event emitted during phase-1 settlement.
  [
    'AsyncSettlement(address,bytes32,uint256,address,address,address)',
    '0x2cc7a930ab65556ed3f8a3a780fc1f73b767ecd6dfe78f4051a1222ca2127d33',
    [
      ['user', 'address', true],
      ['jobId', 'bytes32', true],
      ['amount', 'uint256', false],
      ['executor', 'address', false],
      ['commitmentValidator', 'address', false],
      ['inclusionValidator', 'address', false],
    ],
  ],
  // AsyncJobTracker: phase-1 settlement of an async job.
  [
    'Phase1Settled(bytes32,address,uint256)',
    '0x37f71b8eed16673ade1472b9c4d690c8d8cdfb7fd0f55f9cf2c9c9e679f04db4',
    [['jobId', 'bytes32', true], ['executor', 'address', true], ['amount', 'uint256', false]],
  ],
  // AsyncDelivery: a job's phase-1 settlement result (success flag).
  [
    'Settled(bytes32,address,bool)',
    '0x0ecc014f6beb14ac30493d1e274ad878b6eb46fd7feaee79bb83031f6cca09c2',
    [['jobId', 'bytes32', true], ['executor', 'address', true], ['success', 'bool', false]],
  ],
  // AsyncJobTracker: the precompile result was delivered back to the target.
  [
    'ResultDelivered(bytes32,address,bool)',
    '0x2408d34acb7d6f4dad6457f2ca70bfb06726b96d079e038a75d21b69ec26537c',
    [['jobId', 'bytes32', true], ['target', 'address', true], ['success', 'bool', false]],
  ],
  // AsyncDelivery: phase-2 delivery with gas/fee/value accounting.
  [
    'Delivered(bytes32,address,address,bool,uint256,uint256,uint256)',
    '0xee99fb15d570dc5b25a5540de357c786d6b45c3c914d70c5d50d8bbeb6509917',
    [
      ['jobId', 'bytes32', true],
      ['target', 'address', true],
      ['executor', 'address', true],
      ['success', 'bool', false],
      ['gasUsed', 'uint256', false],
      ['fee', 'uint256', false],
      ['value', 'uint256', false],
    ],
  ],
  // Precompile consumer: the long-running HTTP result delivered to the consumer.
  [
    'LongRunningResultDelivered(bytes32,bytes)',
    '0x616b259ea55e6af4ef0ce4304b928ac46ebf93bbfb20ecd2fdafa040dd09de77',
    [['jobId', 'bytes32', true], ['result', 'bytes', false]],
  ],
  // AsyncJobTracker: a job left the active set (all args indexed, no data).
  [
    'JobRemoved(address,bytes32,bool)',
    '0x59725cef98fe1b85530b2a0a150f88c48a08cca2cafed999590140955f67b540',
    [['executor', 'address', true], ['jobId', 'bytes32', true], ['completed', 'bool', true]],
  ],
  // RitualWallet: per-call fee deduction from the user's balance.
  [
    'FeeDeduction(address,uint256,uint256)',
    '0xfceaa803e0bf753419a5cd801603fea0530722a58ac06f7e3137277b4ce04c5f',
    [['user', 'address', true], ['amount', 'uint256', false], ['callId', 'uint256', false]],
  ],
  // AsyncJobTracker: sovereign-agent job registration (every agent wake). The
  // non-indexed data begins with commitBlock and the SovereignAgentRequest bytes.
  [
    'JobAdded(address,bytes32,address,uint256,bytes,address,bytes32,uint256,uint256,uint256,uint256)',
    '0xdc816fe478e06924e13d5c802912a8d7931e9a96b8443fe00d3f27c2da756cdf',
    [
      ['executor', 'address', true],
      ['jobId', 'bytes32', true],
      ['precompileAddress', 'address', true],
      ['commitBlock', 'uint256', false],
      ['precompileInput', 'bytes', false],
      ['senderAddress', 'address', false],
      ['previousBlockHash', 'bytes32', false],
      ['previousBlockNumber', 'uint256', false],
      ['previousBlockTimestamp', 'uint256', false],
      ['ttl', 'uint256', false],
      ['createdAt', 'uint256', false],
    ],
  ],
]

function eventName(signature: string): string {
  return signature.slice(0, signature.indexOf('('))
}

export const SYSTEM_EVENTS: RitualEventSig[] = EVENT_RAW.map(([signature, topic0, params]) => ({
  topic0,
  name: eventName(signature),
  signature,
  abi: {
    type: 'event',
    name: eventName(signature),
    inputs: params.map(([name, type, indexed]) => ({ name, type, indexed })),
  },
}))

/** topic0 -> event signature entry for every built-in Ritual system event. */
export const SYSTEM_EVENT_BY_TOPIC: Record<Hex, RitualEventSig> = Object.fromEntries(
  SYSTEM_EVENTS.map((e) => [e.topic0, e]),
)

type RawFunction = [signature: string, selector: Hex]

const FUNC_RAW: RawFunction[] = [
  // Precompile entry points generated by the Ritual SDK (one per family).
  ['callLongRunningHTTPCall(bytes)', '0x18b85fbb'],
  ['callHTTPCall(bytes)', '0x5adc0a5c'],
  ['callONNXInference(bytes)', '0xb658d4fa'],
  ['callImageCall(bytes)', '0x56efce71'],
  ['callAudioCall(bytes)', '0xd36c302f'],
  ['callVideoCall(bytes)', '0xd259d658'],
  ['callFHEInference(bytes)', '0x0c431c35'],
  ['callSovereignAgent(bytes)', '0x8af14768'],
  ['callPersistentAgent(bytes)', '0x9a956216'],
  ['callDKMSKey(bytes)', '0x0f20ee00'],
  ['onLongRunningResult(bytes32,bytes)', '0x6dc9dbef'],
  // Async system-tx entry points: addJob (the 0x11 commit on AsyncJobTracker) and
  // settle (the 0x12 settle on AsyncDelivery), selector-verified against real
  // system-tx calldata. The phase-2 delivery method (0x20b48f49) is left raw: its
  // nested-tuple argument layout has not been recovered.
  ['addJob(address,bytes32,address,bytes,uint256,bytes32,uint256,uint256,address,address,bytes32,bytes)', '0x57528d89'],
  ['settle(bytes32,address,address,address,address,uint256,uint256,uint256,bytes)', '0x0aa4dd19'],
  // AgentHeartbeat + Scheduler maintenance surface.
  ['heartbeat(string,bytes)', '0x141fec42'],
  ['slots(uint256)', '0x387dd9e9'],
  ['agentCount()', '0xb7dc1284'],
  ['agentList(uint256)', '0x2f80c54f'],
  ['getAgentInfo(address)', '0x152052b0'],
]

function funcAbi(signature: string): RitualFunctionSig['abi'] {
  const name = eventName(signature)
  const types = signature.slice(signature.indexOf('(') + 1, -1).split(',').filter(Boolean)
  // A lone bytes arg is the precompile request payload, named "input"; multi-arg
  // system calls get positional names so repeated types cannot collide.
  return {
    type: 'function',
    name,
    stateMutability: 'nonpayable',
    inputs: types.map((type, i) => ({ name: types.length === 1 ? 'input' : `arg${i}`, type })),
    outputs: [],
  }
}

export const SYSTEM_FUNCTIONS: RitualFunctionSig[] = FUNC_RAW.map(([signature, selector]) => ({
  selector,
  name: eventName(signature),
  signature,
  abi: funcAbi(signature),
}))

/** selector -> function signature entry for every built-in Ritual system function. */
export const SYSTEM_FUNCTION_BY_SELECTOR: Record<Hex, RitualFunctionSig> = Object.fromEntries(
  SYSTEM_FUNCTIONS.map((f) => [f.selector, f]),
)

/** Sovereign agents emit this topic from their own address on every run/wake. */
export const SOVEREIGN_RUN_TOPIC: Hex = '0x0f46290068e3564761b6805b2330989b9ff59aa79006e68999e3047d22909c4f'

/** AgentHeartbeat fires this when it drops an agent (reason string in data). */
export const AGENT_REMOVED_TOPIC: Hex = '0x1675572b719359b66bedcfad06353f8af3419eb35415c684952365930ee7c08e'

export const JOB_ADDED_TOPIC: Hex = '0xdc816fe478e06924e13d5c802912a8d7931e9a96b8443fe00d3f27c2da756cdf'
