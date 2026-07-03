// Client-side async-flow resolver. Stateless port of the RitualScan indexer's
// lazy self-heal: one eth_getBlockByNumber(full) read is the durable primitive
// (async fields are reliable in block bodies at ANY height, verified down to the
// pruned era), while by-hash tx lookups only work near the tip. Folding a block
// merges every tx's flow contribution; the request's pointers (commitmentTx /
// settlementTx) then locate the sibling blocks, bounded to a few extra reads.
import type { Client } from 'viem'
import { decodeFunctionData } from 'viem'
import {
  asyncFlowContribution,
  isTwoPhasePrecompile,
  mergeAsyncContributions,
  parseQuantity,
  parseRitualTransaction,
  precompileLabel,
  resolveRitualConfig,
  SYSTEM_FUNCTION_BY_SELECTOR,
  type Address,
  type AsyncPhase,
  type Hash,
  type Hex,
  type MergedAsyncFlow,
  type RawRitualRpcTransaction,
  type RitualChainConfig,
} from '../protocol/index.js'
import { NotAsyncTransactionError, TransactionOffTipError } from '../errors.js'
import type { RitualScanClient } from '../accelerator/ritualscan.js'

export interface PhaseRef {
  hash: Hash
  blockNumber: bigint | null
}

export interface AsyncFlow {
  origin: Hash
  /** Phase of the hash the caller asked about (null if the hash was not in the flow). */
  phaseOf: AsyncPhase | null
  request: PhaseRef | null
  commit: PhaseRef | null
  settle: PhaseRef | null
  delivery: PhaseRef | null
  precompile: { address: Address; id: Hex; label: string | null } | null
  /** Whether this precompile family completes with a phase-2 delivery tx. */
  isTwoPhase: boolean
  user: Address | null
  executor: Address | null
  commitmentValidator: Address | null
  inclusionValidator: Address | null
  fees: {
    totalAmount: bigint
    executorFee: bigint | null
    commitmentFee: bigint | null
    inclusionFee: bigint | null
  } | null
  settlementBlock: bigint | null
  /** Inline SPC result payload from the request tx (short-async flows). */
  requestSpcOutput: Hex | null
  /** Delivery SPC result payload from the delivery tx (two-phase flows). */
  deliverySpcOutput: Hex | null
  /** jobId decoded from the commit's addJob calldata (drives delivery log lookup). */
  jobId: Hex | null
  /** All expected phases located. */
  complete: boolean
  /** Phases that could not be resolved (delivery only listed when expected). */
  missing: AsyncPhase[]
}

interface RawRpcBlock {
  number?: string
  transactions?: RawRitualRpcTransaction[]
}

/** Per-client resolution cache: fetched blocks, seen tx locations, merged flows. */
export interface FlowCache {
  blocks: Map<bigint, RawRpcBlock | null>
  txBlocks: Map<Hash, bigint>
  flows: Map<Hash, MergedAsyncFlow>
  /** origin hash -> tx hash of each phase seen while folding (for phase lookup). */
  hashIndex: Map<Hash, Hash>
}

export function createFlowCache(): FlowCache {
  return { blocks: new Map(), txBlocks: new Map(), flows: new Map(), hashIndex: new Map() }
}

const clientCaches = new WeakMap<object, FlowCache>()

function cacheFor(client: Client, explicit?: FlowCache): FlowCache {
  if (explicit) return explicit
  let cache = clientCaches.get(client as object)
  if (!cache) {
    cache = createFlowCache()
    clientCaches.set(client as object, cache)
  }
  // Bound the block cache: drop oldest entries past 64 blocks.
  if (cache.blocks.size > 64) {
    const drop = cache.blocks.size - 64
    let i = 0
    for (const key of cache.blocks.keys()) {
      cache.blocks.delete(key)
      if (++i >= drop) break
    }
  }
  return cache
}

const toHexBlock = (n: bigint): Hex => `0x${n.toString(16)}`

async function fetchBlock(client: Client, cache: FlowCache, blockNumber: bigint): Promise<RawRpcBlock | null> {
  const cached = cache.blocks.get(blockNumber)
  if (cached !== undefined) return cached
  const block = (await client
    .request({
      method: 'eth_getBlockByNumber',
      params: [toHexBlock(blockNumber), true],
    })
    .catch(() => null)) as RawRpcBlock | null
  cache.blocks.set(blockNumber, block)
  return block
}

/** Fold every tx of a block into the cache's flow map. */
function foldBlock(cache: FlowCache, block: RawRpcBlock | null): void {
  if (!block?.transactions) return
  const blockNumber = parseQuantity(block.number)
  for (const raw of block.transactions) {
    const tx = parseRitualTransaction(raw)
    if (!tx.hash) continue
    const hash = tx.hash.toLowerCase() as Hash
    if (blockNumber !== null) cache.txBlocks.set(hash, blockNumber)
    if (tx.blockNumber === null && blockNumber !== null) tx.blockNumber = blockNumber
    const contribution = asyncFlowContribution(tx)
    if (!contribution) continue
    const origin = contribution.origin
    cache.flows.set(origin, mergeAsyncContributions(cache.flows.get(origin) ?? null, contribution))
    cache.hashIndex.set(hash, origin)
    // Index the pointed-to hashes too, so a flow is findable from any phase hash.
    for (const pointer of [contribution.request, contribution.commit, contribution.settle, contribution.delivery]) {
      if (pointer) cache.hashIndex.set(pointer.toLowerCase() as Hash, origin)
    }
  }
}

async function locateBlockNumber(
  client: Client,
  cache: FlowCache,
  hash: Hash,
  accelerator?: RitualScanClient,
): Promise<bigint | null> {
  const seen = cache.txBlocks.get(hash.toLowerCase() as Hash)
  if (seen !== undefined) return seen
  const byHash = (await client
    .request({ method: 'eth_getTransactionByHash', params: [hash] })
    .catch(() => null)) as { blockNumber?: string } | null
  const fromRpc = parseQuantity(byHash?.blockNumber)
  if (fromRpc !== null) return fromRpc
  if (accelerator) {
    const fromApi = await accelerator.getTransactionBlockNumber(hash).catch(() => null)
    if (fromApi !== null) return fromApi
  }
  return null
}

/** Decode jobId (arg index 1, bytes32) off the commit tx's addJob calldata. */
function jobIdFromCommitInput(input: Hex | undefined, config: RitualChainConfig): Hex | null {
  if (!input || !input.toLowerCase().startsWith(config.selectors.addJob)) return null
  const addJob = SYSTEM_FUNCTION_BY_SELECTOR[config.selectors.addJob]
  if (!addJob) return null
  try {
    const { args } = decodeFunctionData({ abi: [addJob.abi], data: input })
    const jobId = (args as readonly unknown[])[1]
    return typeof jobId === 'string' ? (jobId as Hex) : null
  } catch {
    return null
  }
}

const DELIVERY_LOG_TOPICS: Hex[] = [
  // Delivered(bytes32 indexed jobId, ...) on AsyncDelivery
  '0xee99fb15d570dc5b25a5540de357c786d6b45c3c914d70c5d50d8bbeb6509917',
  // ResultDelivered(bytes32 indexed jobId, ...) on AsyncJobTracker
  '0x2408d34acb7d6f4dad6457f2ca70bfb06726b96d079e038a75d21b69ec26537c',
]

/** Locate the delivery tx of a two-phase flow via jobId-filtered logs. */
async function findDeliveryByLogs(
  client: Client,
  config: RitualChainConfig,
  jobId: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ hash: Hash; blockNumber: bigint | null } | null> {
  const CHUNK = 5_000n
  for (let start = fromBlock; start <= toBlock; start += CHUNK + 1n) {
    const end = start + CHUNK > toBlock ? toBlock : start + CHUNK
    const logs = (await client
      .request({
        method: 'eth_getLogs',
        params: [
          {
            address: [config.contracts.asyncDelivery, config.contracts.asyncJobTracker],
            topics: [DELIVERY_LOG_TOPICS, jobId],
            fromBlock: toHexBlock(start),
            toBlock: toHexBlock(end),
          },
        ],
      })
      .catch(() => null)) as { transactionHash?: string; blockNumber?: string }[] | null
    const hit = logs?.find((log) => log.transactionHash)
    if (hit) {
      return {
        hash: hit.transactionHash!.toLowerCase() as Hash,
        blockNumber: parseQuantity(hit.blockNumber),
      }
    }
  }
  return null
}

export interface GetAsyncFlowParameters {
  /** Any phase hash of the flow (request, commit, settle, or delivery). */
  hash: Hash
  /** Known block number of `hash` (skips the by-hash locate ladder; required off-tip). */
  blockNumber?: bigint
  /** Explicit protocol config (defaults to the client chain's known config). */
  config?: RitualChainConfig
  /** Shared resolution cache (defaults to a per-client cache). */
  cache?: FlowCache
  /** Optional RitualScan accelerator for locating pruned txs. */
  accelerator?: RitualScanClient
  /** How many blocks past the commit to scan for the delivery log. Default 20_000. */
  deliveryLookahead?: bigint
}

/**
 * Resolve the full async flow (request -> commit -> settle -> delivery) that
 * `hash` belongs to. Returns null when the tx exists but is not part of an async
 * flow. Throws TransactionOffTipError when the tx's block cannot be located.
 */
export async function getAsyncFlow(
  client: Client,
  parameters: GetAsyncFlowParameters,
): Promise<AsyncFlow | null> {
  const { hash, blockNumber, accelerator, deliveryLookahead = 20_000n } = parameters
  const config = parameters.config ?? resolveRitualConfig(client.chain?.id)
  const cache = cacheFor(client, parameters.cache)
  const target = hash.toLowerCase() as Hash

  // 1. Locate + fold the target tx's block.
  let origin = cache.hashIndex.get(target) ?? null
  if (!origin) {
    const located = blockNumber ?? (await locateBlockNumber(client, cache, target, accelerator))
    if (located === null) throw new TransactionOffTipError(hash)
    const block = await fetchBlock(client, cache, located)
    if (!block) throw new TransactionOffTipError(hash)
    foldBlock(cache, block)
    origin = cache.hashIndex.get(target) ?? null
    if (!origin) {
      // The tx exists in the block but contributed nothing async.
      if (cache.txBlocks.has(target)) return null
      throw new NotAsyncTransactionError(hash)
    }
  }

  // 2. Bounded self-heal: fold the sibling blocks the flow's pointers name.
  const fetched = new Set<Hash>([target])
  for (let round = 0; round < 4; round++) {
    const flow = cache.flows.get(origin)
    if (!flow) break
    const wants: Hash[] = []
    if (flow.request && (!flow.commit || !flow.settle)) wants.push(flow.request)
    if (flow.settle && flow.totalAmount === null) wants.push(flow.settle)
    if (flow.commit && !flow.request) wants.push(flow.commit)
    const next = wants.map((h) => h.toLowerCase() as Hash).find((h) => !fetched.has(h))
    if (!next) break
    fetched.add(next)
    const located = await locateBlockNumber(client, cache, next, accelerator)
    if (located === null) continue
    foldBlock(cache, await fetchBlock(client, cache, located))
  }

  let merged = cache.flows.get(origin)
  if (!merged) return null

  // 3. Two-phase delivery fast path: jobId-filtered logs from the commit block.
  const id = merged.precompileId
  const twoPhase = isTwoPhasePrecompile(id, config.twoPhasePrecompiles)
  let jobId: Hex | null = null
  if (merged.commit) {
    const commitHash = merged.commit.toLowerCase() as Hash
    let commitBlockNumber = merged.phaseBlocks.commit ?? cache.txBlocks.get(commitHash)
    if (commitBlockNumber === undefined) {
      // The commit hash is known from the request's pointer, but its block was
      // never folded; locate it so the addJob calldata (jobId) can be read.
      const located = await locateBlockNumber(client, cache, commitHash, accelerator)
      if (located !== null) commitBlockNumber = located
    }
    if (commitBlockNumber !== undefined) {
      const commitBlock = await fetchBlock(client, cache, commitBlockNumber)
      const commitTx = commitBlock?.transactions?.find(
        (t) => t.hash?.toLowerCase() === merged!.commit!.toLowerCase(),
      )
      jobId = jobIdFromCommitInput(commitTx?.input as Hex | undefined, config)
      if (twoPhase && !merged.delivery && jobId) {
        const found = await findDeliveryByLogs(
          client,
          config,
          jobId,
          commitBlockNumber,
          commitBlockNumber + deliveryLookahead,
        )
        if (found) {
          foldBlock(cache, found.blockNumber !== null ? await fetchBlock(client, cache, found.blockNumber) : null)
          merged = cache.flows.get(origin) ?? merged
          if (!merged.delivery) {
            // The delivery tx exists even if its block read failed; record the ref.
            merged.delivery = found.hash
            if (found.blockNumber !== null) merged.phaseBlocks.delivery = found.blockNumber
          }
        }
      }
    }
  }

  // 4. Assemble the public flow object.
  const ref = (phase: AsyncPhase, h: Hash | null): PhaseRef | null =>
    h
      ? {
          hash: h,
          blockNumber: merged!.phaseBlocks[phase] ?? cache.txBlocks.get(h.toLowerCase() as Hash) ?? null,
        }
      : null

  const missing: AsyncPhase[] = []
  if (!merged.request) missing.push('request')
  if (!merged.commit) missing.push('commit')
  if (!merged.settle) missing.push('settle')
  if (twoPhase && !merged.delivery) missing.push('delivery')

  const phaseOf: AsyncPhase | null =
    merged.request?.toLowerCase() === target || merged.origin.toLowerCase() === target
      ? 'request'
      : merged.commit?.toLowerCase() === target
        ? 'commit'
        : merged.settle?.toLowerCase() === target
          ? 'settle'
          : merged.delivery?.toLowerCase() === target
            ? 'delivery'
            : null

  return {
    origin: merged.origin,
    phaseOf,
    request: ref('request', merged.request),
    commit: ref('commit', merged.commit),
    settle: ref('settle', merged.settle),
    delivery: ref('delivery', merged.delivery),
    precompile:
      merged.precompileAddress && id
        ? { address: merged.precompileAddress, id, label: precompileLabel(id, config.precompiles) }
        : null,
    isTwoPhase: twoPhase,
    user: merged.user,
    executor: merged.executor,
    commitmentValidator: merged.commitmentValidator,
    inclusionValidator: merged.inclusionValidator,
    fees:
      merged.totalAmount !== null
        ? {
            totalAmount: merged.totalAmount,
            executorFee: merged.executorFee,
            commitmentFee: merged.commitmentFee,
            inclusionFee: merged.inclusionFee,
          }
        : null,
    settlementBlock: merged.settlementBlock,
    requestSpcOutput: merged.requestSpcOutput,
    deliverySpcOutput: merged.deliverySpcOutput,
    jobId,
    complete: missing.length === 0,
    missing,
  }
}
