import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareConformanceRecords, compileRuleSet, evaluateBillingCase, evaluateConformanceCases } from '@cognovis/fhir-billing-engine'
import type { AdmissionState, BillingCase, BillingReason, BillingRule, BillingRuleSet } from '@cognovis/fhir-billing-types'

const SERVICE = 'https://example.invalid/system/service'
const DIAGNOSIS = 'https://example.invalid/system/diagnosis'
const PROCEDURE = 'https://example.invalid/system/procedure'

type RuleInput = Omit<BillingRule, 'mustUnderstand' | 'effect' | 'priority'> & { readonly effect?: BillingRule['effect'] }

function ruleSet(id: string, rules: readonly RuleInput[]): BillingRuleSet {
  return {
    schemaVersion: 2,
    semanticMajor: 4,
    id,
    rules: rules.map((rule, index) => ({ mustUnderstand: true, effect: 'reject', priority: index + 1, ...rule })),
  } as BillingRuleSet
}

function admission(id: string): AdmissionState {
  return {
    status: 'admitted',
    catalog: { edition: 'synthetic-2026', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
    ruleSet: { edition: id, digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  }
}

function line(id: string, code: string, system = SERVICE): BillingCase['lines'][number] {
  return { id, code: { system, code }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' } }
}

function evaluate(rules: Parameters<typeof ruleSet>[1], input: Partial<BillingCase>) {
  const compiled = compileRuleSet(ruleSet('remedy-rules', rules), admission('remedy-rules'))
  return evaluateBillingCase(compiled, { id: 'case-1', asOf: '2026-08-14', lines: [line('a', 'A')], facts: {}, ...input })
}

const companionRule = {
  id: 'companion',
  class: 'companion-required',
  parameters: { selector: { system: SERVICE, codes: ['A'] }, required: { system: SERVICE, codes: ['C2', 'C1'] } },
} as const

const exclusionRule = {
  id: 'exclusive',
  class: 'mutual-exclusion',
  parameters: { selector: { system: SERVICE, codes: ['A'] }, excluded: { system: SERVICE, codes: ['X1', 'X2'] } },
} as const

function diagnosisRule(polarity: 'include' | 'exclude', system?: string) {
  return {
    id: `diagnosis-${polarity}`,
    class: 'diagnosis-requirement',
    parameters: {
      selector: { codes: ['A'] },
      diagnosis: { fact: 'diagnoses', ...(system ? { system } : {}), polarity, valueIn: ['D2', { code: 'D1', qualifiers: { certainty: ['confirmed'] } }] },
    },
  } as const
}

function withoutResolution(reason: BillingReason): BillingReason {
  const { resolution: _resolution, ...rest } = reason
  return rest
}

describe('reason resolutions', () => {
  it('names the required companion codes for COMPANION_CODE_REQUIRED, in configured order', () => {
    const result = evaluate([companionRule], {})
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons, [{
      code: 'COMPANION_CODE_REQUIRED',
      ruleId: 'companion',
      lineId: 'a',
      resolution: { action: 'add-one-of', codes: [{ system: SERVICE, code: 'C2' }, { system: SERVICE, code: 'C1' }] },
    }])
  })

  it('omits the system of a companion code when the required selector names none', () => {
    const result = evaluate([{ ...companionRule, parameters: { selector: { codes: ['A'] }, required: { codes: ['C1'] } } }], {})
    assert.deepEqual(result.axisReasons[0]!.resolution, { action: 'add-one-of', codes: [{ code: 'C1' }] })
  })

  it('names the admissible diagnosis codes for an include requirement', () => {
    // D1 is present, but only as suspected; the resolution names the qualifier values that would satisfy the rule.
    const result = evaluate([diagnosisRule('include', DIAGNOSIS)], { facts: { diagnoses: [{ code: 'D9', system: DIAGNOSIS }, { code: 'D1', system: DIAGNOSIS, certainty: 'suspected' }] } })
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons, [{
      code: 'DIAGNOSIS_NOT_SATISFIED',
      ruleId: 'diagnosis-include',
      lineId: 'a',
      details: { fact: 'diagnoses', polarity: 'include' },
      resolution: { action: 'add-one-of', codes: [{ system: DIAGNOSIS, code: 'D2' }, { system: DIAGNOSIS, code: 'D1', qualifiers: { certainty: ['confirmed'] } }] },
    }])
    const withoutSystem = evaluate([diagnosisRule('include')], { facts: { diagnoses: { kind: 'billing-fact', state: 'known-absent' } } })
    assert.deepEqual(withoutSystem.axisReasons[0]!.resolution, { action: 'add-one-of', codes: [{ code: 'D2' }, { code: 'D1', qualifiers: { certainty: ['confirmed'] } }] })
  })

  it('names the present diagnosis codes that caused an exclude block, as supplied', () => {
    const result = evaluate([diagnosisRule('exclude', DIAGNOSIS)], {
      facts: { diagnoses: [{ code: 'D7', system: DIAGNOSIS }, { code: 'D2', system: DIAGNOSIS }, { code: 'D1', system: DIAGNOSIS, certainty: 'suspected' }, { code: 'D1', system: DIAGNOSIS, certainty: 'confirmed' }] },
    })
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons, [{
      code: 'DIAGNOSIS_NOT_SATISFIED',
      ruleId: 'diagnosis-exclude',
      lineId: 'a',
      details: { fact: 'diagnoses', polarity: 'exclude' },
      resolution: { action: 'remove', codes: [{ system: DIAGNOSIS, code: 'D2' }, { system: DIAGNOSIS, code: 'D1' }] },
    }])
    const plain = evaluate([diagnosisRule('exclude')], { facts: { diagnoses: ['D0', 'D2'] } })
    assert.deepEqual(plain.axisReasons[0]!.resolution, { action: 'remove', codes: [{ code: 'D2' }] })
  })

  it('also names present exclude entries that are ambiguous for the predicate, de-duplicated in supplied order', () => {
    const result = evaluate([diagnosisRule('exclude', DIAGNOSIS)], {
      facts: { diagnoses: [{ code: 'D2' }, { code: 'D7', system: DIAGNOSIS }, { code: 'D1', system: DIAGNOSIS, certainty: 'confirmed' }, { code: 'D1', system: DIAGNOSIS }, { code: 'D2' }] },
    })
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons[0]!.details, { fact: 'diagnoses', polarity: 'exclude' })
    // D2 without a system and D1 without its qualifier are ambiguous, yet removing them is part of the fix.
    assert.deepEqual(result.axisReasons[0]!.resolution, { action: 'remove', codes: [{ code: 'D2' }, { system: DIAGNOSIS, code: 'D1' }] })
  })

  it('gives a reason no resolution when its rule has effect needs-review', () => {
    const companion = evaluate([{ ...companionRule, effect: 'needs-review' }], {})
    assert.equal(companion.outcome, 'needs-review')
    assert.deepEqual(companion.axisReasons, [{ code: 'COMPANION_CODE_REQUIRED', ruleId: 'companion', lineId: 'a' }])
    const diagnosis = evaluate([{ ...diagnosisRule('include', DIAGNOSIS), effect: 'needs-review' }], { facts: { diagnoses: [] } })
    assert.equal(diagnosis.outcome, 'needs-review')
    assert.deepEqual(diagnosis.axisReasons, [{ code: 'DIAGNOSIS_NOT_SATISFIED', ruleId: 'diagnosis-include', lineId: 'a', details: { fact: 'diagnoses', polarity: 'include' } }])
  })

  it('gives an indeterminate diagnosis reason no resolution', () => {
    const result = evaluate([diagnosisRule('include', DIAGNOSIS)], { facts: { diagnoses: [{ code: 'D2' }] } })
    assert.equal(result.outcome, 'needs-review')
    assert.equal(result.axisReasons[0]!.code, 'DIAGNOSIS_INDETERMINATE')
    assert.equal('resolution' in result.axisReasons[0]!, false)
  })

  it('resolves PROCEDURE_FINDING_NOT_SATISFIED by the same rule as the diagnosis reason', () => {
    const procedureRule = (polarity: 'include' | 'exclude') => ({
      id: `procedure-${polarity}`,
      class: 'procedure-finding-requirement',
      parameters: { selector: { codes: ['A'] }, procedure: { fact: 'findings', system: PROCEDURE, polarity, valueIn: ['P1', 'P2'] } },
    } as const)
    const include = evaluate([procedureRule('include')], { facts: { findings: [] } })
    assert.deepEqual(include.axisReasons, [{
      code: 'PROCEDURE_FINDING_NOT_SATISFIED',
      ruleId: 'procedure-include',
      lineId: 'a',
      details: { fact: 'findings', polarity: 'include' },
      resolution: { action: 'add-one-of', codes: [{ system: PROCEDURE, code: 'P1' }, { system: PROCEDURE, code: 'P2' }] },
    }])
    const exclude = evaluate([procedureRule('exclude')], { facts: { findings: [{ code: 'P2', system: PROCEDURE }] } })
    assert.deepEqual(exclude.axisReasons[0]!.resolution, { action: 'remove', codes: [{ system: PROCEDURE, code: 'P2' }] })
  })

  it('names the conflicting present lines with their line ids for MUTUALLY_EXCLUSIVE_CODE_PRESENT, in line order', () => {
    const result = evaluate([exclusionRule], { lines: [line('x2', 'X2'), line('a', 'A'), line('other', 'X1', 'https://example.invalid/system/other'), line('x1', 'X1')] })
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons, [{
      code: 'MUTUALLY_EXCLUSIVE_CODE_PRESENT',
      ruleId: 'exclusive',
      lineId: 'a',
      resolution: { action: 'remove', codes: [{ system: SERVICE, code: 'X2', lineId: 'x2' }, { system: SERVICE, code: 'X1', lineId: 'x1' }] },
    }])
  })

  it('resolves every mutual-exclusion block by its listed removals, removing the own line when it is itself excluded', () => {
    const scenarios = [
      {
        name: 'disjoint selector and excluded codes',
        parameters: { selector: { system: SERVICE, codes: ['A'] }, excluded: { system: SERVICE, codes: ['X1', 'X2'] } },
        lines: [line('a', 'A'), line('x1', 'X1'), line('x2', 'X2')],
        expected: [['a', ['x1', 'x2']]],
      },
      {
        name: 'overlapping selector and excluded codes',
        parameters: { selector: { system: SERVICE, codes: ['A', 'X1'] }, excluded: { system: SERVICE, codes: ['X1', 'X2'] } },
        lines: [line('a', 'A'), line('x1', 'X1'), line('x2', 'X2')],
        expected: [['a', ['x1', 'x2']], ['x1', ['x1']]],
      },
      {
        name: 'wildcard selector',
        parameters: { selector: { system: SERVICE, codes: ['*'] }, excluded: { system: SERVICE, codes: ['X1'] } },
        lines: [line('a', 'A'), line('x1', 'X1'), line('x1b', 'X1')],
        expected: [['a', ['x1', 'x1b']], ['x1', ['x1']], ['x1b', ['x1b']]],
      },
    ] as const
    for (const scenario of scenarios) {
      const rules = [{ ...exclusionRule, parameters: scenario.parameters }]
      const result = evaluate(rules, { lines: [...scenario.lines] })
      assert.deepEqual(
        result.axisReasons.map((item) => [item.lineId, item.resolution?.action, item.resolution?.codes.map((code) => code.lineId)]),
        scenario.expected.map(([lineId, removed]) => [lineId, 'remove', [...removed]]),
        scenario.name,
      )
      for (const blocked of result.axisReasons) {
        const removed = new Set(blocked.resolution!.codes.map((code) => code.lineId))
        const fixed = evaluate(rules, { lines: scenario.lines.filter((item) => !removed.has(item.id)) })
        assert.equal(
          fixed.axisReasons.some((item) => item.code === 'MUTUALLY_EXCLUSIVE_CODE_PRESENT' && item.lineId === blocked.lineId),
          false,
          `${scenario.name}: removing ${[...removed].join(', ')} resolves line ${blocked.lineId}`,
        )
      }
    }
  })

  it('keeps outcomes, reason codes, order and details unchanged and adds a resolution to no other reason', () => {
    const result = evaluate([
      companionRule,
      exclusionRule,
      diagnosisRule('exclude'),
      { id: 'limit', class: 'quantity-limit', parameters: { selector: { codes: ['A'] }, maximum: 0 } },
    ], { lines: [line('a', 'A'), line('x1', 'X1')], facts: { diagnoses: ['D2'] } })
    assert.equal(result.outcome, 'rejected')
    // The reasons as 0.13.0 returned them; the resolution is the only addition.
    assert.deepEqual(result.axisReasons.map(withoutResolution), [
      { code: 'COMPANION_CODE_REQUIRED', ruleId: 'companion', lineId: 'a' },
      { code: 'MUTUALLY_EXCLUSIVE_CODE_PRESENT', ruleId: 'exclusive', lineId: 'a' },
      { code: 'DIAGNOSIS_NOT_SATISFIED', ruleId: 'diagnosis-exclude', lineId: 'a', details: { fact: 'diagnoses', polarity: 'exclude' } },
      { code: 'QUANTITY_CAP_EXCEEDED', ruleId: 'limit', lineId: 'a' },
    ])
    assert.deepEqual(result.axisReasons.map((item) => item.resolution?.action), ['add-one-of', 'remove', 'remove', undefined])
    assert.equal('resolution' in result.axisReasons[3]!, false)
  })
})

// The SDK decision reason carrying the resolution is tested with the SDK in cognovis/chp
// (cognovis/fhir-billing-core#212).
describe('reason resolutions outside the engine', () => {
  it('carries the resolution into the standalone conformance finding, and comparison ignores it', () => {
    const payload = ruleSet('standalone-remedy', [companionRule, exclusionRule])
    const [record] = evaluateConformanceCases({
      ruleSet: payload,
      cases: [{ id: 'both', asOf: '2026-08-14', lines: [line('a', 'A'), line('x1', 'X1')], facts: {} }],
    })
    assert.equal(record!.decision, 'block')
    assert.deepEqual(record!.findings, [
      {
        code: 'COMPANION_CODE_REQUIRED', ruleId: 'companion', lineId: 'a', effect: 'reject',
        resolution: { action: 'add-one-of', codes: [{ system: SERVICE, code: 'C2' }, { system: SERVICE, code: 'C1' }] },
      },
      {
        code: 'MUTUALLY_EXCLUSIVE_CODE_PRESENT', ruleId: 'exclusive', lineId: 'a', effect: 'reject',
        resolution: { action: 'remove', codes: [{ system: SERVICE, code: 'X1', lineId: 'x1' }] },
      },
    ])
    const stripped = { ...record!, findings: record!.findings.map(({ resolution: _resolution, ...rest }) => rest) }
    assert.deepEqual(compareConformanceRecords([record], [stripped]), [])
  })
})
