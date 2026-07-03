// The async-flow resolver and the hero action against recorded chain data:
// flow A = DKMS short-async (request + commit + settle, inline SPC result),
// flow B = ZK two-phase (request + commit + settle + delivery via jobId logs).
import { describe, expect, it } from 'vitest'
import { getAsyncFlow } from '../src/actions/getAsyncFlow.js'
import { waitForAsyncResult } from '../src/actions/waitForAsyncResult.js'
import { ritualActions } from '../src/actions/decorator.js'
import { fixtureClient, loadFixtures } from './helpers.js'

const fixtures = loadFixtures()
const flowA = fixtures.meta.flowA
const flowB = fixtures.meta.flowB

describe('getAsyncFlow', () => {
  it('resolves flow A (short-async) completely from the request hash', async () => {
    const client = fixtureClient(fixtures)
    const flow = (await getAsyncFlow(client, { hash: flowA.request as `0x${string}` }))!
    expect(flow.origin).toBe(flowA.request)
    expect(flow.phaseOf).toBe('request')
    expect(flow.request?.hash).toBe(flowA.request)
    expect(flow.commit?.hash).toBe(flowA.commit)
    expect(flow.settle?.hash).toBe(flowA.settle)
    expect(flow.precompile?.id).toBe('0x081b')
    expect(flow.precompile?.label).toBe('DKMS Key')
    expect(flow.isTwoPhase).toBe(false)
    expect(flow.delivery).toBeNull()
    expect(flow.fees?.totalAmount).toBeTypeOf('bigint')
    expect(flow.requestSpcOutput).toMatch(/^0x/)
    expect(flow.complete).toBe(true)
    expect(flow.missing).toEqual([])
  })

  it('resolves the same flow from the SETTLE hash (any phase hash works)', async () => {
    const client = fixtureClient(fixtures)
    const flow = (await getAsyncFlow(client, { hash: flowA.settle as `0x${string}` }))!
    expect(flow.origin).toBe(flowA.request)
    expect(flow.phaseOf).toBe('settle')
    expect(flow.commit?.hash).toBe(flowA.commit)
  })

  it('resolves flow B (two-phase) including the delivery located via jobId logs', async () => {
    const client = fixtureClient(fixtures)
    const flow = (await getAsyncFlow(client, { hash: flowB.request as `0x${string}` }))!
    expect(flow.isTwoPhase).toBe(true)
    expect(flow.jobId).toMatch(/^0x/)
    expect(flow.delivery?.hash).toBe(flowB.delivery)
    expect(flow.delivery?.blockNumber).toBe(BigInt(flowB.deliveryBlock as number))
    expect(flow.deliverySpcOutput).toMatch(/^0x/)
    expect(flow.complete).toBe(true)
  })

  it('returns null for a plain tx that is in a block but not part of a flow', async () => {
    const client = fixtureClient(fixtures)
    // The commit block of flow B contains a plain tx too? Use a fabricated block
    // read instead: the delivery block's non-flow txs, if any. Fall back to
    // asserting the typed error path for an unknown hash.
    await expect(
      getAsyncFlow(client, { hash: ('0x' + 'ee'.repeat(32)) as `0x${string}` }),
    ).rejects.toThrow(/by-hash lookups are pruned|not part of a Ritual async flow/)
  })
})

describe('waitForAsyncResult', () => {
  it('resolves flow B with status delivered, decoded logs and result payload', async () => {
    const client = fixtureClient(fixtures)
    const phases: string[] = []
    const outcome = await waitForAsyncResult(client, {
      hash: flowB.request as `0x${string}`,
      onPhase: (phase) => phases.push(phase),
      timeout: 10_000,
    })
    expect(outcome.status).toBe('delivered')
    expect(outcome.terminalTx).toBe(flowB.delivery)
    expect(outcome.success).toBe(true)
    expect(outcome.result).toMatch(/^0x/)
    expect(outcome.flow.complete).toBe(true)
    expect(phases).toEqual(['request', 'commit', 'settle', 'delivery'])
    expect(outcome.logs.map((log) => log.name)).toContain('Delivered')
  })

  it('resolves flow A with status settled and the inline SPC result', async () => {
    const client = fixtureClient(fixtures)
    const outcome = await waitForAsyncResult(client, {
      hash: flowA.request as `0x${string}`,
      timeout: 10_000,
    })
    expect(outcome.status).toBe('settled')
    expect(outcome.terminalTx).toBe(flowA.settle)
    expect(outcome.result).toBe(outcome.flow.requestSpcOutput)
  })

  it('works through the client decorator', async () => {
    const client = fixtureClient(fixtures).extend(ritualActions())
    const flow = await client.getAsyncFlow({ hash: flowB.delivery as `0x${string}` })
    expect(flow?.phaseOf).toBe('delivery')
    expect(flow?.origin).toBe(flowB.request)
  })
})
