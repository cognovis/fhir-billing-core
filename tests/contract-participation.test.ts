/**
 * A contract-participation rule names one contract (`contract`) or any one of several (`contracts`),
 * exactly one of the two (cognovis/fhir-billing-core#37).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { billingRuleSetDigest, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
import type { AdmissionState, BillingCase, BillingContractParticipationParameters, BillingLine, BillingRuleSet } from '@cognovis/fhir-billing-types'

const admission: AdmissionState = {
  status: 'admitted',
  catalog: { edition: 'synthetic-2026', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  ruleSet: { edition: 'participation-digest', digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
}

const line = (id: string, code: string): BillingLine => ({ id, code: { system: 'https://example.invalid/fee-schedule', code }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' } })

const caseWith = (contracts?: string[]): BillingCase => ({ id: 'case-1', asOf: '2026-08-14', lines: [line('x', 'X'), line('y', 'Y')], facts: {}, ...(contracts === undefined ? {} : { contracts }) })

const ruleSetOf = (parameters: Record<string, unknown>): BillingRuleSet =>
  defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'participation-digest', rules: [{ id: 'p', class: 'contract-participation', mustUnderstand: true, effect: 'reject', priority: 1, parameters }] } as unknown as BillingRuleSet)

const evaluate = (parameters: Record<string, unknown>, input: BillingCase) => evaluateBillingCase(compileRuleSet(ruleSetOf(parameters), admission), input)

const anyOf: BillingContractParticipationParameters = { selector: { codes: ['X'] }, contracts: ['urn:a', 'urn:b'] }

describe('contract-participation with several contracts', () => {
  it('passes a case whose contracts include any listed contract', () => {
    assert.equal(evaluate(anyOf, caseWith(['urn:b'])).outcome, 'accepted')
    assert.equal(evaluate(anyOf, caseWith(['urn:c', 'urn:a'])).outcome, 'accepted')
  })

  it('rejects only the selected lines of a case under no listed contract, naming the contracts in configured order', () => {
    for (const contracts of [['urn:c'], [], undefined]) {
      const result = evaluate(anyOf, caseWith(contracts))
      assert.equal(result.outcome, 'rejected', String(contracts))
      assert.deepEqual(result.axisReasons, [{ code: 'CONTRACT_PARTICIPATION_REQUIRED', ruleId: 'p', lineId: 'x', details: { contracts: '["urn:a","urn:b"]' } }])
    }
  })

  it('accepts any non-empty contract string, whitespace included, and names it unambiguously', () => {
    const plans = { selector: { codes: ['X'] }, contracts: ['Plan A', 'Plan B'] }
    assert.equal(evaluate(plans, caseWith(['Plan B'])).outcome, 'accepted')
    const rejected = evaluate(plans, caseWith(['Plan']))
    assert.deepEqual(rejected.axisReasons.map((item) => JSON.parse(String(item.details?.contracts))), [['Plan A', 'Plan B']])
  })

  it('refuses a rule with both, neither, an empty, duplicate, non-string, empty-string or missing entry, naming the rule', () => {
    const refused: Record<string, unknown>[] = [
      { selector: { codes: ['X'] }, contract: 'urn:a', contracts: ['urn:b'] },
      { selector: { codes: ['X'] } },
      { selector: { codes: ['X'] }, contracts: [] },
      { selector: { codes: ['X'] }, contracts: ['urn:a', 'urn:a'] },
      { selector: { codes: ['X'] }, contracts: ['urn:a', 1] },
      { selector: { codes: ['X'] }, contracts: ['urn:a', ''] },
      { selector: { codes: ['X'] }, contracts: new Array<string>(1) },
      { selector: { codes: ['X'] }, contracts: ['urn:a', , 'urn:b'] },
      { selector: { codes: ['X'] }, contracts: 'urn:a' },
    ]
    for (const parameters of refused) {
      assert.throws(() => ruleSetOf(parameters), (error: Error & { code?: string }) => error.code === 'BILLING_INPUT_INVALID' && /Rule p /.test(error.message), JSON.stringify(parameters))
    }
  })
})

describe('contract-participation with one contract', () => {
  const single = { selector: { codes: ['X'] }, contract: 'urn:a' }

  it('decides and reports exactly as 0.43.0', () => {
    assert.equal(evaluate(single, caseWith(['urn:a'])).outcome, 'accepted')
    assert.deepEqual(evaluate(single, caseWith(['urn:b'])).axisReasons, [{ code: 'CONTRACT_PARTICIPATION_REQUIRED', ruleId: 'p', lineId: 'x' }])
  })

  it('keeps the 0.43.0 rule-set digest', () => {
    assert.equal(billingRuleSetDigest(ruleSetOf(single)), 'sha256:06a74cc263d2e7f3237f448f302a16f3fe563b5b9f907ab7c9afec996a59216c')
  })
})
