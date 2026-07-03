// ritual-viem: community viem extension for Ritual Chain, built by RitualScan.
// Root entry: actions, decorator, errors. Chain objects live in ritual-viem/chains,
// the zero-dependency protocol registry in ritual-viem/protocol.

export { ritualActions, type RitualActions } from './actions/decorator.js'
export {
  getAsyncFlow,
  createFlowCache,
  type AsyncFlow,
  type PhaseRef,
  type FlowCache,
  type GetAsyncFlowParameters,
} from './actions/getAsyncFlow.js'
export {
  waitForAsyncResult,
  type AsyncResult,
  type WaitForAsyncResultParameters,
} from './actions/waitForAsyncResult.js'
export {
  getTransactionReceiptSafe,
  waitForTransactionReceiptSafe,
  WaitForReceiptTimeoutError,
  WaitForReceiptRevertedError,
  type RitualTransactionReceipt,
  type RitualRawLog,
  type GetTransactionReceiptSafeParameters,
  type WaitForTransactionReceiptSafeParameters,
} from './actions/receipt.js'
export { decodeRitualLog, type RitualDecodedLog, type DecodableLog } from './actions/decodeRitualLog.js'
export { decodeJobAdded, type SovereignJob } from './actions/decodeJobAdded.js'
export { createRitualScanClient, type RitualScanClient } from './accelerator/ritualscan.js'
export {
  RitualViemError,
  UnknownRitualChainError,
  TransactionOffTipError,
  AsyncFlowTimeoutError,
  AsyncDeliveryFailedError,
  NotAsyncTransactionError,
} from './errors.js'

// Convenience re-exports.
export { ritualTestnet } from './chains/index.js'
export * from './protocol/index.js'
