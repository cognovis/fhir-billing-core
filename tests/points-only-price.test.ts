import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BillingInputError, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase, evaluateConformanceCases, resolveCatalogUnitPrices } from '@cognovis/fhir-billing-engine'
import type { AdmissionState, BillingCase, BillingLine, BillingRule } from '@cognovis/fhir-billing-types'

/**
 * cognovis/fhir-billing-core#99: a line whose catalog definition carries points but no euro amount has
 * an unknown unit price, never a fabricated one. Only `value-limit` reads the price, and it leaves such
 * a line undecided with `UNIT_PRICE_UNAVAILABLE`.
 */
const SYSTEM = 'https://example.test/CodeSystem/points-service'

const admission: AdmissionState = {
  status: 'admitted',
  catalog: { edition: 'points-2026', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  ruleSet: { edition: 'points-rules', digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
}

function ruleSet(...rules: readonly Omit<BillingRule, 'mustUnderstand' | 'priority'>[]) {
  return compileRuleSet(defineBillingRuleSet({
    schemaVersion: 2,
    semanticMajor: 4,
    id: 'points-rules',
    rules: rules.map((rule, index) => ({ mustUnderstand: true, priority: index + 1, ...rule })),
  } as never), admission)
}

const valueLimit = { id: 'value', class: 'value-limit', effect: 'reject', parameters: { selector: { system: SYSTEM, codes: ['P1', 'P2'] }, maximum: '20.00' } } as const
const quantityLimit = { id: 'quantity', class: 'quantity-limit', effect: 'reject', parameters: { selector: { system: SYSTEM, codes: ['P1'] }, maximum: 1 } } as const

function unknownLine(id: string, code: string, quantity = 1): BillingLine {
  return { id, code: { system: SYSTEM, code }, quantity, unitPriceUnknown: true }
}

function caseOf(...lines: BillingLine[]): BillingCase {
  return { id: 'case-points', asOf: '2026-08-14', lines, facts: {} }
}

describe('engine line contract: a unit price that is unknown (#99)', () => {
  it('leaves a value-limit on a line with an unknown unit price undecided with UNIT_PRICE_UNAVAILABLE', () => {
    const result = evaluateBillingCase(ruleSet(valueLimit), caseOf(unknownLine('a', 'P1')))
    assert.equal(result.outcome, 'needs-review')
    assert.deepEqual(result.axisReasons.map((reason) => [reason.code, reason.ruleId, reason.lineId]), [['UNIT_PRICE_UNAVAILABLE', 'value', 'a']])
  })

  it('still decides a value-limit on a known line beside an unknown one, and the unknown line stays undecided', () => {
    const known: BillingLine = { id: 'b', code: { system: SYSTEM, code: 'P2' }, quantity: 3, unitPrice: { value: '10.00', currency: 'EUR' } }
    const result = evaluateBillingCase(ruleSet(valueLimit), caseOf(unknownLine('a', 'P1'), known))
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons.map((reason) => [reason.code, reason.lineId]), [['VALUE_CAP_APPLICABLE', 'b'], ['UNIT_PRICE_UNAVAILABLE', 'a']])
  })

  it('decides rules that need no amount on a line with an unknown unit price', () => {
    assert.equal(evaluateBillingCase(ruleSet(quantityLimit), caseOf(unknownLine('a', 'P1', 2))).outcome, 'rejected')
    assert.equal(evaluateBillingCase(ruleSet(quantityLimit), caseOf(unknownLine('a', 'P1', 1))).outcome, 'accepted')
  })

  it('requires exactly one of a unit price and the unknown marker on a line', () => {
    const neither = { id: 'a', code: { system: SYSTEM, code: 'P1' }, quantity: 1 } as BillingLine
    const both = { ...unknownLine('a', 'P1'), unitPrice: { value: '0.00', currency: 'EUR' } } as BillingLine
    const falseMarker = { ...neither, unitPriceUnknown: false } as unknown as BillingLine
    for (const line of [neither, both, falseMarker]) {
      assert.throws(() => evaluateBillingCase(ruleSet(quantityLimit), caseOf(line)), BillingInputError, JSON.stringify(line))
    }
  })

  it('accepts the unknown marker in a standalone JSON case and refuses a line with neither', () => {
    const payload = { schemaVersion: 2, semanticMajor: 4, id: 'points-rules', rules: [{ ...valueLimit, mustUnderstand: true, priority: 1 }] }
    const neither = { id: 'neither', asOf: '2026-08-14', facts: {}, lines: [{ id: 'a', code: { system: SYSTEM, code: 'P1' }, quantity: 1 }] }
    const records = evaluateConformanceCases({ ruleSet: payload, cases: [{ ...caseOf(unknownLine('a', 'P1')), id: 'unknown' }, neither] })
    assert.deepEqual(records.map((record) => [record.caseId, record.decision, record.findings.map((finding) => [finding.code, finding.effect])]), [
      ['unknown', 'unavailable', [['UNIT_PRICE_UNAVAILABLE', 'needs-review']]],
      ['neither', 'unavailable', [['BILLING_INPUT_INVALID', 'needs-review']]],
    ])
  })
})

describe('catalog price table with points-only entries (#99)', () => {
  const table = {
    edition: 'points-2026',
    digest: 'sha256:catalog',
    currency: 'EUR',
    prices: [
      { system: SYSTEM, code: 'P1', unitPriceUnknown: true as const },
      { system: SYSTEM, code: 'P2', unitPrice: '15.00' },
    ],
  }

  it('marks a catalog-priced line unknown when its entry is points-only and prices one with an amount', () => {
    const placeholder: BillingLine = { id: 'a', code: { system: SYSTEM, code: 'P1' }, quantity: 1, unitPrice: { value: '0.00', currency: 'EUR' } }
    const resolved = resolveCatalogUnitPrices(caseOf(placeholder, unknownLine('b', 'P2')), table, admission)
    assert.deepEqual(resolved.lines.map((line) => [line.id, line.unitPrice, line.unitPriceUnknown]), [
      ['a', undefined, true],
      ['b', { value: '15.00', currency: 'EUR' }, undefined],
    ])
    assert.equal(Object.hasOwn(resolved.lines[0]!, 'unitPrice'), false)
  })

  it('keeps an unknown line unknown when its entry is points-only, with no table currency', () => {
    const { currency: _currency, ...withoutCurrency } = table
    const pointsOnly = { ...withoutCurrency, prices: [table.prices[0]!] }
    const resolved = resolveCatalogUnitPrices(caseOf(unknownLine('a', 'P1')), pointsOnly, admission)
    assert.deepEqual(resolved.lines, [unknownLine('a', 'P1')])
  })

  it('keeps a source-carried unit price on a line whose entry is points-only', () => {
    const sourced: BillingLine = { id: 'a', code: { system: SYSTEM, code: 'P1' }, quantity: 1, unitPrice: { value: '7.00', currency: 'EUR' } }
    assert.deepEqual(resolveCatalogUnitPrices(caseOf(sourced), table, admission).lines, [sourced])
  })

  it('fails closed for an unknown line without a table entry, and for a priced entry without a table currency', () => {
    assert.throws(() => resolveCatalogUnitPrices(caseOf(unknownLine('a', 'P3')), table, admission), BillingInputError)
    const { currency: _currency, ...withoutCurrency } = table
    assert.throws(() => resolveCatalogUnitPrices(caseOf(unknownLine('b', 'P2')), withoutCurrency, admission), BillingInputError)
  })

  it('rejects a table entry with both or neither of a unit price and the unknown marker', () => {
    for (const entry of [{ system: SYSTEM, code: 'P1' }, { system: SYSTEM, code: 'P1', unitPrice: '1.00', unitPriceUnknown: true as const }]) {
      assert.throws(() => resolveCatalogUnitPrices(caseOf(unknownLine('a', 'P1')), { ...table, prices: [entry] }, admission), BillingInputError, JSON.stringify(entry))
    }
  })
})
