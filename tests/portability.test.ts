/**
 * Packed portability contract of the engine. The SDK case of the original file (two consecutive publisher
 * periods through a prospective charge) is tested with the SDK in cognovis/chp
 * (fhir-foundation/packages/fhir-billing-sdk); the missing-multiplier case is in core.test.ts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateBillingCase, compileRuleSet, toOracleParameters } from '@cognovis/fhir-billing-engine'
import { defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { mixedClassCase, mixedClassRuleSet, syntheticFixtures } from '../fixtures/portability.js'
import type { AdmissionState } from '@cognovis/fhir-billing-types'

describe('packed portability contract', () => {
  for (const fixture of syntheticFixtures) {
    // The oracle envelope is profile-free: a packed consumer needs no Billing Core profile to read it.
    it(`${fixture.id} uses the shared engine and oracle envelope`, () => {
      const result = evaluateBillingCase(compileRuleSet(fixture.ruleSet, fixture.admission), fixture.case)
      assert.equal(result.outcome, fixture.expectedOutcome)
      const envelope = toOracleParameters(fixture, result)
      assert.equal(envelope.resourceType, 'Parameters')
      assert.equal(envelope.meta?.profile, undefined)
      assert.deepEqual(envelope.parameter.slice(0, 4).map((parameter) => parameter.name), ['rule-set', 'case', 'expected-outcome', 'expected-reason'])
      assert.ok('valueCode' in envelope.parameter[2]!)
      assert.ok('valueCoding' in envelope.parameter[3]!)
      assert.equal(envelope.parameter.some((parameter) => parameter.name === 'actual-outcome' || parameter.name === 'reason'), false)
      assert.throws(() => toOracleParameters({ ...fixture, expectedOutcome: result.outcome === 'accepted' ? 'rejected' : 'accepted' }, result))
    })
  }

  it('carries every published class in one portable rule set and still withholds an unsupported family', () => {
    const admission = syntheticFixtures.find((fixture) => fixture.id === 'mixed-class-accepted')!.admission as AdmissionState
    const compiled = compileRuleSet(mixedClassRuleSet, admission)
    assert.deepEqual(compiled.withheldReasons, [])
    assert.deepEqual(compiled.ignoredRuleIds, [])
    assert.equal(compiled.rules.length, mixedClassRuleSet.rules.length)
    assert.equal(evaluateBillingCase(compiled, mixedClassCase('mixed-golden-case')).outcome, 'accepted')

    const withUnsupported = defineBillingRuleSet({
      ...mixedClassRuleSet,
      rules: [
        ...mixedClassRuleSet.rules,
        { id: 'mixed-15-future-family', class: 'future-rule-family', mustUnderstand: true, effect: 'reject', priority: 15, parameters: {} },
      ],
    })
    const withheld = compileRuleSet(withUnsupported, admission)
    assert.deepEqual(withheld.withheldReasons, [{ code: 'UNSUPPORTED_RULE', ruleId: 'mixed-15-future-family' }])
    const result = evaluateBillingCase(withheld, mixedClassCase('mixed-withheld-case'))
    assert.equal(result.outcome, 'needs-review')
    assert.equal(result.reason.code, 'UNSUPPORTED_RULE')
    assert.deepEqual(result.evaluatedRuleIds, [])
  })
})
