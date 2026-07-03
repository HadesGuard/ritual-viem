// Every topic0 and selector in the registry is an authored literal. This suite
// re-derives each one from its canonical signature string with viem's keccak, so
// a typo in either the literal or the signature cannot silently ship.
import { describe, expect, it } from 'vitest'
import { toEventSelector, toFunctionSelector } from 'viem'
import {
  JOB_ADDED_TOPIC,
  SYSTEM_EVENTS,
  SYSTEM_FUNCTIONS,
  ritualTestnetConfig,
} from '../src/protocol/index.js'

describe('signature integrity', () => {
  for (const event of SYSTEM_EVENTS) {
    it(`event ${event.name} topic0 matches keccak(${event.signature})`, () => {
      expect(event.topic0).toBe(toEventSelector(event.signature))
    })
  }

  for (const fn of SYSTEM_FUNCTIONS) {
    it(`function ${fn.name} selector matches keccak(${fn.signature})`, () => {
      expect(fn.selector).toBe(toFunctionSelector(fn.signature))
    })
  }

  it('JobAdded topic constant matches the registry entry', () => {
    const jobAdded = SYSTEM_EVENTS.find((event) => event.name === 'JobAdded')
    expect(jobAdded?.topic0).toBe(JOB_ADDED_TOPIC)
  })

  it('config selectors match the on-chain verified values', () => {
    expect(ritualTestnetConfig.selectors.addJob).toBe('0x57528d89')
    expect(ritualTestnetConfig.selectors.settle).toBe('0x0aa4dd19')
    expect(ritualTestnetConfig.selectors.delivery).toBe('0x20b48f49')
    expect(ritualTestnetConfig.selectors.addJob).toBe(
      toFunctionSelector(SYSTEM_FUNCTIONS.find((f) => f.name === 'addJob')!.signature),
    )
    expect(ritualTestnetConfig.selectors.settle).toBe(
      toFunctionSelector(SYSTEM_FUNCTIONS.find((f) => f.name === 'settle')!.signature),
    )
  })
})
