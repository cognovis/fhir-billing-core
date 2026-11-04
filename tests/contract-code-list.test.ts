/**
 * A contract's code list (cognovis/fhir-billing-core#54): the contract-code-list rule class and its
 * engine algorithm. The block of a Schein's line outside its Contract's code list is tested with the SDK
 * in cognovis/chp (fhir-foundation/packages/fhir-billing-sdk). Every Contract, code system and rule is
 * synthetic.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BillingInputError, decodeBillingRuleSet, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
import type { AdmissionState, BillingRule, BillingRuleSet } from '@cognovis/fhir-billing-types'
import { AS_OF, SECOND_SYSTEM, SELECTIVE, SYSTEM } from './rule-set-binding-fixtures.js'

/** The selective Contract's code list: K-1 and the uncatalogued H-1 of the fee schedule's code system. */
const CODE_LIST: BillingRule = {
  id: 'selective-code-list',
  class: 'contract-code-list',
  mustUnderstand: true,
  effect: 'reject',
  priority: 1,
  parameters: { selector: { system: SYSTEM, codes: ['*'] }, permitted: { system: SYSTEM, codes: ['K-1', 'H-1'] } },
}

describe('the contract-code-list rule class', () => {
  it('refuses a code list without codes, with "*", with an unknown parameter, or outside a contract rule set', () => {
    const ruleSet = (parameters: Record<string, unknown>, appliesTo: BillingRuleSet['appliesTo'] | null = { contracts: [SELECTIVE] }): BillingRuleSet => ({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'code-list',
      ...(appliesTo !== null ? { appliesTo } : {}),
      rules: [{ ...CODE_LIST, parameters }],
    })
    const selector = { system: SYSTEM, codes: ['*'] }
    assert.doesNotThrow(() => defineBillingRuleSet(ruleSet({ selector, permitted: { system: SYSTEM, codes: ['K-1'] } })))
    for (const parameters of [
      { selector },
      { selector, permitted: { system: SYSTEM, codes: [] } },
      { selector, permitted: { system: SYSTEM, codes: ['*'] } },
      { selector, permitted: { system: SYSTEM, codes: ['K-1'], extra: true } },
      { selector, permitted: { system: SYSTEM, codes: ['K-1'] }, contract: SELECTIVE },
    ]) {
      assert.throws(() => defineBillingRuleSet(ruleSet(parameters)), BillingInputError, JSON.stringify(parameters))
    }
    // An inactive rule is skipped, so a dated code list would let every code pass outside its dates.
    for (const dates of [{ effectiveEnd: '2025-12-31' }, { effectiveStart: '2027-01-01' }]) {
      const dated: BillingRuleSet = { schemaVersion: 2, semanticMajor: 4, id: 'code-list', appliesTo: { contracts: [SELECTIVE] }, rules: [{ ...CODE_LIST, ...dates }] }
      assert.throws(() => defineBillingRuleSet(dated), /effective period/, JSON.stringify(dates))
    }
    // A code list takes exactly selector and permitted: a counting window would bring another Account's
    // lines into this Schein's verdict, and an exception or a modifier would let a code outside the list pass.
    for (const shared of [
      { countingScope: { window: 'day', subject: 'patient' } },
      { countingScope: { window: 'quarter', subject: 'patient' } },
      { exceptWhen: { fact: 'synthetic-report', valueIn: ['structured'] } },
      { modifierExceptions: ['EXEMPT'] },
    ]) {
      const key = Object.keys(shared)[0]!
      const payload = ruleSet({ selector, permitted: { system: SYSTEM, codes: ['K-1'] }, ...shared })
      assert.throws(() => defineBillingRuleSet(payload), new RegExp(`does not accept key ${key}`), JSON.stringify(shared))
      assert.throws(() => decodeBillingRuleSet(payload), new RegExp(`does not accept key ${key}`), JSON.stringify(shared))
    }
    assert.throws(() => defineBillingRuleSet(ruleSet({ selector, permitted: { system: SYSTEM, codes: ['K-1'] } }, null)), /contract rule set/)
    assert.throws(() => decodeBillingRuleSet(ruleSet({ selector, permitted: { system: SYSTEM, codes: ['K-1'] } }, null)), /contract rule set/)
    assert.throws(() => defineBillingRuleSet(ruleSet({ selector, permitted: { system: SYSTEM, codes: ['K-1'] } }, { catalogEditions: ['https://example.invalid/Library/edition'] })), /contract rule set/)
  })
})

describe('the contract-code-list engine algorithm', () => {
  const admission: AdmissionState = {
    status: 'admitted',
    catalog: { edition: 'synthetic', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
    ruleSet: { edition: 'code-list', digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  }
  const compiled = compileRuleSet(defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'code-list', appliesTo: { contracts: [SELECTIVE] }, rules: [CODE_LIST] }), admission)
  const line = (id: string, system: string, code: string) => ({ id, code: { system, code }, quantity: 1, unitPriceUnknown: true as const })

  it('rejects each selected line outside the list and leaves the lines in it and outside the selector alone', () => {
    const result = evaluateBillingCase(compiled, {
      id: 'case',
      asOf: AS_OF,
      facts: {},
      lines: [line('a', SYSTEM, 'K-1'), line('b', SYSTEM, 'K-2'), line('c', SECOND_SYSTEM, 'K-2'), line('d', SYSTEM, 'H-9')],
    })
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons.map((reason) => [reason.code, reason.lineId]), [['CONTRACT_CODE_NOT_PERMITTED', 'b'], ['CONTRACT_CODE_NOT_PERMITTED', 'd']])
  })

  it('matches a list without a system against the code alone', () => {
    const anySystem = compileRuleSet(defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'code-list',
      appliesTo: { contracts: [SELECTIVE] },
      rules: [{ ...CODE_LIST, parameters: { selector: { codes: ['*'] }, permitted: { codes: ['K-1'] } } }],
    }), admission)
    const result = evaluateBillingCase(anySystem, { id: 'case', asOf: AS_OF, facts: {}, lines: [line('a', SYSTEM, 'K-1'), line('b', SECOND_SYSTEM, 'K-1')] })
    assert.equal(result.outcome, 'accepted', JSON.stringify(result.axisReasons))
  })
})
