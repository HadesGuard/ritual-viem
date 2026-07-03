// Event decoding against REAL logs recorded from the chain: the delivery
// receipt's system events, the unknown-event null path, and JobAdded (both the
// defensive non-sovereign path and a real sovereign wake with model/prompt).
import { describe, expect, it } from 'vitest'
import { decodeRitualLog } from '../src/actions/decodeRitualLog.js'
import { decodeJobAdded } from '../src/actions/decodeJobAdded.js'
import { loadFixtures } from './helpers.js'

const fixtures = loadFixtures()
const deliveryReceipt = fixtures.deliveryBlockReceipts.find(
  (receipt) => receipt.transactionHash === fixtures.meta.flowB.delivery,
)!

describe('decodeRitualLog on the real delivery receipt', () => {
  it('decodes the Delivered event with success flag and fee accounting', () => {
    const log = deliveryReceipt.logs.find((l) =>
      l.topics[0]!.startsWith('0xee99fb15'),
    )!
    const decoded = decodeRitualLog(log)!
    expect(decoded.name).toBe('Delivered')
    expect(typeof decoded.args.success).toBe('boolean')
    expect(decoded.args.jobId).toMatch(/^0x/)
    expect(decoded.args.gasUsed).toBeTypeOf('bigint')
  })

  it('decodes ResultDelivered, JobRemoved, FeeDeduction, LongRunningResultDelivered', () => {
    const names = deliveryReceipt.logs
      .map((log) => decodeRitualLog(log)?.name ?? null)
      .filter((name) => name !== null)
    expect(names).toContain('ResultDelivered')
    expect(names).toContain('JobRemoved')
    expect(names).toContain('FeeDeduction')
    expect(names).toContain('LongRunningResultDelivered')
  })

  it('returns null (never a guess) for events outside the registry', () => {
    const gasRefund = deliveryReceipt.logs.find((l) => l.topics[0]!.startsWith('0x17a7497e'))!
    expect(decodeRitualLog(gasRefund)).toBeNull()
  })
})

describe('decodeJobAdded', () => {
  it('keeps the job on a non-sovereign precompileInput (defensive path)', () => {
    const jobAdded = fixtures.commitBlockReceipts
      .flatMap((receipt) => receipt.logs)
      .find((log) => log.topics[0] === '0xdc816fe478e06924e13d5c802912a8d7931e9a96b8443fe00d3f27c2da756cdf')!
    const job = decodeJobAdded(jobAdded)!
    expect(job.jobId).toMatch(/^0x/)
    expect(job.executor).toMatch(/^0x/)
    expect(job.sender).toMatch(/^0x/)
    expect(job.commitBlock).toBeTypeOf('bigint')
  })

  it('decodes model/prompt/consumer from a real sovereign wake', () => {
    const job = decodeJobAdded(fixtures.sovereignJobAddedLog)!
    expect(job.model).toBeTruthy()
    expect(job.prompt).toBeTruthy()
    expect(job.cliType).toBeTypeOf('number')
    expect(job.consumer).toMatch(/^0x/)
  })

  it('returns null for a non-JobAdded log', () => {
    expect(decodeJobAdded(deliveryReceipt.logs[0]!)).toBeNull()
  })
})
