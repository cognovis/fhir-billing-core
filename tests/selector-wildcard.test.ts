import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BillingInputError, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
import type { AdmissionState, BillingCase, BillingLine, BillingRuleSet } from '@cognovis/fhir-billing-types'

/**
 * Unmodified contract-participation rule payloads from cognovis/fhir-billing-de
 * config/german-rule-instances.json at commit 12ce399. Every one selects the code "*".
 */
const germanParticipationRules = [
  { id: 'german-rule-50', class: 'contract-participation', mustUnderstand: true, effect: 'reject', priority: 50, parameters: { selector: { codes: ['*'] }, contract: 'https://fhir.cognovis.de/billing/Contract/private' }, effectiveStart: '2026-01-01' },
  { id: 'german-rule-60', class: 'contract-participation', mustUnderstand: true, effect: 'reject', priority: 60, parameters: { selector: { codes: ['*'] }, contract: 'https://fhir.cognovis.de/billing/Contract/bg' }, effectiveStart: '2026-01-01' },
  { id: 'german-rule-70', class: 'contract-participation', mustUnderstand: true, effect: 'reject', priority: 70, parameters: { selector: { codes: ['*'] }, contract: 'https://fhir.cognovis.de/billing/Contract/selective-contract' }, effectiveStart: '2026-01-01' },
] as const

const admission = (edition: string): AdmissionState => ({
  status: 'admitted',
  catalog: { edition: 'synthetic-2026', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  ruleSet: { edition, digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
})

const line = (code: string, system = 'http://fhir.de/CodeSystem/bäk/gnr', quantity = 1): BillingLine => ({ id: 'a', code: { system, code }, quantity, unitPrice: { value: '10.00', currency: 'EUR' } })

const caseWith = (lines: BillingLine[], contracts: string[] = []): BillingCase => ({ id: 'case-1', asOf: '2026-08-14', lines, facts: {}, contracts })

const ruleSetOf = (id: string, rule: unknown): BillingRuleSet => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id, rules: [rule] } as unknown as BillingRuleSet)

const evaluate = (id: string, rule: unknown, input: BillingCase) => evaluateBillingCase(compileRuleSet(ruleSetOf(id, rule), admission(id)), input)

const probeRule = (ruleClass: string, parameters: Record<string, unknown>) => ({ id: `${ruleClass}-probe`, class: ruleClass, mustUnderstand: true, effect: 'reject', priority: 1, parameters })

describe('selector code "*"', () => {
  it('german contract-participation rules with selector "*" reject a non-participating case', () => {
    for (const rule of germanParticipationRules) {
      const result = evaluate(rule.id, rule, caseWith([line('1')]))
      assert.equal(result.outcome, 'rejected', rule.id)
      assert.deepEqual(result.axisReasons.map((item) => [item.code, item.ruleId, item.lineId]), [['CONTRACT_PARTICIPATION_REQUIRED', rule.id, 'a']], rule.id)
      assert.deepEqual(result.evaluatedRuleIds, [rule.id], rule.id)
    }
  })

  it('selector "*" accepts a participating case and literal selectors stay literal', () => {
    for (const rule of germanParticipationRules) {
      const result = evaluate(rule.id, rule, caseWith([line('1')], [rule.parameters.contract]))
      assert.equal(result.outcome, 'accepted', rule.id)
    }
    const literal = probeRule('contract-participation', { selector: { codes: ['A'] }, contract: 'https://example.invalid/Contract/c' })
    assert.equal(evaluate('literal', literal, caseWith([line('B')])).outcome, 'accepted')
    const matched = evaluate('literal', literal, caseWith([line('A')]))
    assert.equal(matched.outcome, 'rejected')
    assert.deepEqual(matched.axisReasons.map((item) => item.code), ['CONTRACT_PARTICIPATION_REQUIRED'])
  })

  it('restricts the wildcard to selector.system when one is given', () => {
    const rule = probeRule('contract-participation', { selector: { system: 'https://example.invalid/system/a', codes: ['*'] }, contract: 'https://example.invalid/Contract/c' })
    assert.equal(evaluate('system', rule, caseWith([line('1', 'https://example.invalid/system/a')])).outcome, 'rejected')
    assert.equal(evaluate('system', rule, caseWith([line('1', 'https://example.invalid/system/b')])).outcome, 'accepted')
  })

  it('applies the wildcard to every rule class that uses the selector', () => {
    const rule = probeRule('quantity-limit', { selector: { codes: ['*'] }, maximum: 1 })
    const rejected = evaluate('quantity', rule, caseWith([line('1', 'http://fhir.de/CodeSystem/bäk/gnr', 3)]))
    assert.equal(rejected.outcome, 'rejected')
    assert.deepEqual(rejected.axisReasons.map((item) => item.code), ['QUANTITY_CAP_EXCEEDED'])
    assert.equal(evaluate('quantity', rule, caseWith([line('1', 'http://fhir.de/CodeSystem/bäk/gnr', 1)])).outcome, 'accepted')
  })

  it('mutual-exclusion with selector "*" counts the selected line itself as the excluded code', () => {
    const rule = probeRule('mutual-exclusion', { selector: { codes: ['*'] }, excluded: { codes: ['X'] } })
    const rejected = evaluate('self-exclusion', rule, caseWith([line('X')]))
    assert.equal(rejected.outcome, 'rejected')
    assert.deepEqual(rejected.axisReasons.map((item) => [item.code, item.lineId]), [['MUTUALLY_EXCLUSIVE_CODE_PRESENT', 'a']])
    assert.equal(evaluate('self-exclusion', rule, caseWith([line('Y')])).outcome, 'accepted')
  })

  it('refuses "*" mixed with other codes in the selector', () => {
    const rule = probeRule('contract-participation', { selector: { codes: ['*', 'A'] }, contract: 'https://example.invalid/Contract/c' })
    assert.throws(() => ruleSetOf('mixed', rule), (error: unknown) => error instanceof BillingInputError && /selector/.test(error.message) && /"\*"/.test(error.message))
  })

  it('refuses "*" in the excluded and required companion selectors', () => {
    const excluded = probeRule('mutual-exclusion', { selector: { codes: ['A'] }, excluded: { codes: ['*'] } })
    assert.throws(() => ruleSetOf('excluded', excluded), (error: unknown) => error instanceof BillingInputError && /excluded selector/.test(error.message))
    const required = probeRule('companion-required', { selector: { codes: ['A'] }, required: { codes: ['B', '*'] } })
    assert.throws(() => ruleSetOf('required', required), (error: unknown) => error instanceof BillingInputError && /required selector/.test(error.message))
  })
})
