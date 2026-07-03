# ritual-viem

Community-maintained [viem](https://viem.sh) extension for [Ritual Chain](https://docs.ritualfoundation.org). Built by [RitualScan](https://ritualscan.hadesxbt.dev). Not affiliated with Ritual Foundation.

Ritual is an AI-native EVM chain with custom transaction types and async precompiles. Vanilla EVM tooling mishandles it in ways that are easy to miss:

- **ethers v6 crashes** on any block containing a system transaction (`gasLimit` overflow).
- **viem silently returns wrong gas**: system txs carry gas `2^64 - 1`, served as a bare JSON number that `JSON.parse` rounds to `2^64`. No error, just a wrong value.
- **Block timestamps are milliseconds**, so `block.timestamp` reads ~56,000 years in the future if you treat it as seconds.
- **The async lifecycle is invisible**: your precompile call spans up to four transactions (request, commit, settle, delivery) linked by custom fields no standard library parses. There is no built-in way to wait for your result.

`ritual-viem` fixes all four with chain formatters and typed actions, following the same extension pattern as `viem/op-stack`. No fork, viem stays a peer dependency.

## Install

```sh
npm install viem ritual-viem
```

## Quickstart

```ts
import { createPublicClient, http } from 'viem'
import { ritualTestnet } from 'ritual-viem/chains'
import { ritualActions } from 'ritual-viem'

const client = createPublicClient({
  chain: ritualTestnet,        // chainId 1979, Ritual formatters attached
  transport: http(),
  pollingInterval: 500,        // Ritual blocks land every ~350ms
}).extend(ritualActions())

// Standard viem reads are now safe on Ritual blocks:
const block = await client.getBlock({ includeTransactions: true })
console.log(block.timestamp)   // seconds (block.timestampMs preserved)

// The hero: send a tx that calls an async precompile, then wait for the result.
const hash = await walletClient.writeContract({ /* your consumer contract */ })
const { flow, status, result, success } = await client.waitForAsyncResult({
  hash,
  onPhase: (phase) => console.log('async phase reached:', phase),
})
console.log(flow.precompile?.label)  // e.g. "LLM Call"
console.log(status)                  // 'delivered' (two-phase) or 'settled' (short-async)
console.log(result)                  // the precompile result payload (hex)
```

## What you get

### `ritual-viem/chains`

`ritualTestnet` is a viem `Chain` with formatters that make standard reads safe:

| Quirk | Without formatters | With `ritualTestnet` |
|---|---|---|
| System tx gas (2^64-1 as JSON number) | `18446744073709551616n` (wrong) | exact `SYSTEM_GAS_SENTINEL` + `isSystemGasSentinel: true` |
| Block timestamp | milliseconds in `timestamp` | seconds in `timestamp`, original in `timestampMs` |
| Tx types 0x10 / 0x11 / 0x12 | `type: undefined` | `'scheduled'` / `'asyncCommitment'` / `'asyncSettlement'` + `isSystemTransaction` |
| Async fields (`commitmentTx`, fees, `spcCalls`) | raw strings or dropped | typed `tx.ritual` object with bigint fees |

### Root: actions

- `client.waitForAsyncResult({ hash, onPhase?, timeout? })` waits for the terminal phase of the async flow your tx started and returns the decoded result. Accepts any phase hash. Rejects with a typed error carrying the partial flow on timeout; never resolves on a partial flow.
- `client.getAsyncFlow({ hash })` resolves the request / commit / settle / delivery linkage once, with `complete` and `missing` fields that say exactly what could not be located.
- `client.waitForTransactionReceiptSafe({ hash })` and `getTransactionReceiptSafe` poll raw receipts without touching any block-parsing path, with an `eth_getBlockReceipts` fallback that outlives by-hash pruning.
- `decodeRitualLog(log)` decodes the Ritual system events (Delivered, ResultDelivered, JobAdded, FeeDeduction, ...) for any emitter, including unverified contracts. Returns null on unknown layouts, never a guess.
- `decodeJobAdded(log)` decodes sovereign-agent wakes including model, prompt, and consumer from the 23-field SovereignAgentRequest.
- `createRitualScanClient()` is an optional accelerator that locates pruned transactions through the RitualScan index. Correctness never depends on it.

### `ritual-viem/protocol` (zero dependencies)

The Ritual protocol registry as data and pure functions, importable without viem: system contract addresses, system accounts, keccak-verified event topics and function selectors, precompile id/label helpers, tx normalization (`parseRitualTransaction`), async phase classification, and the flow merge algebra. Every topic0 and selector is an authored literal re-derived from its signature string in CI, so a typo cannot ship.

## How the async flow resolver works

By-hash transaction lookups are pruned aggressively on Ritual public RPCs (they returned null for us on transactions only a few days old), but full block bodies keep their async fields at every height, verified down to the pruned era. The resolver therefore works block-first: it folds whole blocks into per-origin flow contributions (the same merge the RitualScan indexer uses), follows the request's commitment and settlement pointers to sibling blocks with a bounded number of reads, and locates two-phase deliveries through jobId-filtered logs starting at the commit block. For transactions outside every window, pass `blockNumber` or an `accelerator`.

## Compatibility

| ritual-viem | Ritual protocol | Chain | Notes |
|---|---|---|---|
| 0.1.x | testnet-v1 | 1979 (testnet) | verified against live chain 2026-07-03 |

Ritual is a fast-moving testnet. If a testnet reset changes contract addresses or selectors, a config revision ships as a minor release; this table records which package version matches which chain state. A future mainnet is a config-only addition.

## Versioning

0.x while the chain itself is pre-mainnet. Patch releases fix bugs and add protocol data (new precompile labels, new event signatures); minor releases add API or chain configs. Decode behavior is covered by recorded-fixture tests from real chain data plus a nightly live suite against the testnet.

## Related

- [Ritual developer docs](https://docs.ritualfoundation.org) for the protocol itself
- [RitualScan](https://ritualscan.hadesxbt.dev) block explorer, plus its Etherscan-compatible API
- [viem](https://viem.sh) and the [op-stack extension](https://viem.sh/op-stack) this package's design follows

## License

MIT
