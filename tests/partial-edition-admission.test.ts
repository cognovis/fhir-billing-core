/**
 * Partial catalog edition admission on the engine result. The SDK cases of the original file (prospective
 * charges on partial and legacy editions) are tested with the SDK in cognovis/chp
 * (fhir-foundation/packages/fhir-billing-sdk).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BILLING_REASON_CODES, type AdmissionState, type BillingCase, type BillingRuleSet } from '@cognovis/fhir-billing-types'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'

describe('partial catalog edition admission', () => {
  it('lists CATALOG_PARTIAL in BILLING_REASON_CODES', () => {
    assert.ok((BILLING_REASON_CODES as readonly string[]).includes('CATALOG_PARTIAL'))
  })
})

describe('partial edition advisory on the engine result', () => {
  const ruleSet: BillingRuleSet = {
    schemaVersion: 2,
    semanticMajor: 4,
    id: 'portable-rules',
    rules: [
      { id: 'limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 10, parameters: { maximum: 2, selector: { codes: ['A'] } } },
      { id: 'setting', class: 'setting-constraint', mustUnderstand: true, effect: 'reject', priority: 20, parameters: { selector: { codes: ['B'] }, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: ['setting-one'] } } },
    ],
  }
  const edition = (completeness: 'complete' | 'partial') => ({ digest: 'sha256:x', availability: 'available' as const, completeness, entitled: true, compatible: true, digestMatches: true })
  const admission = (catalog: 'complete' | 'partial', rules: 'complete' | 'partial'): AdmissionState => ({
    status: 'admitted',
    catalog: { ...edition(catalog), edition: 'synthetic-2026' },
    ruleSet: { ...edition(rules), edition: 'portable-rules' },
  })
  const line = (code: string, quantity: number) => ({ id: `line-${code}`, code: { system: 'https://example.invalid/system/service', code }, quantity, unitPrice: { value: '10.00', currency: 'EUR' } })
  const billingCase = (lines: BillingCase['lines']): BillingCase => ({ id: 'case-1', asOf: '2026-08-14', lines, facts: {} })
  const advisory = [{ code: 'CATALOG_PARTIAL', details: { edition: 'synthetic-2026' } }]

  it('marks an accepted and a rejected result of a partial catalog or rule-set edition with CATALOG_PARTIAL', () => {
    for (const [catalog, rules] of [['partial', 'complete'], ['complete', 'partial'], ['partial', 'partial']] as const) {
      const compiled = compileRuleSet(ruleSet, admission(catalog, rules))
      const accepted = evaluateBillingCase(compiled, billingCase([line('A', 1)]))
      assert.equal(accepted.outcome, 'accepted')
      assert.deepEqual(accepted.advisories, advisory)
      const rejected = evaluateBillingCase(compiled, billingCase([line('A', 3)]))
      assert.equal(rejected.outcome, 'rejected')
      assert.deepEqual(rejected.advisories, advisory)
    }
  })

  it('carries no advisory on a complete edition or on a needs-review result', () => {
    const complete = evaluateBillingCase(compileRuleSet(ruleSet, admission('complete', 'complete')), billingCase([line('A', 1)]))
    assert.equal(complete.outcome, 'accepted')
    assert.equal('advisories' in complete, false)
    const review = evaluateBillingCase(compileRuleSet(ruleSet, admission('partial', 'partial')), billingCase([line('B', 1)]))
    assert.equal(review.outcome, 'needs-review')
    assert.equal('advisories' in review, false)
    const withheld = evaluateBillingCase(compileRuleSet(ruleSet, { ...admission('partial', 'complete'), catalog: { ...admission('partial', 'complete').catalog, entitled: false } }), billingCase([line('A', 1)]))
    assert.equal(withheld.outcome, 'needs-review')
    assert.equal('advisories' in withheld, false)
  })
})
