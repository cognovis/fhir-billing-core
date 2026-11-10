import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  BILLING_INTERPRETABLE_UNITS,
  BILLING_RULE_CLASS_DEFINITIONS,
  BillingInputError,
  admitBillingRuleSet,
  billingRulePayloadDigest,
  canonicalizeJson,
  compareUnitBearingValues,
  defineBillingRuleSet,
  sortRules,
} from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase, resolveCatalogUnitPrices, toOracleParameters } from '@cognovis/fhir-billing-engine'
import { BILLING_REASON_CODES } from '@cognovis/fhir-billing-types'
import type { AdmissionState, BillingCase, BillingFactValue, BillingReasonCode, BillingRule, BillingRulePayloadV2, BillingRuleSet, GenericRuleClass } from '@cognovis/fhir-billing-types'
import { mixedClassCase, mixedClassRuleSet } from '../fixtures/portability.js'

const completeAdmission: AdmissionState = {
  status: 'admitted',
  catalog: { edition: 'synthetic-2026', digest: 'sha256:catalog', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  ruleSet: { edition: 'portable-rules', digest: 'sha256:rules', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
}

const baseCase: BillingCase = {
  id: 'case-1',
  asOf: '2026-08-14',
  lines: [{ id: 'a', code: { system: 'https://example.invalid/system/service', code: 'A' }, quantity: 3, unitPrice: { value: '10.00', currency: 'EUR' } }],
  facts: {},
}

const publishedClasses: readonly string[] = [
  'accompanying-information-required', 'bounded-multiplier', 'companion-required',
  'contract-code-list', 'contract-participation', 'diagnosis-requirement', 'minimum-evidence-count', 'mutual-exclusion',
  'patient-attribute-constraint', 'prior-authorization-required',
  'procedure-finding-requirement', 'provider-eligibility', 'quantity-limit',
  'quota-degression', 'setting-constraint', 'value-limit',
]

const terminology = readFileSync('input/fsh/terminology.fsh', 'utf8')

function codeSystemCodes(name: string): string[] {
  const start = terminology.indexOf(`CodeSystem: ${name}\n`)
  assert.notEqual(start, -1, name)
  const body = terminology.slice(start)
  const end = body.slice(1).search(/\n(?:CodeSystem|ValueSet|Profile|Extension|Instance):/)
  return (end === -1 ? body : body.slice(0, end + 1)).split('\n').flatMap((line) => {
    const match = /^\* (?:#\S+ )?#(\S+) "/.exec(line)
    return match ? [match[1]!] : []
  })
}

/** Patterns that scripts/verify-release.mjs enforces over the authored contract. */
const prohibitedLiterals: readonly RegExp[] = [
  /fhir\.cognovis\.de\/praxis/i,
  /(?<![\p{L}\p{N}_])(?:ebm|hzv|goae|goä|goz|tardoc|tarmed)(?![\p{L}\p{N}_])/iu,
  /@polaris\//i,
  /(?:source|catalog).*(?:load|download|fetch)/i,
]

interface ClassProbe {
  readonly class: GenericRuleClass
  readonly parameters: Readonly<Record<string, unknown>>
  readonly satisfied: Partial<BillingCase>
  readonly violated: Partial<BillingCase>
  readonly indeterminate: Partial<BillingCase>
  readonly violationReason: BillingReasonCode
  readonly indeterminateReason: BillingReasonCode
  readonly malformed: readonly Readonly<Record<string, unknown>>[]
}

const selector = { codes: ['A'] } as const

const addedClassProbes: readonly ClassProbe[] = [
  {
    class: 'setting-constraint',
    parameters: { selector, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: ['setting-one', 'setting-two'] } },
    satisfied: { facts: { 'billing-setting': 'setting-two' } },
    violated: { facts: { 'billing-setting': 'setting-three' } },
    indeterminate: { facts: { 'billing-setting': { kind: 'billing-fact', state: 'known-absent' } } },
    violationReason: 'SETTING_NOT_PERMITTED',
    indeterminateReason: 'SETTING_INDETERMINATE',
    malformed: [
      { selector, setting: 'billing-setting', predicate: { polarity: 'perhaps', valueIn: ['setting-one'] } },
      { selector, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: [] } },
      { selector, setting: '', predicate: { polarity: 'include', valueIn: ['setting-one'] } },
    ],
  },
  {
    class: 'prior-authorization-required',
    parameters: { selector, authorization: 'synthetic-programme', grant: { fact: 'authorization-grant', valueIn: ['granted'] } },
    satisfied: { facts: { 'authorization-grant': 'granted' } },
    violated: { facts: { 'authorization-grant': { kind: 'billing-fact', state: 'known-absent' } } },
    indeterminate: { facts: { 'authorization-grant': { kind: 'billing-fact', state: 'not-supplied' } } },
    violationReason: 'PRIOR_AUTHORIZATION_REQUIRED',
    indeterminateReason: 'PRIOR_AUTHORIZATION_INDETERMINATE',
    malformed: [
      { selector, authorization: 'synthetic-programme', grant: { fact: 'authorization-grant', valueIn: [] } },
      { selector, authorization: '', grant: { fact: 'authorization-grant', valueIn: ['granted'] } },
    ],
  },
  {
    class: 'procedure-finding-requirement',
    parameters: { selector, procedure: { fact: 'procedure-findings', system: 'https://example.invalid/system/procedure', polarity: 'include', valueIn: ['P1', { code: 'P2', qualifiers: { laterality: ['left', 'right'] } }] } },
    satisfied: { facts: { 'procedure-findings': [{ code: 'P2', system: 'https://example.invalid/system/procedure', laterality: 'right' }] } },
    violated: { facts: { 'procedure-findings': { kind: 'billing-fact', state: 'known-absent' } } },
    indeterminate: { facts: { 'procedure-findings': [{ code: 'P2', system: 'https://example.invalid/system/procedure' }] } },
    violationReason: 'PROCEDURE_FINDING_NOT_SATISFIED',
    indeterminateReason: 'PROCEDURE_FINDING_INDETERMINATE',
    malformed: [
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: ['P1', 'P1'] } },
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: ['P1', { code: 'P1' }] } },
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: [{ code: 'P1', qualifiers: { laterality: [] } }] } },
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: [{ qualifiers: { laterality: ['left'] } }] } },
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: [] } },
      { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: ['P1'], qualifiers: { laterality: ['left'] } } },
    ],
  },
  {
    class: 'diagnosis-requirement',
    parameters: { selector, diagnosis: { fact: 'diagnoses', polarity: 'exclude', valueIn: ['D9'] } },
    satisfied: { facts: { diagnoses: ['D1'] } },
    violated: { facts: { diagnoses: ['D1', 'D9'] } },
    indeterminate: { facts: { diagnoses: { kind: 'billing-fact', state: 'source-unavailable' } } },
    violationReason: 'DIAGNOSIS_NOT_SATISFIED',
    indeterminateReason: 'DIAGNOSIS_INDETERMINATE',
    malformed: [
      { selector, diagnosis: { fact: 'diagnoses', valueIn: ['D9'] } },
      { selector, diagnosis: { fact: '', polarity: 'exclude', valueIn: ['D9'] } },
      { selector, diagnosis: { fact: 'diagnoses', polarity: 'exclude', valueIn: ['D9'], qualifiers: { severity: ['high'] } } },
    ],
  },
  {
    class: 'provider-eligibility',
    parameters: { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'general' }, { group: 'specialist', members: ['imaging', 'surgery'] }] } },
    satisfied: { facts: { 'provider-qualifications': [{ group: 'specialist', member: 'surgery' }] } },
    violated: { facts: { 'provider-qualifications': ['other'] } },
    indeterminate: { facts: { 'provider-qualifications': [{ group: 'specialist' }] } },
    violationReason: 'PROVIDER_NOT_ELIGIBLE',
    indeterminateReason: 'PROVIDER_ELIGIBILITY_INDETERMINATE',
    malformed: [
      { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [] } },
      { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'specialist', members: ['imaging', 'imaging'] }] } },
    ],
  },
  {
    class: 'quota-degression',
    parameters: { selector, threshold: { stated: true, quantity: 2 }, adjustment: { stated: true, factor: '0.8500' }, scopeAxes: { 'quota-period': ['current'] } },
    satisfied: { facts: { 'quota-period': 'current' }, lines: [{ ...baseCase.lines[0]!, quantity: 1 }] },
    violated: { facts: { 'quota-period': 'current' } },
    indeterminate: { facts: { 'quota-period': { kind: 'billing-fact', state: 'not-supplied' } } },
    violationReason: 'QUOTA_DEGRESSION_APPLICABLE',
    indeterminateReason: 'QUOTA_DEGRESSION_INDETERMINATE',
    malformed: [
      { selector, threshold: { stated: true, quantity: 2 }, adjustment: { stated: true, factor: '0.85000' } },
      { selector, threshold: { stated: true, quantity: -1 }, adjustment: { stated: true, factor: '0.8500' } },
      { selector, threshold: { stated: false, quantity: 2 }, adjustment: { stated: true, factor: '0.8500' } },
      { selector, threshold: { stated: true, quantity: 2 }, adjustment: { stated: true, factor: '0.8500' }, scopeAxes: { 'quota-period': [] } },
    ],
  },
]

const probeRuleSet = (id: string, ruleClass: string, parameters: Readonly<Record<string, unknown>>, effect: BillingRule['effect'] = 'reject'): BillingRuleSet =>
  defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id, rules: [{ id: `${id}-rule`, class: ruleClass, mustUnderstand: true, effect, priority: 1, parameters }] })

const probeAdmission = (id: string): AdmissionState => ({ ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: id } })

describe('neutral rule contract', () => {
  it('publishes every generic algorithm through the registry and the authored vocabularies', () => {
    assert.deepEqual(Object.keys(BILLING_RULE_CLASS_DEFINITIONS).sort(), publishedClasses)
    assert.deepEqual(codeSystemCodes('BillingRuleClassCS').sort(), publishedClasses)
    // NEEDS_REVIEW is the review-axis parent of the hierarchy and is never emitted as a reason itself.
    assert.deepEqual(codeSystemCodes('BillingReasonCS').sort(), [...BILLING_REASON_CODES, 'NEEDS_REVIEW'].sort())
    assert.equal(new Set(BILLING_REASON_CODES).size, BILLING_REASON_CODES.length)
  })

  it('keeps the published vocabulary free of jurisdiction literals', () => {
    const published = [
      ...Object.keys(BILLING_RULE_CLASS_DEFINITIONS),
      ...Object.values(BILLING_RULE_CLASS_DEFINITIONS).map((definition) => definition.description),
      ...BILLING_REASON_CODES,
    ]
    for (const text of published) {
      for (const pattern of prohibitedLiterals) assert.equal(pattern.test(text), false, `${text} matches ${pattern}`)
    }
  })

  it('requires every declared parameter and refuses malformed parameters for each added class', () => {
    for (const probe of addedClassProbes) {
      for (const parameter of BILLING_RULE_CLASS_DEFINITIONS[probe.class].requiredParameters) {
        const incomplete = Object.fromEntries(Object.entries(probe.parameters).filter(([name]) => name !== parameter))
        assert.throws(() => probeRuleSet('incomplete', probe.class, incomplete), BillingInputError, `${probe.class} without ${parameter}`)
      }
      for (const [index, parameters] of probe.malformed.entries()) {
        assert.throws(() => probeRuleSet('malformed', probe.class, parameters), BillingInputError, `${probe.class} malformed ${index}`)
      }
    }
  })

  it('evaluates every added class through a satisfied, a violated, and an indeterminate control', () => {
    for (const probe of addedClassProbes) {
      const id = `probe-${probe.class}`
      const compiled = compileRuleSet(probeRuleSet(id, probe.class, probe.parameters), probeAdmission(id))
      const accepted = evaluateBillingCase(compiled, { ...baseCase, ...probe.satisfied })
      assert.equal(accepted.outcome, 'accepted', `${probe.class} satisfied`)
      const rejected = evaluateBillingCase(compiled, { ...baseCase, ...probe.violated })
      assert.equal(rejected.outcome, 'rejected', `${probe.class} violated`)
      assert.deepEqual(rejected.axisReasons.map((item) => item.code), [probe.violationReason])
      assert.equal(rejected.axisReasons[0]?.lineId, 'a')
      const review = evaluateBillingCase(compiled, { ...baseCase, ...probe.indeterminate })
      assert.equal(review.outcome, 'needs-review', `${probe.class} indeterminate`)
      assert.equal(review.reason.code, probe.indeterminateReason)
      assert.equal(review.axisReasons[0]?.lineId, undefined)
    }
  })

  it('flags an unstated quota threshold or adjustment instead of accepting it silently', () => {
    const compiled = compileRuleSet(
      probeRuleSet('quota-unstated', 'quota-degression', { selector, threshold: { stated: false }, adjustment: { stated: false } }),
      probeAdmission('quota-unstated'),
    )
    const result = evaluateBillingCase(compiled, baseCase)
    assert.equal(result.outcome, 'needs-review')
    assert.deepEqual(result.axisReasons.map((item) => item.code), ['QUOTA_PARAMETER_UNAVAILABLE', 'QUOTA_PARAMETER_UNAVAILABLE'])
    assert.deepEqual(result.axisReasons.map((item) => item.details?.parameter), ['threshold', 'adjustment'])
    const scoped = compileRuleSet(
      probeRuleSet('quota-scoped', 'quota-degression', { selector, threshold: { stated: true, quantity: 4 }, adjustment: { stated: true, factor: '0.9000' }, countingScope: { window: 'episode', subject: 'recipient' } }),
      probeAdmission('quota-scoped'),
    )
    const scopedCase: BillingCase = {
      ...baseCase,
      lines: [{ ...baseCase.lines[0]!, quantity: 3 }, { ...baseCase.lines[0]!, id: 'b', quantity: 3 }],
      countingWindows: [{ scope: { window: 'episode', subject: 'recipient' }, lineIds: ['a', 'b'] }],
    }
    const aggregated = evaluateBillingCase(scoped, scopedCase)
    assert.equal(aggregated.outcome, 'rejected')
    assert.deepEqual(aggregated.axisReasons.map((item) => item.lineId), ['a', 'b'])
    assert.equal(aggregated.axisReasons[0]?.details?.factor, '0.9000')
    const withinQuota = evaluateBillingCase(scoped, { ...scopedCase, lines: [{ ...baseCase.lines[0]!, quantity: 2 }, { ...baseCase.lines[0]!, id: 'b', quantity: 2 }] })
    assert.equal(withinQuota.outcome, 'accepted')
  })

  it('does not apply a quota rule whose scope axes miss the declared alternation', () => {
    const compiled = compileRuleSet(
      probeRuleSet('quota-axis', 'quota-degression', { selector, threshold: { stated: true, quantity: 0 }, adjustment: { stated: true, factor: '0.5000' }, scopeAxes: { 'quota-period': ['current'] } }),
      probeAdmission('quota-axis'),
    )
    assert.equal(evaluateBillingCase(compiled, { ...baseCase, facts: { 'quota-period': 'previous' } }).outcome, 'accepted')
    assert.equal(evaluateBillingCase(compiled, { ...baseCase, facts: { 'quota-period': 'current' } }).outcome, 'rejected')
  })

  it('reads coded facts by code, system, and qualifier and reports the first ambiguity', () => {
    const parameters = { selector, procedure: { fact: 'procedure-findings', system: 'https://example.invalid/system/procedure', polarity: 'include', valueIn: [{ code: 'P1', qualifiers: { laterality: ['left'] } }] } }
    const compiled = compileRuleSet(probeRuleSet('coded', 'procedure-finding-requirement', parameters), probeAdmission('coded'))
    const evaluateFindings = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'procedure-findings': value } })
    assert.equal(evaluateFindings([{ code: 'P1', system: 'https://example.invalid/system/procedure', laterality: 'left' }]).outcome, 'accepted')
    // A different system is a decidable non-match, not an ambiguity.
    assert.equal(evaluateFindings([{ code: 'P1', system: 'https://example.invalid/system/other', laterality: 'left' }]).outcome, 'rejected')
    // A code outside the alternation never makes a missing system or qualifier ambiguous.
    assert.equal(evaluateFindings([{ code: 'P9' }]).outcome, 'rejected')
    const missingSystem = evaluateFindings([{ code: 'P9' }, { code: 'P1', laterality: 'left' }])
    assert.equal(missingSystem.reason.code, 'PROCEDURE_FINDING_INDETERMINATE')
    assert.equal(missingSystem.reason.details?.code, 'P1')
    const missingQualifier = evaluateFindings([{ code: 'P1', system: 'https://example.invalid/system/procedure' }])
    assert.equal(missingQualifier.reason.code, 'PROCEDURE_FINDING_INDETERMINATE')
    assert.equal(missingQualifier.reason.details?.qualifier, 'laterality')
    // A qualifier outside the alternation is decidable: the entry simply does not match.
    assert.equal(evaluateFindings([{ code: 'P1', system: 'https://example.invalid/system/procedure', laterality: 'right' }]).outcome, 'rejected')
    assert.equal(evaluateFindings({ unreadable: true }).reason.code, 'PROCEDURE_FINDING_INDETERMINATE')
  })

  it('constrains qualifiers per admissible code instead of flattening them across codes', () => {
    const correlated = [{ code: 'P1', qualifiers: { laterality: ['left'] } }, { code: 'P2', qualifiers: { laterality: ['right'] } }]
    for (const [ruleClass, parameter, reasonCode] of [
      ['procedure-finding-requirement', 'procedure', 'PROCEDURE_FINDING_NOT_SATISFIED'],
      ['diagnosis-requirement', 'diagnosis', 'DIAGNOSIS_NOT_SATISFIED'],
    ] as const) {
      const id = `correlated-${ruleClass}`
      const compiled = compileRuleSet(
        probeRuleSet(id, ruleClass, { selector, [parameter]: { fact: 'coded-entries', polarity: 'include', valueIn: correlated } }),
        probeAdmission(id),
      )
      const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'coded-entries': value } })
      assert.equal(evaluateEntries([{ code: 'P1', laterality: 'left' }]).outcome, 'accepted', `${ruleClass} P1/left`)
      assert.equal(evaluateEntries([{ code: 'P2', laterality: 'right' }]).outcome, 'accepted', `${ruleClass} P2/right`)
      // The correlation the flattened shape lost: P1 is admissible only on the left.
      const crossed = evaluateEntries([{ code: 'P1', laterality: 'right' }])
      assert.equal(crossed.outcome, 'rejected', `${ruleClass} P1/right`)
      assert.deepEqual(crossed.axisReasons.map((item) => item.code), [reasonCode])
      assert.equal(evaluateEntries([{ code: 'P2', laterality: 'left' }]).outcome, 'rejected', `${ruleClass} P2/left`)
    }
  })

  it('accepts plain string members alone and mixed with correlated members', () => {
    const compiled = compileRuleSet(
      probeRuleSet('mixed-members', 'procedure-finding-requirement', { selector, procedure: { fact: 'coded-entries', polarity: 'include', valueIn: ['P0', { code: 'P1', qualifiers: { laterality: ['left'] } }] } }),
      probeAdmission('mixed-members'),
    )
    const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'coded-entries': value } })
    // An unqualified member constrains nothing beyond its code, whatever qualifiers the entry carries.
    assert.equal(evaluateEntries(['P0']).outcome, 'accepted')
    assert.equal(evaluateEntries([{ code: 'P0', laterality: 'right' }]).outcome, 'accepted')
    assert.equal(evaluateEntries([{ code: 'P1', laterality: 'left' }]).outcome, 'accepted')
    assert.equal(evaluateEntries([{ code: 'P1', laterality: 'right' }]).outcome, 'rejected')
    const stringOnly = compileRuleSet(
      probeRuleSet('string-members', 'procedure-finding-requirement', { selector, procedure: { fact: 'coded-entries', polarity: 'include', valueIn: ['P0'] } }),
      probeAdmission('string-members'),
    )
    assert.equal(evaluateBillingCase(stringOnly, { ...baseCase, facts: { 'coded-entries': 'P0' } }).outcome, 'accepted')
    assert.equal(evaluateBillingCase(stringOnly, { ...baseCase, facts: { 'coded-entries': 'P9' } }).outcome, 'rejected')
  })

  it('lets a decisive match outrank an ambiguous sibling entry', () => {
    const system = 'https://example.invalid/system/procedure'
    for (const [ruleClass, parameter, notSatisfied, indeterminate] of [
      ['procedure-finding-requirement', 'procedure', 'PROCEDURE_FINDING_NOT_SATISFIED', 'PROCEDURE_FINDING_INDETERMINATE'],
      ['diagnosis-requirement', 'diagnosis', 'DIAGNOSIS_NOT_SATISFIED', 'DIAGNOSIS_INDETERMINATE'],
    ] as const) {
      for (const polarity of ['include', 'exclude'] as const) {
        const id = `decisive-${ruleClass}-${polarity}`
        const compiled = compileRuleSet(
          probeRuleSet(id, ruleClass, { selector, [parameter]: { fact: 'coded-entries', system, polarity, valueIn: [{ code: 'P1', qualifiers: { laterality: ['left'] } }] } }),
          probeAdmission(id),
        )
        const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'coded-entries': value } })
        // The complete entry decides both polarities; the ambiguous sibling cannot change that.
        const decided = evaluateEntries([{ code: 'P1', system, laterality: 'left' }, { code: 'P1' }])
        assert.equal(decided.outcome, polarity === 'include' ? 'accepted' : 'rejected', `${id} decisive first`)
        const decidedLast = evaluateEntries([{ code: 'P1' }, { code: 'P1', system, laterality: 'left' }])
        // The decision is order-independent; only the resolution keeps the supplied entry order.
        const withoutResolution = (result: typeof decided) => ({ ...result, axisReasons: result.axisReasons.map(({ resolution: _resolution, ...rest }) => rest) })
        assert.deepEqual(withoutResolution(decidedLast), withoutResolution(decided), `${id} decisive last`)
        if (polarity === 'exclude') {
          assert.deepEqual(decided.axisReasons.map((item) => item.code), [notSatisfied])
          assert.deepEqual(decided.axisReasons[0]!.resolution, { action: 'remove', codes: [{ system, code: 'P1' }, { code: 'P1' }] })
          assert.deepEqual(decidedLast.axisReasons[0]!.resolution, { action: 'remove', codes: [{ code: 'P1' }, { system, code: 'P1' }] })
        }
        // Without a full match the same ambiguous sibling still yields the typed indeterminate reason.
        const ambiguousSystem = evaluateEntries([{ code: 'P1', laterality: 'left' }])
        assert.equal(ambiguousSystem.outcome, 'needs-review', `${id} ambiguous system`)
        assert.equal(ambiguousSystem.reason.code, indeterminate)
        assert.equal(ambiguousSystem.reason.details?.code, 'P1')
        const ambiguousQualifier = evaluateEntries([{ code: 'P1', system }])
        assert.equal(ambiguousQualifier.outcome, 'needs-review', `${id} ambiguous qualifier`)
        assert.equal(ambiguousQualifier.reason.code, indeterminate)
        assert.equal(ambiguousQualifier.reason.details?.qualifier, 'laterality')
      }
    }
  })

  it('refuses an unknown key in every parameter object this contract owns', () => {
    const probes = [
      { object: 'coded predicate', class: 'procedure-finding-requirement', key: 'severity', parameters: { selector, procedure: { fact: 'coded-entries', polarity: 'include', valueIn: ['P1'], severity: 'high' } } },
      { object: 'coded admissible member', class: 'diagnosis-requirement', key: 'laterality', parameters: { selector, diagnosis: { fact: 'coded-entries', polarity: 'include', valueIn: [{ code: 'P1', laterality: 'left' }] } } },
      { object: 'provider predicate', class: 'provider-eligibility', key: 'group', parameters: { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'specialist' }], group: 'specialist' } } },
      { object: 'provider qualification', class: 'provider-eligibility', key: 'member', parameters: { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'specialist', member: 'surgery' }] } } },
      { object: 'setting predicate', class: 'setting-constraint', key: 'fact', parameters: { selector, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: ['setting-one'], fact: 'billing-setting' } } },
      { object: 'authorization grant', class: 'prior-authorization-required', key: 'programme', parameters: { selector, authorization: 'synthetic-programme', grant: { fact: 'authorization-grant', valueIn: ['granted'], programme: 'synthetic-programme' } } },
      { object: 'accompanying information', class: 'accompanying-information-required', key: 'required', parameters: { selector, information: { kind: 'synthetic-report', fact: 'report-kind', required: true } } },
      { object: 'patient attribute predicate', class: 'patient-attribute-constraint', key: 'system', parameters: { selector, attribute: 'patient-age', predicate: { minimum: 1, unit: 'a', system: 'https://example.invalid/system/age' } } },
      { object: 'quota threshold', class: 'quota-degression', key: 'window', parameters: { selector, threshold: { stated: true, quantity: 1, window: 'episode' }, adjustment: { stated: true, factor: '0.9000' } } },
      { object: 'quota adjustment', class: 'quota-degression', key: 'basis', parameters: { selector, threshold: { stated: true, quantity: 1 }, adjustment: { stated: true, factor: '0.9000', basis: 'unit-price' } } },
    ] as const
    for (const probe of probes) {
      assert.throws(
        () => probeRuleSet('unknown-key', probe.class, probe.parameters),
        (error: unknown) => error instanceof BillingInputError && error.message.includes(`does not accept key ${probe.key}`),
        probe.object,
      )
    }
  })

  it('refuses an unknown class-level parameter while still admitting every shared optional parameter', () => {
    const strictProbes = [
      ...addedClassProbes.map((probe) => ({ class: probe.class, parameters: probe.parameters, patch: probe.violated })),
      { class: 'patient-attribute-constraint' as const, parameters: { selector, attribute: 'patient-age', predicate: { minimum: 18, unit: 'a' } }, patch: { facts: { 'patient-age': { value: 12, unit: 'a' } } } },
      { class: 'accompanying-information-required' as const, parameters: { selector, information: { kind: 'synthetic-report', fact: 'report-kind' } }, patch: { facts: { 'report-kind': { kind: 'billing-fact' as const, state: 'known-absent' as const } } } },
    ]
    assert.equal(strictProbes.length, 8)
    const shared = {
      countingScope: { window: 'episode', subject: 'recipient' },
      exceptWhen: { fact: 'exception-status', valueIn: ['waived'] },
      modifierExceptions: ['EXEMPT'],
    }
    for (const probe of strictProbes) {
      assert.throws(
        () => probeRuleSet('unknown-parameter', probe.class, { ...probe.parameters, unexpectedParameter: 'retained-but-unread' }),
        (error: unknown) => error instanceof BillingInputError && error.message.includes('does not accept key unexpectedParameter'),
        probe.class,
      )
      const input: BillingCase = {
        ...baseCase,
        ...probe.patch,
        facts: { ...(probe.patch.facts ?? {}), 'exception-status': { kind: 'billing-fact', state: 'known-absent' } },
        countingWindows: [{ scope: { window: 'episode', subject: 'recipient' }, lineIds: ['a'] }],
      }
      const plain = evaluateBillingCase(compileRuleSet(probeRuleSet('plain', probe.class, probe.parameters), probeAdmission('plain')), input)
      const withShared = evaluateBillingCase(compileRuleSet(probeRuleSet('plain', probe.class, { ...probe.parameters, ...shared }), probeAdmission('plain')), input)
      assert.equal(plain.outcome, 'rejected', probe.class)
      assert.deepEqual(withShared, plain, probe.class)
    }
  })

  it('refuses the misspelled quota scope axis parameter instead of evaluating without a scope', () => {
    const parameters = { selector, threshold: { stated: true, quantity: 5 }, adjustment: { stated: true, factor: '0.9000' } }
    assert.throws(
      () => probeRuleSet('scope-axis-typo', 'quota-degression', { ...parameters, scopeAxis: { 'quota-period': ['current'] } }),
      (error: unknown) => error instanceof BillingInputError && error.message.includes('does not accept key scopeAxis'),
    )
    assert.doesNotThrow(() => probeRuleSet('scope-axes', 'quota-degression', { ...parameters, scopeAxes: { 'quota-period': ['current'] } }))
  })

  it('confines a patient-attribute unit to the numeric form', () => {
    const define = (predicate: Readonly<Record<string, unknown>>) => probeRuleSet('unit-form', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate })
    assert.throws(
      () => define({ valueIn: [18], unit: 'a' }),
      (error: unknown) => error instanceof BillingInputError && /unit belongs to a numeric bound/.test(error.message),
    )
    // The valueIn-versus-bound exclusivity keeps its own message and wins when both are present.
    assert.throws(
      () => define({ valueIn: [18], minimum: 1, unit: 'a' }),
      (error: unknown) => error instanceof BillingInputError && /cannot combine valueIn with a numeric bound/.test(error.message),
    )
    assert.doesNotThrow(() => define({ valueIn: [18, 'adult'] }))
    assert.doesNotThrow(() => define({ minimum: 1, unit: 'a' }))
  })

  it('refuses the source flat qualifier spelling on an admissible coded member', () => {
    for (const [ruleClass, parameter] of [['procedure-finding-requirement', 'procedure'], ['diagnosis-requirement', 'diagnosis']] as const) {
      assert.throws(
        () => probeRuleSet('flat-member', ruleClass, { selector, [parameter]: { fact: 'coded-entries', polarity: 'include', valueIn: [{ code: 'P', laterality: 'left' }] } }),
        (error: unknown) => error instanceof BillingInputError && error.message.includes('does not accept key laterality') && error.message.includes('valueIn P'),
        ruleClass,
      )
    }
  })

  it('keeps the named migration refusals distinct from the generic unknown-key refusal', () => {
    const messageOf = (define: () => unknown): string => {
      try { define() } catch (error) { return (error as Error).message }
      throw new Error('expected a BillingInputError')
    }
    const equals = messageOf(() => probeRuleSet('legacy-equals', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate: { equals: 18 } }))
    assert.match(equals, /predicate equals is replaced by predicate valueIn/)
    const legacyFact = messageOf(() => probeRuleSet('legacy-fact', 'accompanying-information-required', { selector, fact: 'report-kind', information: { kind: 'synthetic-report', fact: 'report-kind' } }))
    assert.match(legacyFact, /fact is replaced by information\.fact/)
    const globalQualifiers = messageOf(() => probeRuleSet('legacy-qualifiers', 'procedure-finding-requirement', { selector, procedure: { fact: 'coded-entries', polarity: 'include', valueIn: ['P1'], qualifiers: { laterality: ['left'] } } }))
    assert.match(globalQualifiers, /qualifiers is replaced by per-member valueIn\[\]\.qualifiers/)
    for (const message of [equals, legacyFact, globalQualifiers]) assert.doesNotMatch(message, /does not accept key/)
  })

  it('compiles and evaluates a rule set using every permitted key of each owned object', () => {
    const system = 'https://example.invalid/system/procedure'
    const rules: BillingRule[] = [
      { id: 'full-01-procedure', class: 'procedure-finding-requirement', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector, procedure: { fact: 'procedure-findings', system, polarity: 'include', valueIn: ['P0', { code: 'P1', qualifiers: { laterality: ['left'] } }] } } },
      { id: 'full-02-diagnosis', class: 'diagnosis-requirement', mustUnderstand: true, effect: 'reject', priority: 2, parameters: { selector, diagnosis: { fact: 'diagnoses', system, polarity: 'exclude', valueIn: [{ code: 'D9', qualifiers: { severity: ['high'] } }] } } },
      { id: 'full-03-provider', class: 'provider-eligibility', mustUnderstand: true, effect: 'reject', priority: 3, parameters: { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'general' }, { group: 'specialist', members: ['surgery'] }] } } },
      { id: 'full-04-setting', class: 'setting-constraint', mustUnderstand: true, effect: 'reject', priority: 4, parameters: { selector, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: ['setting-one', 'setting-two'] } } },
      { id: 'full-05-authorization', class: 'prior-authorization-required', mustUnderstand: true, effect: 'reject', priority: 5, parameters: { selector, authorization: 'synthetic-programme', grant: { fact: 'authorization-grant', valueIn: ['granted'] } } },
      { id: 'full-06-information', class: 'accompanying-information-required', mustUnderstand: true, effect: 'reject', priority: 6, parameters: { selector, information: { kind: 'synthetic-report', fact: 'report-kind', valueIn: ['structured'] } } },
      { id: 'full-07-bounded-attribute', class: 'patient-attribute-constraint', mustUnderstand: true, effect: 'reject', priority: 7, parameters: { selector, attribute: 'patient-age', predicate: { minimum: 18, maximum: 65, unit: 'a' } } },
      { id: 'full-08-categorical-attribute', class: 'patient-attribute-constraint', mustUnderstand: true, effect: 'reject', priority: 8, parameters: { selector, attribute: 'care-level', predicate: { valueIn: ['first', 'second'] } } },
      { id: 'full-09-quota', class: 'quota-degression', mustUnderstand: true, effect: 'reject', priority: 9, parameters: { selector, threshold: { stated: true, quantity: 5 }, adjustment: { stated: true, factor: '0.8500' }, scopeAxes: { 'quota-period': ['current'] } } },
    ]
    const compiled = compileRuleSet(defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'full-keys', rules }), probeAdmission('full-keys'))
    const result = evaluateBillingCase(compiled, {
      ...baseCase,
      facts: {
        'procedure-findings': [{ code: 'P1', system, laterality: 'left' }],
        diagnoses: [{ code: 'D9', system, severity: 'low' }],
        'provider-qualifications': [{ group: 'specialist', member: 'surgery' }],
        'billing-setting': 'setting-two',
        'authorization-grant': 'granted',
        'report-kind': 'structured',
        'patient-age': { value: 240, unit: 'mo' },
        'care-level': 'second',
        'quota-period': 'current',
      },
    })
    assert.equal(result.outcome, 'accepted')
    assert.deepEqual(result.evaluatedRuleIds, rules.map((rule) => rule.id))
  })

  it('refuses the obsolete predicate-level qualifier map instead of discarding it', () => {
    for (const [ruleClass, parameter] of [['procedure-finding-requirement', 'procedure'], ['diagnosis-requirement', 'diagnosis']] as const) {
      assert.throws(
        () => probeRuleSet('obsolete-qualifiers', ruleClass, { selector, [parameter]: { fact: 'coded-entries', polarity: 'include', valueIn: ['P1'], qualifiers: { laterality: ['left'] } } }),
        BillingInputError,
        ruleClass,
      )
    }
  })

  it('confines an unreadable sibling to its own member instead of the whole fact', () => {
    for (const [ruleClass, parameter, indeterminate] of [
      ['procedure-finding-requirement', 'procedure', 'PROCEDURE_FINDING_INDETERMINATE'],
      ['diagnosis-requirement', 'diagnosis', 'DIAGNOSIS_INDETERMINATE'],
    ] as const) {
      for (const polarity of ['include', 'exclude'] as const) {
        const id = `unreadable-${ruleClass}-${polarity}`
        const compiled = compileRuleSet(
          probeRuleSet(id, ruleClass, { selector, [parameter]: { fact: 'coded-entries', polarity, valueIn: [{ code: 'P1', qualifiers: { side: ['L'] } }] } }),
          probeAdmission(id),
        )
        const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'coded-entries': value } })
        const decided = evaluateEntries([{ code: 'P1', side: 'L' }, { side: 'L' }])
        assert.equal(decided.outcome, polarity === 'include' ? 'accepted' : 'rejected', `${id} exact first`)
        assert.deepEqual(evaluateEntries([{ side: 'L' }, { code: 'P1', side: 'L' }]), decided, `${id} exact last`)
        // Nothing readable at all keeps today's typed indeterminate reason for the whole fact.
        const unreadable = evaluateEntries([{ side: 'L' }, { other: 1 }])
        assert.equal(unreadable.outcome, 'needs-review', `${id} all unreadable`)
        assert.equal(unreadable.reason.code, indeterminate)
        assert.deepEqual(unreadable.reason.details, { fact: 'coded-entries' })
      }
    }
    for (const polarity of ['include', 'exclude'] as const) {
      const id = `unreadable-provider-${polarity}`
      const compiled = compileRuleSet(
        probeRuleSet(id, 'provider-eligibility', { selector, provider: { fact: 'provider-qualifications', polarity, qualifications: [{ group: 'specialist', members: ['surgery'] }] } }),
        probeAdmission(id),
      )
      const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'provider-qualifications': value } })
      const decided = evaluateEntries([{ group: 'specialist', member: 'surgery' }, { member: 'surgery' }])
      assert.equal(decided.outcome, polarity === 'include' ? 'accepted' : 'rejected', `${id} exact first`)
      assert.deepEqual(evaluateEntries([{ member: 'surgery' }, { group: 'specialist', member: 'surgery' }]), decided, `${id} exact last`)
      const unreadable = evaluateEntries([{ member: 'surgery' }])
      assert.equal(unreadable.outcome, 'needs-review', `${id} all unreadable`)
      assert.equal(unreadable.reason.code, 'PROVIDER_ELIGIBILITY_INDETERMINATE')
      assert.deepEqual(unreadable.reason.details, { fact: 'provider-qualifications' })
    }
  })

  it('lets a definite mismatch suppress an unrelated missing constraint', () => {
    const system = 'https://example.invalid/system/procedure'
    for (const [ruleClass, parameter, notSatisfied] of [
      ['procedure-finding-requirement', 'procedure', 'PROCEDURE_FINDING_NOT_SATISFIED'],
      ['diagnosis-requirement', 'diagnosis', 'DIAGNOSIS_NOT_SATISFIED'],
    ] as const) {
      for (const polarity of ['include', 'exclude'] as const) {
        const id = `decidable-${ruleClass}-${polarity}`
        const compiled = compileRuleSet(
          probeRuleSet(id, ruleClass, { selector, [parameter]: { fact: 'coded-entries', system, polarity, valueIn: [{ code: 'P1', qualifiers: { category: ['A'], laterality: ['left'] } }] } }),
          probeAdmission(id),
        )
        const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'coded-entries': value } })
        // The wrong laterality already falsifies the conjunction, so the missing category and the
        // missing system are both irrelevant: the entry is a decidable non-match.
        const decidable = evaluateEntries([{ code: 'P1', laterality: 'right' }])
        assert.equal(decidable.outcome, polarity === 'include' ? 'rejected' : 'accepted', `${id} mismatch outranks missing`)
        if (polarity === 'include') assert.deepEqual(decidable.axisReasons.map((item) => item.code), [notSatisfied])
        assert.equal(evaluateEntries([{ code: 'P1', system, laterality: 'right' }]).outcome, polarity === 'include' ? 'rejected' : 'accepted', `${id} mismatch with system`)
        // An entry that answers everything it can and is missing exactly one is still ambiguous.
        const ambiguous = evaluateEntries([{ code: 'P1', system, laterality: 'left' }])
        assert.equal(ambiguous.outcome, 'needs-review', `${id} missing category`)
        assert.equal(ambiguous.reason.details?.qualifier, 'category')
        const missingSystem = evaluateEntries([{ code: 'P1', category: 'A', laterality: 'left' }])
        assert.equal(missingSystem.outcome, 'needs-review', `${id} missing system`)
        assert.equal(missingSystem.reason.details?.code, 'P1')
      }
    }
  })

  it('reads a provider member outside the declared members as a decidable non-match', () => {
    for (const polarity of ['include', 'exclude'] as const) {
      const id = `decidable-provider-${polarity}`
      const compiled = compileRuleSet(
        probeRuleSet(id, 'provider-eligibility', { selector, provider: { fact: 'provider-qualifications', polarity, qualifications: [{ group: 'specialist', members: ['surgery'] }] } }),
        probeAdmission(id),
      )
      const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'provider-qualifications': value } })
      const decidable = evaluateEntries([{ group: 'specialist', member: 'imaging' }])
      assert.equal(decidable.outcome, polarity === 'include' ? 'rejected' : 'accepted', `${id} member outside declared members`)
      // An entry matching a whole-group qualification records no ambiguity for a stricter sibling.
      const wholeGroup = compileRuleSet(
        probeRuleSet(`${id}-group`, 'provider-eligibility', { selector, provider: { fact: 'provider-qualifications', polarity, qualifications: [{ group: 'specialist' }, { group: 'specialist', members: ['surgery'] }] } }),
        probeAdmission(`${id}-group`),
      )
      const covered = evaluateBillingCase(wholeGroup, { ...baseCase, facts: { 'provider-qualifications': [{ group: 'specialist' }] } })
      assert.equal(covered.outcome, polarity === 'include' ? 'accepted' : 'rejected', `${id} whole group covers`)
    }
  })

  it('lets a decisive provider qualification outrank an ambiguous sibling entry', () => {
    for (const polarity of ['include', 'exclude'] as const) {
      const id = `decisive-provider-${polarity}`
      const compiled = compileRuleSet(
        probeRuleSet(id, 'provider-eligibility', { selector, provider: { fact: 'provider-qualifications', polarity, qualifications: [{ group: 'specialist', members: ['surgery'] }] } }),
        probeAdmission(id),
      )
      const evaluateEntries = (value: BillingFactValue) => evaluateBillingCase(compiled, { ...baseCase, facts: { 'provider-qualifications': value } })
      const decided = evaluateEntries([{ group: 'specialist', member: 'surgery' }, { group: 'specialist' }])
      assert.equal(decided.outcome, polarity === 'include' ? 'accepted' : 'rejected', `${id} decisive first`)
      assert.deepEqual(evaluateEntries([{ group: 'specialist' }, { group: 'specialist', member: 'surgery' }]), decided, `${id} decisive last`)
      const ambiguous = evaluateEntries([{ group: 'specialist' }])
      assert.equal(ambiguous.outcome, 'needs-review', `${id} ambiguous`)
      assert.equal(ambiguous.reason.code, 'PROVIDER_ELIGIBILITY_INDETERMINATE')
      assert.equal(ambiguous.reason.details?.group, 'specialist')
    }
  })

  it('compares unit-bearing bounds exactly and refuses uninterpretable comparisons', () => {
    assert.equal(compareUnitBearingValues({ value: 1, unit: 'a' }, { value: 12, unit: 'mo' }), 0)
    assert.equal(compareUnitBearingValues({ value: 90, unit: 'min' }, { value: 1.5, unit: 'h' }), 0)
    assert.equal(compareUnitBearingValues({ value: 1, unit: 'wk' }, { value: 7, unit: 'd' }), 0)
    assert.equal(compareUnitBearingValues({ value: 2, unit: '1' }, { value: 3, unit: '1' }), -1)
    // Exact decimal arithmetic: 0.1 * 12 is 1.2000000000000002 in binary floating point.
    assert.notEqual(0.1 * 12, 1.2)
    assert.equal(compareUnitBearingValues({ value: 0.1, unit: 'a' }, { value: 1.2, unit: 'mo' }), 0)
    assert.equal(compareUnitBearingValues({ value: 1, unit: 'a' }, { value: 365, unit: 'd' }), 'uninterpretable')
    assert.equal(compareUnitBearingValues({ value: 1, unit: 'furlong' }, { value: 1, unit: 'mo' }), 'uninterpretable')
    assert.equal(compareUnitBearingValues({ value: 1e21, unit: 'mo' }, { value: 1, unit: 'mo' }), 'uninterpretable')
    assert.equal(BILLING_INTERPRETABLE_UNITS.a.dimension, 'calendar-month')
    assert.notEqual(BILLING_INTERPRETABLE_UNITS.a.dimension, BILLING_INTERPRETABLE_UNITS.d.dimension)

    const boundedAttribute = (predicate: Readonly<Record<string, unknown>>, value: BillingFactValue) => evaluateBillingCase(
      compileRuleSet(probeRuleSet('units', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate }), probeAdmission('units')),
      { ...baseCase, facts: { 'patient-age': value } },
    )
    assert.equal(boundedAttribute({ minimum: 1, unit: 'a' }, { value: 12, unit: 'mo' }).outcome, 'accepted')
    assert.equal(boundedAttribute({ minimum: 1, unit: 'a' }, { value: 11, unit: 'mo' }).outcome, 'rejected')
    assert.equal(boundedAttribute({ maximum: 18, unit: 'a' }, { value: 216, unit: 'mo' }).outcome, 'accepted')
    assert.equal(boundedAttribute({ maximum: 18, unit: 'a' }, { value: 217, unit: 'mo' }).outcome, 'rejected')
    assert.equal(boundedAttribute({ minimum: 1, unit: 'd' }, { value: 24, unit: 'h' }).outcome, 'accepted')
    assert.equal(boundedAttribute({ minimum: 1, unit: 'd' }, { value: 23, unit: 'h' }).outcome, 'rejected')
    for (const value of [{ value: 3, unit: 'furlong' }, { value: 4000, unit: 'd' }, 40, '40', { kind: 'billing-fact' as const, state: 'known-absent' as const }]) {
      const result = boundedAttribute({ minimum: 1, unit: 'a' }, value)
      assert.equal(result.outcome, 'needs-review', JSON.stringify(value))
      assert.equal(result.reason.code, 'PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE')
      assert.equal(result.reason.details?.attribute, 'patient-age')
    }
    assert.equal(boundedAttribute({ minimum: 1, unit: 'a' }, { value: 4000, unit: 'd' }).reason.details?.factUnit, 'd')
    assert.throws(() => probeRuleSet('unitless', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate: { minimum: 18 } }), BillingInputError)
    assert.throws(() => probeRuleSet('legacy-equals', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate: { equals: 18 } }), BillingInputError)
    assert.throws(() => probeRuleSet('mixed-predicate', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate: { valueIn: ['adult'], minimum: 18, unit: 'a' } }), BillingInputError)
    assert.throws(() => probeRuleSet('empty-predicate', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate: {} }), BillingInputError)
  })

  it('compares a bound against the completed quantity a fact states in the bound unit (#131)', () => {
    const boundedAttribute = (predicate: Readonly<Record<string, unknown>>, value: BillingFactValue) => evaluateBillingCase(
      compileRuleSet(probeRuleSet('completed', 'patient-attribute-constraint', { selector, attribute: 'patient-age', predicate }), probeAdmission('completed')),
      { ...baseCase, facts: { 'patient-age': value } },
    )
    // A child aged 2 years, 34 completed months, 148 completed weeks and 1040 days.
    const age = [{ value: 2, unit: 'a' }, { value: 34, unit: 'mo' }, { value: 148, unit: 'wk' }, { value: 1040, unit: 'd' }]
    assert.equal(boundedAttribute({ minimum: 19, maximum: 26, unit: 'mo' }, age).outcome, 'rejected')
    assert.equal(boundedAttribute({ minimum: 19, maximum: 34, unit: 'mo' }, age).outcome, 'accepted')
    assert.equal(boundedAttribute({ minimum: 35, unit: 'mo' }, age).outcome, 'rejected')
    // Completed units: 34 months is still at most 2 years, though 34 months exceed 24.
    assert.equal(boundedAttribute({ maximum: 2, unit: 'a' }, age).outcome, 'accepted')
    assert.equal(boundedAttribute({ minimum: 3, unit: 'a' }, age).outcome, 'rejected')
    // 1040 days are 148 completed weeks, so a 148-week maximum holds though 1040 days exceed 1036.
    assert.equal(boundedAttribute({ maximum: 148, unit: 'wk' }, age).outcome, 'accepted')
    assert.equal(boundedAttribute({ maximum: 147, unit: 'wk' }, age).outcome, 'rejected')
    assert.equal(boundedAttribute({ maximum: 1040, unit: 'd' }, age).outcome, 'accepted')
    assert.equal(boundedAttribute({ maximum: 1039, unit: 'd' }, age).outcome, 'rejected')
    // No conversion from a listed quantity: a bound in a unit the fact does not list is not decided.
    const hours = boundedAttribute({ minimum: 1, unit: 'h' }, age)
    assert.equal(hours.outcome, 'needs-review')
    assert.equal(hours.reason.code, 'PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE')
    assert.equal(hours.reason.details?.boundUnit, 'h')
    for (const value of [
      [] as BillingFactValue,
      [{ value: 34, unit: 'mo' }, { value: 35, unit: 'mo' }],
      [{ value: 34, unit: 'mo' }, 'x'],
      [{ value: 34, unit: 'mo' }, { value: 1, unit: 'furlong' }],
      [{ value: 34, unit: 'mo' }, { value: Number.NaN, unit: 'a' }],
      // A sparse list: its hole is no quantity, wherever it sits.
      Object.assign([{ value: 34, unit: 'mo' }], { length: 2 }),
      [, { value: 34, unit: 'mo' }] as BillingFactValue,
    ]) {
      const result = boundedAttribute({ maximum: 40, unit: 'mo' }, value)
      assert.equal(result.outcome, 'needs-review', JSON.stringify(value))
      assert.equal(result.reason.code, 'PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE', JSON.stringify(value))
    }
  })

  it('treats value alternation as a set and never collapses it to its first member', () => {
    const attribute = compileRuleSet(
      probeRuleSet('alternation-attribute', 'patient-attribute-constraint', { selector, attribute: 'care-level', predicate: { valueIn: ['first', 'second', 'third'] } }),
      probeAdmission('alternation-attribute'),
    )
    const evaluateAttribute = (value: BillingFactValue) => evaluateBillingCase(attribute, { ...baseCase, facts: { 'care-level': value } })
    assert.equal(evaluateAttribute('third').outcome, 'accepted')
    assert.equal(evaluateAttribute('first').outcome, 'accepted')
    assert.equal(evaluateAttribute('fourth').outcome, 'rejected')
    assert.equal(evaluateAttribute(['fourth', 'third']).outcome, 'accepted')
    const attributeReview = evaluateAttribute({ nested: 'third' })
    assert.equal(attributeReview.outcome, 'needs-review')
    assert.equal(attributeReview.reason.code, 'PATIENT_ATTRIBUTE_INDETERMINATE')
    assert.equal(evaluateAttribute({ kind: 'billing-fact', state: 'known-absent' }).reason.code, 'PATIENT_ATTRIBUTE_INDETERMINATE')

    const information = compileRuleSet(
      probeRuleSet('alternation-information', 'accompanying-information-required', { selector, information: { kind: 'synthetic-report', fact: 'report-kind', valueIn: ['summary', 'detailed', 'structured'] } }),
      probeAdmission('alternation-information'),
    )
    const evaluateInformation = (value: BillingFactValue) => evaluateBillingCase(information, { ...baseCase, facts: { 'report-kind': value } })
    assert.equal(evaluateInformation('structured').outcome, 'accepted')
    assert.equal(evaluateInformation('freeform').outcome, 'rejected')
    assert.equal(evaluateInformation('freeform').axisReasons[0]?.details?.kind, 'synthetic-report')
    // Nothing supplied is decidable; an unreadable value is not.
    assert.deepEqual(evaluateInformation({ kind: 'billing-fact', state: 'known-absent' }).axisReasons.map((item) => item.code), ['ACCOMPANYING_INFORMATION_REQUIRED'])
    const informationReview = evaluateInformation({ nested: 'structured' })
    assert.equal(informationReview.outcome, 'needs-review')
    assert.equal(informationReview.reason.code, 'ACCOMPANYING_INFORMATION_INDETERMINATE')
    // The presence form keeps its 0.2.x behaviour under the new parameter spelling.
    const presence = compileRuleSet(
      probeRuleSet('presence-information', 'accompanying-information-required', { selector, information: { kind: 'synthetic-report', fact: 'report-kind' } }),
      probeAdmission('presence-information'),
    )
    assert.equal(evaluateBillingCase(presence, { ...baseCase, facts: { 'report-kind': { nested: 'anything' } } }).outcome, 'accepted')
    assert.equal(evaluateBillingCase(presence, { ...baseCase, facts: { 'report-kind': { kind: 'billing-fact', state: 'known-absent' } } }).outcome, 'rejected')
    assert.equal(evaluateBillingCase(presence, { ...baseCase, facts: {} }).reason.code, 'REQUIRED_FACT_UNAVAILABLE')
    assert.throws(() => probeRuleSet('legacy-fact', 'accompanying-information-required', { selector, fact: 'report-kind' }), BillingInputError)
  })

  it('evaluates a rule set containing every class deterministically and in declared order', () => {
    const admission = { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: mixedClassRuleSet.id } }
    const compiled = compileRuleSet(mixedClassRuleSet, admission)
    assert.deepEqual(compiled.withheldReasons, [])
    assert.equal(compiled.rules.length, publishedClasses.length)
    assert.deepEqual([...new Set(compiled.rules.map((rule) => rule.class))].sort(), publishedClasses)
    const input = mixedClassCase('mixed-case')
    const first = evaluateBillingCase(compiled, input)
    assert.equal(first.outcome, 'accepted')
    assert.deepEqual(first, evaluateBillingCase(compiled, structuredClone(input)))
    assert.deepEqual(first.evaluatedRuleIds, sortRules(mixedClassRuleSet.rules).map((rule) => rule.id))

    const violating = mixedClassCase('mixed-violating-case', {
      'billing-setting': 'setting-outside',
      diagnoses: ['SYN-D9'],
      'provider-qualifications': ['other-group'],
    })
    const multiLine: BillingCase = { ...violating, lines: [violating.lines[0]!, { ...violating.lines[0]!, id: `${violating.lines[0]!.id}-2` }] }
    const rejected = evaluateBillingCase(compiled, multiLine)
    assert.equal(rejected.outcome, 'rejected')
    assert.deepEqual(rejected, evaluateBillingCase(compiled, structuredClone(multiLine)))
    assert.deepEqual(rejected.axisReasons.map((item) => `${item.ruleId}/${item.lineId}`), [
      'mixed-09-setting-constraint/mixed-violating-case-line', 'mixed-09-setting-constraint/mixed-violating-case-line-2',
      'mixed-12-diagnosis-requirement/mixed-violating-case-line', 'mixed-12-diagnosis-requirement/mixed-violating-case-line-2',
      'mixed-13-provider-eligibility/mixed-violating-case-line', 'mixed-13-provider-eligibility/mixed-violating-case-line-2',
    ])
  })

  it('fails closed for each unusable required edition state on both admission axes', () => {
    for (const patch of [
      { availability: 'missing' as const }, { completeness: 'unknown' as const },
      { entitled: false }, { compatible: false }, { digestMatches: false },
      { availability: 'expired' as const },
    ]) {
      for (const axis of ['catalog', 'ruleSet'] as const) {
        const admission: AdmissionState = {
          ...completeAdmission,
          [axis]: { ...completeAdmission[axis], ...patch },
        }
        assert.equal(admitBillingRuleSet(admission, []).status, 'needs-review')
      }
    }
    // A partial edition is admitted on both axes; the SDK marks its result CATALOG_PARTIAL.
    for (const axis of ['catalog', 'ruleSet'] as const) {
      const partial: AdmissionState = { ...completeAdmission, [axis]: { ...completeAdmission[axis], completeness: 'partial' } }
      assert.deepEqual(admitBillingRuleSet(partial, []), { status: 'admitted', reasons: [] })
    }
    const unverified = { ...completeAdmission, catalog: { ...completeAdmission.catalog, digestMatches: undefined } } as unknown as AdmissionState
    assert.equal(admitBillingRuleSet(unverified, []).status, 'needs-review')
  })

  it('rejects contradictory inputs and withholds unsupported must-understand classes', () => {
    assert.throws(() => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 2, id: 'unmigrated-semantics', rules: [] } as unknown as BillingRuleSet), BillingInputError)
    assert.throws(() => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 3, id: 'semantic-major-3', rules: [] } as unknown as BillingRuleSet), BillingInputError)
    assert.throws(() => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: '', rules: [] }), BillingInputError)
    assert.throws(() => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'bad-limit', rules: [{ id: 'bad', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: 'not-a-number' } }] }), BillingInputError)
    assert.throws(() => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'bad-bounds', rules: [{ id: 'bad', class: 'bounded-multiplier', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, minimum: 2, maximum: 1 } }] }), BillingInputError)
    const unsupported = [{ id: 'future', class: 'future-rule', mustUnderstand: true, effect: 'reject' as const, priority: 1, parameters: {} }]
    assert.equal(admitBillingRuleSet(completeAdmission, unsupported).status, 'needs-review')
  })

  it('counts neutral evidence with bounded source contributions', () => {
    const rules = {
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-evidence',
      rules: [{
        id: 'minimum-evidence',
        class: 'minimum-evidence-count',
        mustUnderstand: true,
        effect: 'reject',
        priority: 1,
        parameters: {
          selector: { codes: ['A'] },
          minimum: 4,
          sources: [
            { fact: 'primary-occurrences', credit: 1 },
            { fact: 'substitute-occurrences', credit: 2, maximumCredit: 2 },
          ],
        },
      }],
    } as unknown as BillingRuleSet
    const admission = { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: 'portable-evidence' } }
    const compiled = compileRuleSet(rules, admission)
    const sufficient = evaluateBillingCase(compiled, {
      ...baseCase,
      facts: { 'primary-occurrences': 2, 'substitute-occurrences': 4 },
    })
    assert.equal(sufficient.outcome, 'accepted')
    const insufficient = evaluateBillingCase(compiled, {
      ...baseCase,
      facts: { 'primary-occurrences': 1, 'substitute-occurrences': 4 },
    })
    assert.equal(insufficient.outcome, 'rejected')
    assert.equal(insufficient.axisReasons[0]?.code, 'MINIMUM_EVIDENCE_NOT_MET')
    assert.deepEqual(insufficient.axisReasons[0]?.details, { minimum: 4, rawCount: 5, creditedCount: 3 })
  })

  it('fails closed for unavailable, malformed, and overflowing minimum-evidence inputs', () => {
    const parameters = {
      selector: { codes: ['A'] },
      minimum: 2,
      sources: [{ fact: 'evidence-alpha', credit: 1 }, { fact: 'evidence-beta', credit: 2, maximumCredit: 1 }],
    }
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-evidence-boundaries',
      rules: [{ id: 'minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 1, parameters }],
    })
    const admission = { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: 'portable-evidence-boundaries' } }
    const compiled = compileRuleSet(rules, admission)
    const evaluate = (facts: BillingCase['facts']) => evaluateBillingCase(compiled, { ...baseCase, facts })
    assert.equal(evaluate({ 'evidence-alpha': 2, 'evidence-beta': { kind: 'billing-fact', state: 'known-absent' } }).outcome, 'accepted')
    for (const unavailable of [undefined, { kind: 'billing-fact', state: 'not-supplied' }, { kind: 'billing-fact', state: 'source-unavailable' }] as const) {
      const facts = unavailable === undefined ? { 'evidence-alpha': 2 } : { 'evidence-alpha': 2, 'evidence-beta': unavailable }
      const result = evaluate(facts)
      assert.equal(result.outcome, 'needs-review')
      assert.deepEqual(result.axisReasons[0]?.details, { fact: 'evidence-beta' })
    }
    for (const value of ['2', 1.5, -1, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => evaluate({ 'evidence-alpha': { kind: 'billing-fact', state: 'known', value }, 'evidence-beta': 0 }), BillingInputError)
    }
    for (const invalid of [
      { ...parameters, minimum: 0 },
      { ...parameters, minimum: 1.5 },
      { ...parameters, minimum: Number.MAX_SAFE_INTEGER + 1 },
      { ...parameters, sources: [] },
      { ...parameters, sources: [{ fact: 'evidence-alpha', credit: 1 }, { fact: 'evidence-alpha', credit: 1 }] },
      { ...parameters, sources: [{ fact: '', credit: 1 }] },
      { ...parameters, sources: [{ fact: 'evidence-alpha', credit: 0 }] },
      { ...parameters, sources: [{ fact: 'evidence-alpha', credit: 1, maximumCredit: 0 }] },
      { ...parameters, unexpected: true },
    ]) {
      assert.throws(() => defineBillingRuleSet({
        schemaVersion: 2,
        semanticMajor: 4,
        id: 'invalid-evidence',
        rules: [{ id: 'minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 1, parameters: invalid }],
      }), BillingInputError)
    }
    const overflowingProduct = defineBillingRuleSet({
      schemaVersion: 2, semanticMajor: 4, id: 'product-overflow',
      rules: [{ id: 'minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector, minimum: 1, sources: [{ fact: 'evidence-alpha', credit: 2 }] } }],
    })
    assert.throws(() => evaluateBillingCase(compileRuleSet(overflowingProduct, { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: 'product-overflow' } }), { ...baseCase, facts: { 'evidence-alpha': Number.MAX_SAFE_INTEGER } }), BillingInputError)
    const overflowingSum = defineBillingRuleSet({
      schemaVersion: 2, semanticMajor: 4, id: 'sum-overflow',
      rules: [{ id: 'minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector, minimum: 1, sources: [{ fact: 'evidence-alpha', credit: 2 }, { fact: 'evidence-beta', credit: 2 }] } }],
    })
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2)
    assert.throws(() => evaluateBillingCase(compileRuleSet(overflowingSum, { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: 'sum-overflow' } }), { ...baseCase, facts: { 'evidence-alpha': half, 'evidence-beta': half } }), BillingInputError)
  })

  it('validates every available evidence source before returning a deterministic unavailable-fact review', () => {
    const compileEvidence = (id: string, sources: readonly Record<string, unknown>[]) => compileRuleSet(defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id,
      rules: [{ id: 'minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector, minimum: 1, sources } }],
    }), { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: id } })
    const evaluate = (id: string, sources: readonly Record<string, unknown>[], facts: BillingCase['facts']) =>
      evaluateBillingCase(compileEvidence(id, sources), { ...baseCase, facts })
    const unavailable = { fact: 'evidence-unavailable', credit: 1 }
    const malformed = { fact: 'evidence-malformed', credit: 1 }
    for (const sources of [[unavailable, malformed], [malformed, unavailable]]) {
      assert.throws(() => evaluate(`malformed-${sources[0]!.fact}`, sources, { 'evidence-malformed': 'not-a-count' }), BillingInputError)
    }
    const overflow = { fact: 'evidence-overflow', credit: 2 }
    for (const sources of [[unavailable, overflow], [overflow, unavailable]]) {
      assert.throws(() => evaluate(`product-${sources[0]!.fact}`, sources, { 'evidence-overflow': Number.MAX_SAFE_INTEGER }), BillingInputError)
    }
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2)
    const alpha = { fact: 'evidence-alpha', credit: 2 }
    const beta = { fact: 'evidence-beta', credit: 2 }
    for (const sources of [[unavailable, alpha, beta], [alpha, unavailable, beta], [alpha, beta, unavailable]]) {
      assert.throws(() => evaluate(`sum-${sources.map((source) => source.fact).join('-')}`, sources, { 'evidence-alpha': half, 'evidence-beta': half }), BillingInputError)
    }
    const result = evaluate('unavailable-order', [{ fact: 'evidence-beta', credit: 1 }, { fact: 'evidence-alpha', credit: 1 }], {})
    assert.equal(result.outcome, 'needs-review')
    assert.deepEqual(result.axisReasons, [{ code: 'MINIMUM_EVIDENCE_INDETERMINATE', ruleId: 'minimum-evidence', details: { fact: 'evidence-beta' } }])
  })

  it('preserves canonical payload-v2 digests and deterministic evaluation', () => {
    const vector = JSON.parse(readFileSync('fixtures/payload-v2-digest.json', 'utf8')) as { payload: BillingRulePayloadV2; digest: string; producer: { commit: string } }
    const payloadV2 = vector.payload
    const ruleSet: BillingRuleSet = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 10, parameters: { maximum: 2, selector: { codes: ['A'] } } }],
    })
    assert.equal(vector.producer.commit, '2bd712c5a4e378b182f2f4fafabe2fa5ff6f2cb2')
    assert.equal(billingRulePayloadDigest(payloadV2), vector.digest)
    assert.equal(billingRulePayloadDigest(payloadV2), billingRulePayloadDigest(structuredClone(payloadV2)))
    const withUndefined = { ...payloadV2, coverage: undefined } as unknown as BillingRulePayloadV2
    assert.equal(billingRulePayloadDigest(withUndefined), billingRulePayloadDigest(payloadV2))
    const compiled = compileRuleSet(ruleSet, completeAdmission)
    assert.deepEqual(evaluateBillingCase(compiled, baseCase), evaluateBillingCase(compiled, structuredClone(baseCase)))
    assert.equal(evaluateBillingCase(compiled, baseCase).outcome, 'rejected')
  })

  it('enforces exact money arithmetic and rejects unsupported fractional quantities', () => {
    const ruleSet = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const compiled = compileRuleSet(ruleSet, completeAdmission)
    assert.equal(evaluateBillingCase(compiled, { ...baseCase, lines: [{ ...baseCase.lines[0]!, quantity: 2, unitPrice: { value: '10.01', currency: 'EUR' } }] }).outcome, 'rejected')
    assert.equal(evaluateBillingCase(compiled, { ...baseCase, lines: [{ ...baseCase.lines[0]!, quantity: 2, unitPrice: { value: '-30.50', currency: 'EUR' } }] }).outcome, 'accepted')
    assert.equal(evaluateBillingCase(compiled, { ...baseCase, lines: [{ ...baseCase.lines[0]!, quantity: 2, multiplier: 50, unitPrice: { value: '10.00', currency: 'EUR' } }] }).outcome, 'accepted')
    assert.throws(() => evaluateBillingCase(compiled, { ...baseCase, lines: [{ ...baseCase.lines[0]!, quantity: 2.9 }] }), BillingInputError)
    assert.throws(() => evaluateBillingCase(compiled, { ...baseCase, lines: [{ ...baseCase.lines[0]!, unitPrice: { value: '9.999', currency: 'EUR' } }] }), BillingInputError)
  })

  it('binds admission, effective periods, effects, immutability, and deterministic id ordering', () => {
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [
        { id: 'z', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, effectiveEnd: '2020-01-01', parameters: { selector: { codes: ['A'] }, maximum: 1 } },
        { id: 'ä', class: 'quantity-limit', mustUnderstand: true, effect: 'needs-review', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: 1 } },
      ],
    })
    assert.deepEqual(sortRules(rules.rules).map((rule) => rule.id), ['z', 'ä'])
    assert.throws(() => { (rules.rules[0]!.parameters as { maximum: number }).maximum = 99 }, TypeError)
    const result = evaluateBillingCase(compileRuleSet(rules, completeAdmission), baseCase)
    assert.equal(result.outcome, 'needs-review')
    assert.deepEqual(result.evaluatedRuleIds, ['ä'])
    const mismatched = { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: 'different' } }
    assert.equal(evaluateBillingCase(compileRuleSet(rules, mismatched), baseCase).outcome, 'needs-review')
    const expired = { ...completeAdmission, catalog: { ...completeAdmission.catalog, effectiveEnd: '2020-01-01' } }
    assert.equal(evaluateBillingCase(compileRuleSet(rules, expired), baseCase).reason.code, 'EDITION_EXPIRED')
    assert.throws(() => evaluateBillingCase(compileRuleSet(rules, completeAdmission), { ...baseCase, asOf: '2026-02-30' }), BillingInputError)
    assert.throws(() => defineBillingRuleSet({ ...rules, rules: [{ ...rules.rules[0]!, effectiveStart: '2026-02-30' }] }), BillingInputError)
  })

  it('deep-freezes cyclic parameter graphs without an untyped recursion failure', () => {
    const parameters: Record<string, unknown> = { selector: { codes: ['A'] }, maximum: 2 }
    parameters.self = parameters
    const rules = defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'cyclic', rules: [{ id: 'cycle', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters }] })
    assert.ok(Object.isFrozen(rules.rules[0]!.parameters))
    assert.equal((rules.rules[0]!.parameters.self as object), rules.rules[0]!.parameters)
  })

  it('executes every registry algorithm without a jurisdiction branch', () => {
    const cases = [
      { class: 'quantity-limit', parameters: { selector: { codes: ['A'] }, maximum: 2 }, patch: {} },
      { class: 'value-limit', parameters: { selector: { codes: ['A'] }, maximum: '20.00' }, patch: {} },
      { class: 'mutual-exclusion', parameters: { selector: { codes: ['A'] }, excluded: { codes: ['A'] } }, patch: {} },
      { class: 'companion-required', parameters: { selector: { codes: ['A'] }, required: { codes: ['B'] } }, patch: {} },
      { class: 'bounded-multiplier', parameters: { selector: { codes: ['A'] }, minimum: 1, maximum: 2 }, patch: { lines: [{ ...baseCase.lines[0]!, multiplier: 3 }] } },
      { class: 'accompanying-information-required', parameters: { selector: { codes: ['A'] }, information: { kind: 'report', fact: 'report' } }, patch: { facts: { report: { kind: 'billing-fact', state: 'known-absent' } } } },
      { class: 'patient-attribute-constraint', parameters: { selector: { codes: ['A'] }, attribute: 'age', predicate: { maximum: 10, unit: 'a' } }, patch: { facts: { age: { value: 40, unit: 'a' } } } },
      { class: 'contract-participation', parameters: { selector: { codes: ['A'] }, contract: 'synthetic-contract' }, patch: {} },
      { class: 'minimum-evidence-count', parameters: { selector: { codes: ['A'] }, minimum: 2, sources: [{ fact: 'evidence-alpha', credit: 1 }, { fact: 'evidence-beta', credit: 1, maximumCredit: 1 }] }, patch: { facts: { 'evidence-alpha': 0, 'evidence-beta': 0 } } },
      ...addedClassProbes.map((probe) => ({ class: probe.class, parameters: probe.parameters, patch: probe.violated })),
    ] as const
    for (const [index, probe] of cases.entries()) {
      const rules = defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: `probe-${index}`, rules: [{ id: `rule-${index}`, class: probe.class, mustUnderstand: true, effect: 'reject', priority: index, parameters: probe.parameters }] })
      const admission = { ...completeAdmission, ruleSet: { ...completeAdmission.ruleSet, edition: `probe-${index}` } }
      const result = evaluateBillingCase(compileRuleSet(rules, admission), { ...baseCase, ...probe.patch })
      assert.equal(result.outcome, 'rejected', probe.class)
      assert.equal(result.evaluatedRuleIds[0], `rule-${index}`)
    }
  })

  it('evaluates required facts, counting windows, rule exceptions, and modifier exceptions', () => {
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [
        {
          id: 'scoped-limit',
          class: 'quantity-limit',
          mustUnderstand: true,
          effect: 'reject',
          priority: 1,
          requiredFacts: ['service-occurrence'],
          parameters: {
            selector: { codes: ['A'] },
            maximum: 3,
            countingScope: { window: 'episode', subject: 'recipient' },
            exceptWhen: { fact: 'exception-status', valueIn: ['waived'] },
            modifierExceptions: ['EXEMPT'],
          },
        },
      ],
    })
    const compiled = compileRuleSet(rules, completeAdmission)
    const scopedCase: BillingCase = {
      ...baseCase,
      lines: [
        { ...baseCase.lines[0]!, quantity: 2 },
        { ...baseCase.lines[0]!, id: 'b', quantity: 2 },
        { ...baseCase.lines[0]!, id: 'c', quantity: 99, modifiers: ['EXEMPT'] },
      ],
      facts: {
        'service-occurrence': { kind: 'billing-fact', state: 'known', value: true },
        'exception-status': { kind: 'billing-fact', state: 'known-absent' },
      },
      countingWindows: [{ scope: { window: 'episode', subject: 'recipient' }, lineIds: ['a', 'b', 'c'] }],
    }
    assert.equal(evaluateBillingCase(compiled, scopedCase).reason.code, 'RULE_REJECTED')
    assert.deepEqual(evaluateBillingCase(compiled, scopedCase).axisReasons.map((item) => item.lineId), ['a', 'b'])
    assert.equal(evaluateBillingCase(compiled, {
      ...scopedCase,
      facts: { ...scopedCase.facts, 'exception-status': { kind: 'billing-fact', state: 'known', value: 'waived' } },
    }).outcome, 'accepted')
    const missingException = evaluateBillingCase(compiled, {
      ...scopedCase,
      facts: { 'service-occurrence': { kind: 'billing-fact', state: 'known', value: true } },
    })
    assert.equal(missingException.outcome, 'needs-review')
    assert.equal(missingException.reason.code, 'RULE_EXCEPTION_UNAVAILABLE')

    for (const facts of [
      { 'service-occurrence': { kind: 'billing-fact' as const, state: 'not-supplied' as const } },
      { 'service-occurrence': { kind: 'billing-fact' as const, state: 'source-unavailable' as const } },
      {},
    ]) {
      const result = evaluateBillingCase(compiled, { ...scopedCase, facts })
      assert.equal(result.outcome, 'needs-review')
      assert.equal(result.reason.code, 'REQUIRED_FACT_UNAVAILABLE')
    }
    const missingWindow = evaluateBillingCase(compiled, { ...scopedCase, countingWindows: [] })
    assert.equal(missingWindow.outcome, 'needs-review')
    assert.equal(missingWindow.reason.code, 'COUNTING_SCOPE_UNAVAILABLE')
  })

  it('evaluates actual multipliers, factor thresholds, threshold effects, and agreement overrides', () => {
    const rule: BillingRule = {
      id: 'factor',
      class: 'bounded-multiplier',
      mustUnderstand: true,
      effect: 'reject',
      priority: 1,
      parameters: {
        selector: { codes: ['A'] },
        minimum: 1,
        maximum: 3.5,
        standardThreshold: 2.3,
        aboveThresholdEffect: 'needs-review',
        agreementOverride: { fact: 'patient-agreement', valueIn: [true] },
      },
    }
    const compiled = compileRuleSet(defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'portable-rules', rules: [rule] }), completeAdmission)
    const evaluateMultiplier = (actualMultiplier: number | undefined, facts: BillingCase['facts'] = {}) => evaluateBillingCase(compiled, {
      ...baseCase,
      facts,
      lines: [{ ...baseCase.lines[0]!, ...(actualMultiplier === undefined ? {} : { actualMultiplier }) }],
    })

    assert.equal(evaluateMultiplier(undefined).reason.code, 'ACTUAL_MULTIPLIER_UNAVAILABLE')
    assert.equal(evaluateMultiplier(2).outcome, 'accepted')
    assert.equal(evaluateMultiplier(2.5).reason.code, 'AGREEMENT_OVERRIDE_UNAVAILABLE')
    const threshold = evaluateMultiplier(2.5, { 'patient-agreement': { kind: 'billing-fact', state: 'known-absent' } })
    assert.equal(threshold.outcome, 'needs-review')
    assert.equal(threshold.reason.code, 'MULTIPLIER_THRESHOLD_EXCEEDED')
    assert.equal(evaluateMultiplier(2.5, { 'patient-agreement': { kind: 'billing-fact', state: 'known', value: true } }).outcome, 'accepted')
    assert.equal(evaluateMultiplier(4, { 'patient-agreement': { kind: 'billing-fact', state: 'known', value: true } }).reason.code, 'RULE_REJECTED')
  })

  describe('bounded-multiplier justificationWaivesThreshold', () => {
    const multiplierRule = (parameters: Record<string, unknown>): BillingRule => ({
      id: 'factor',
      class: 'bounded-multiplier',
      mustUnderstand: true,
      effect: 'reject',
      priority: 1,
      parameters: { selector: { codes: ['A'] }, minimum: 1, maximum: 3.5, ...parameters },
    })
    const define = (parameters: Record<string, unknown>) => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'portable-rules', rules: [multiplierRule(parameters)] })
    const evaluateLine = (parameters: Record<string, unknown>, line: Partial<BillingCase['lines'][number]>) => evaluateBillingCase(
      compileRuleSet(define(parameters), completeAdmission),
      { ...baseCase, lines: [{ ...baseCase.lines[0]!, ...line }] },
    )
    const axisCodes = (result: ReturnType<typeof evaluateBillingCase>) => result.axisReasons.map((item) => item.code)

    it('keeps the threshold finding regardless of a justification when the parameter is absent or false', () => {
      for (const parameters of [
        { standardThreshold: 2.3, aboveThresholdEffect: 'reject' },
        { standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: false },
      ]) {
        for (const multiplierJustified of [undefined, true, false]) {
          const result = evaluateLine(parameters, { actualMultiplier: 2.5, ...(multiplierJustified === undefined ? {} : { multiplierJustified }) })
          assert.equal(result.outcome, 'rejected')
          assert.ok(axisCodes(result).includes('MULTIPLIER_THRESHOLD_EXCEEDED'))
          assert.equal(axisCodes(result).includes('MULTIPLIER_JUSTIFICATION_REQUIRED'), false)
        }
      }
      const review = evaluateLine({ standardThreshold: 2.3, aboveThresholdEffect: 'needs-review' }, { actualMultiplier: 2.5, multiplierJustified: true })
      assert.equal(review.outcome, 'needs-review')
      assert.equal(review.reason.code, 'MULTIPLIER_THRESHOLD_EXCEEDED')
    })

    it('waives the threshold for a justified line and requires a justification otherwise', () => {
      const parameters = { standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: true }
      assert.equal(evaluateLine(parameters, { actualMultiplier: 2.5, multiplierJustified: true }).outcome, 'accepted')
      for (const line of [{ actualMultiplier: 2.5 }, { actualMultiplier: 2.5, multiplierJustified: false }]) {
        const result = evaluateLine(parameters, line)
        assert.equal(result.outcome, 'rejected')
        const finding = result.axisReasons.find((item) => item.code === 'MULTIPLIER_JUSTIFICATION_REQUIRED')
        assert.equal(finding?.lineId, baseCase.lines[0]!.id)
        assert.equal(finding?.ruleId, 'factor')
        assert.equal(axisCodes(result).includes('MULTIPLIER_THRESHOLD_EXCEEDED'), false)
      }
      const review = evaluateLine({ ...parameters, aboveThresholdEffect: 'needs-review' }, { actualMultiplier: 2.5 })
      assert.equal(review.outcome, 'needs-review')
      assert.equal(review.reason.code, 'MULTIPLIER_JUSTIFICATION_REQUIRED')
      assert.equal(evaluateLine(parameters, { actualMultiplier: 2.3 }).outcome, 'accepted')
      const outOfBounds = evaluateLine(parameters, { actualMultiplier: 4, multiplierJustified: true })
      assert.equal(outOfBounds.outcome, 'rejected')
      assert.deepEqual(axisCodes(outOfBounds), ['MULTIPLIER_OUT_OF_BOUNDS'])
      assert.equal(evaluateLine(parameters, { multiplierJustified: true }).reason.code, 'ACTUAL_MULTIPLIER_UNAVAILABLE')
    })

    it('waives the threshold for a justified line before the agreement fact is consulted', () => {
      const parameters = {
        standardThreshold: 2.3,
        aboveThresholdEffect: 'reject',
        justificationWaivesThreshold: true,
        agreementOverride: { fact: 'patient-agreement', valueIn: [true] },
      }
      const compiled = compileRuleSet(define(parameters), completeAdmission)
      const evaluateWith = (facts: BillingCase['facts'], line: Partial<BillingCase['lines'][number]>) => evaluateBillingCase(compiled, {
        ...baseCase,
        facts,
        lines: [{ ...baseCase.lines[0]!, actualMultiplier: 2.5, ...line }],
      })
      const agreedFact = { 'patient-agreement': { kind: 'billing-fact', state: 'known', value: true } } as BillingCase['facts']
      const refusedFact = { 'patient-agreement': { kind: 'billing-fact', state: 'known', value: false } } as BillingCase['facts']

      for (const facts of [{}, agreedFact, refusedFact]) {
        const justified = evaluateWith(facts, { multiplierJustified: true })
        assert.equal(justified.outcome, 'accepted', JSON.stringify(facts))
        assert.deepEqual(axisCodes(justified), [], JSON.stringify(facts))
      }

      const unjustifiedUnknown = evaluateWith({}, {})
      assert.equal(unjustifiedUnknown.outcome, 'needs-review')
      assert.equal(unjustifiedUnknown.reason.code, 'AGREEMENT_OVERRIDE_UNAVAILABLE')
      assert.equal(axisCodes(unjustifiedUnknown).includes('MULTIPLIER_JUSTIFICATION_REQUIRED'), false)

      assert.equal(evaluateWith(agreedFact, {}).outcome, 'accepted')

      const unjustifiedRefused = evaluateWith(refusedFact, { multiplierJustified: false })
      assert.equal(unjustifiedRefused.outcome, 'rejected')
      assert.deepEqual(axisCodes(unjustifiedRefused), ['MULTIPLIER_JUSTIFICATION_REQUIRED'])
    })

    it('rejects a waiver without standardThreshold or with a non-boolean value', () => {
      assert.throws(() => define({ justificationWaivesThreshold: true }), BillingInputError)
      assert.throws(() => define({ justificationWaivesThreshold: false }), BillingInputError)
      for (const justificationWaivesThreshold of ['true', 1, null, {}]) {
        assert.throws(() => define({ standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold }), BillingInputError, String(justificationWaivesThreshold))
      }
      assert.doesNotThrow(() => define({ standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: true }))
    })

    describe('without maximum', () => {
      const unboundedParameters = { standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: true }
      const defineUnbounded = (parameters: Record<string, unknown>) => {
        const rule = multiplierRule(parameters)
        const { maximum: _maximum, ...withoutMaximum } = rule.parameters
        return defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'portable-rules', rules: [{ ...rule, parameters: withoutMaximum }] })
      }
      const evaluateUnbounded = (line: Partial<BillingCase['lines'][number]>, parameters: Record<string, unknown> = unboundedParameters) => evaluateBillingCase(
        compileRuleSet(defineUnbounded(parameters), completeAdmission),
        { ...baseCase, lines: [{ ...baseCase.lines[0]!, ...line }] },
      )

      it('has no upper bound: a justified line far above the threshold produces no finding', () => {
        for (const actualMultiplier of [3, 4, 10]) {
          const result = evaluateUnbounded({ actualMultiplier, multiplierJustified: true })
          assert.equal(result.outcome, 'accepted', String(actualMultiplier))
          assert.deepEqual(axisCodes(result), [], String(actualMultiplier))
        }
      })

      it('requires a justification above the threshold instead of reporting out of bounds', () => {
        for (const line of [{ actualMultiplier: 3 }, { actualMultiplier: 4 }, { actualMultiplier: 4, multiplierJustified: false }]) {
          const result = evaluateUnbounded(line)
          assert.equal(result.outcome, 'rejected', JSON.stringify(line))
          assert.deepEqual(axisCodes(result), ['MULTIPLIER_JUSTIFICATION_REQUIRED'], JSON.stringify(line))
          assert.equal(result.axisReasons[0]?.lineId, baseCase.lines[0]!.id)
          assert.equal(result.axisReasons[0]?.ruleId, 'factor')
        }
      })

      it('keeps the lower bound, the regular range and the missing multiplier unchanged', () => {
        const below = evaluateUnbounded({ actualMultiplier: 0.5, multiplierJustified: true })
        assert.equal(below.outcome, 'rejected')
        assert.deepEqual(axisCodes(below), ['MULTIPLIER_OUT_OF_BOUNDS'])
        const regular = evaluateUnbounded({ actualMultiplier: 2 })
        assert.equal(regular.outcome, 'accepted')
        assert.deepEqual(axisCodes(regular), [])
        const missing = evaluateUnbounded({})
        assert.equal(missing.outcome, 'needs-review')
        assert.equal(missing.reason.code, 'ACTUAL_MULTIPLIER_UNAVAILABLE')
      })

      it('keeps the threshold finding without a waiver and accepts a rule with only a lower bound', () => {
        const exceeded = evaluateUnbounded({ actualMultiplier: 10, multiplierJustified: true }, { standardThreshold: 2.3, aboveThresholdEffect: 'needs-review' })
        assert.equal(exceeded.outcome, 'needs-review')
        assert.equal(exceeded.reason.code, 'MULTIPLIER_THRESHOLD_EXCEEDED')
        assert.equal(evaluateUnbounded({ actualMultiplier: 100 }, {}).outcome, 'accepted')
        assert.deepEqual(axisCodes(evaluateUnbounded({ actualMultiplier: 0.5 }, {})), ['MULTIPLIER_OUT_OF_BOUNDS'])
      })

      it('validates a rule without maximum and keeps the lower-bound checks', () => {
        assert.doesNotThrow(() => defineUnbounded(unboundedParameters))
        assert.doesNotThrow(() => defineUnbounded({}))
        assert.throws(() => defineUnbounded({ standardThreshold: 0.5, aboveThresholdEffect: 'reject' }), BillingInputError)
        assert.throws(() => defineUnbounded({ minimum: Number.NaN }), BillingInputError)
      })
    })

    it('keeps a set maximum as an upper bound for a justified line', () => {
      const result = evaluateLine({ standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: true }, { actualMultiplier: 4, multiplierJustified: true })
      assert.equal(result.outcome, 'rejected')
      assert.deepEqual(axisCodes(result), ['MULTIPLIER_OUT_OF_BOUNDS'])
    })

    it('still validates a maximum that is present', () => {
      for (const maximum of [Number.NaN, Number.POSITIVE_INFINITY, '3.5', null]) {
        assert.throws(() => define({ maximum }), BillingInputError, String(maximum))
      }
      assert.throws(() => define({ minimum: 4, maximum: 3.5 }), BillingInputError)
      assert.throws(() => define({ maximum: 2, standardThreshold: 2.3, aboveThresholdEffect: 'reject' }), BillingInputError)
      assert.doesNotThrow(() => define({ maximum: 2.3, standardThreshold: 2.3, aboveThresholdEffect: 'reject' }))
    })

    it('rejects a non-boolean multiplierJustified on a case line', () => {
      const parameters = { standardThreshold: 2.3, aboveThresholdEffect: 'reject', justificationWaivesThreshold: true }
      for (const multiplierJustified of ['true', 1, null]) {
        assert.throws(() => evaluateLine(parameters, { actualMultiplier: 2.5, multiplierJustified: multiplierJustified as unknown as boolean }), BillingInputError)
      }
    })
  })

  it('confines relational rule lookups to the declared counting window', () => {
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{
        id: 'scoped-exclusion', class: 'mutual-exclusion', mustUnderstand: true, effect: 'reject', priority: 1,
        parameters: {
          selector: { codes: ['A'] }, excluded: { codes: ['B'] },
          countingScope: { window: 'episode', subject: 'recipient' },
        },
      }],
    })
    const billingCase: BillingCase = {
      ...baseCase,
      lines: [baseCase.lines[0]!, { ...baseCase.lines[0]!, id: 'b', code: { ...baseCase.lines[0]!.code, code: 'B' } }],
      countingWindows: [{ scope: { window: 'episode', subject: 'recipient' }, lineIds: ['a'] }],
    }
    assert.equal(evaluateBillingCase(compileRuleSet(rules, completeAdmission), billingCase).outcome, 'accepted')
  })

  it('does not require shared evidence for non-applicable or modifier-exempt rules', () => {
    const probes: BillingRule[] = [
      {
        id: 'different-code', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1,
        requiredFacts: ['missing'], parameters: { selector: { codes: ['X'] }, maximum: 1 },
      },
      {
        id: 'different-code-scope', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 2,
        parameters: { selector: { codes: ['X'] }, maximum: 1, countingScope: { window: 'episode', subject: 'recipient' } },
      },
      {
        id: 'modifier-exempt', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 3,
        requiredFacts: ['missing'], parameters: { selector: { codes: ['A'] }, maximum: 1, modifierExceptions: ['EXEMPT'] },
      },
    ]
    const rules = defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'portable-rules', rules: probes })
    const input = { ...baseCase, lines: [{ ...baseCase.lines[0]!, modifiers: ['EXEMPT'] }] }
    assert.equal(evaluateBillingCase(compileRuleSet(rules, completeAdmission), input).outcome, 'accepted')
  })

  it('rejects malformed must-understand semantic declarations', () => {
    const baseRule: BillingRule = { id: 'bad', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: 1 } }
    const define = (rule: BillingRule) => defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'portable-rules', rules: [rule] })
    assert.throws(() => define({ ...baseRule, requiredFacts: ['fact', 'fact'] }), BillingInputError)
    assert.throws(() => define({ ...baseRule, parameters: { ...baseRule.parameters, countingScope: { window: '', subject: 'recipient' } } }), BillingInputError)
    assert.throws(() => define({ ...baseRule, parameters: { ...baseRule.parameters, exceptWhen: { fact: 'status', valueIn: [] } } }), BillingInputError)
    assert.throws(() => define({ ...baseRule, parameters: { ...baseRule.parameters, modifierExceptions: [''] } }), BillingInputError)
    assert.throws(() => define({ ...baseRule, mustUnderstand: undefined } as unknown as BillingRule), BillingInputError)
    assert.throws(() => define({ ...baseRule, mustUnderstand: 'false' } as unknown as BillingRule), BillingInputError)
  })

  it('preserves unmarked legacy object facts that contain a state property', () => {
    const rules = defineBillingRuleSet({
      schemaVersion: 2, semanticMajor: 4, id: 'portable-rules',
      rules: [{ id: 'limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: 5 } }],
    })
    assert.doesNotThrow(() => evaluateBillingCase(compileRuleSet(rules, completeAdmission), { ...baseCase, facts: { address: { state: 'BY' } } }))
    assert.throws(() => evaluateBillingCase(compileRuleSet(rules, completeAdmission), { ...baseCase, facts: { evidence: { state: 'source-unavailable' } } }), BillingInputError)
  })

  it('carries optional terminology version on a case line coding through evaluation', () => {
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const versionedCase: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A', version: '2026' },
        quantity: 3,
        unitPrice: { value: '10.00', currency: 'EUR' },
      }],
    }
    const result = evaluateBillingCase(compileRuleSet(rules, completeAdmission), versionedCase)
    assert.equal(result.outcome, 'rejected')
    const finding = result.axisReasons[0]
    assert.equal(finding?.lineId, 'a')
    const line = versionedCase.lines.find((item) => item.id === finding?.lineId)
    assert.equal(line?.code.version, '2026')
  })

  it('recovers a versioned coding from a value-limit finding and serializes it with the case', () => {
    const ruleSet = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const versionedCase: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A', version: '2026' },
        quantity: 3,
        unitPrice: { value: '10.00', currency: 'EUR' },
      }],
    }
    const result = evaluateBillingCase(compileRuleSet(ruleSet, completeAdmission), versionedCase)
    const finding = result.axisReasons[0]
    const line = versionedCase.lines.find((item) => item.id === finding?.lineId)
    assert.equal(line?.code.system, 'https://example.invalid/system/service')
    assert.equal(line?.code.code, 'A')
    assert.equal(line?.code.version, '2026')
    assert.equal(JSON.parse(JSON.stringify(line?.code)).version, '2026')
    assert.match(canonicalizeJson(versionedCase), /"version":"2026"/)
    const envelope = toOracleParameters({
      id: 'versioned-coding',
      admission: completeAdmission,
      ruleSet,
      case: versionedCase,
      expectedOutcome: result.outcome,
      expectedReason: result.reason.code,
      expectedAxisReasons: result.axisReasons.map((item) => item.code),
    }, result)
    const caseParameter = envelope.parameter.find((parameter) => parameter.name === 'case')
    assert.ok(caseParameter && 'valueString' in caseParameter)
    assert.match(caseParameter.valueString, /"version":"2026"/)
  })

  it('hydrates a catalog-priced line so a value-limit evaluates the resolved price', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: 'A', unitPrice: '15.00' }],
    }
    const unresolved: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A' },
        quantity: 2,
        unitPrice: { value: '0.00', currency: 'EUR' },
      }],
    }
    const resolved = resolveCatalogUnitPrices(unresolved, prices, completeAdmission)
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const result = evaluateBillingCase(compileRuleSet(rules, completeAdmission), resolved)
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(result.axisReasons.map((item) => item.code), ['VALUE_CAP_APPLICABLE'])
  })

  it('hydrates every numeric-zero placeholder so a value-limit evaluates the resolved price', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: 'A', unitPrice: '15.00' }],
    }
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const compiled = compileRuleSet(rules, completeAdmission)
    for (const placeholder of ['0', '0.0'] as const) {
      const unresolved: BillingCase = {
        ...baseCase,
        lines: [{
          id: 'a',
          code: { system: 'https://example.invalid/system/service', code: 'A' },
          quantity: 2,
          unitPrice: { value: placeholder, currency: 'EUR' },
        }],
      }
      const resolved = resolveCatalogUnitPrices(unresolved, prices, completeAdmission)
      const result = evaluateBillingCase(compiled, resolved)
      assert.equal(result.outcome, 'rejected', placeholder)
      assert.deepEqual(result.axisReasons.map((item) => item.code), ['VALUE_CAP_APPLICABLE'], placeholder)
    }
  })

  it('never overwrites a source-carried unit price from the catalog table', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: 'A', unitPrice: '99.00' }],
    }
    const sourced: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A' },
        quantity: 1,
        unitPrice: { value: '10.00', currency: 'EUR' },
      }],
    }
    const resolved = resolveCatalogUnitPrices(sourced, prices, completeAdmission)
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['A'] }, maximum: '20.00' } }],
    })
    const result = evaluateBillingCase(compileRuleSet(rules, completeAdmission), resolved)
    assert.equal(result.outcome, 'accepted')
  })

  it('fails closed when a catalog-priced line has no price in the admitted edition', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: 'B', unitPrice: '15.00' }],
    }
    const unresolved: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A' },
        quantity: 2,
        unitPrice: { value: '0.00', currency: 'EUR' },
      }],
    }
    assert.throws(
      () => resolveCatalogUnitPrices(unresolved, prices, completeAdmission),
      (error: unknown) => error instanceof BillingInputError && /Line a has no catalog unit price/.test(error.message),
    )
  })

  it('refuses a price table whose edition or digest does not match admission', () => {
    const unresolved: BillingCase = {
      ...baseCase,
      lines: [{
        id: 'a',
        code: { system: 'https://example.invalid/system/service', code: 'A' },
        quantity: 2,
        unitPrice: { value: '0.00', currency: 'EUR' },
      }],
    }
    const matchingPrices = {
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: 'A', unitPrice: '15.00' }],
    }
    assert.throws(
      () => resolveCatalogUnitPrices(unresolved, { ...matchingPrices, edition: 'other-edition', digest: 'sha256:catalog' }, completeAdmission),
      BillingInputError,
    )
    assert.throws(
      () => resolveCatalogUnitPrices(unresolved, { ...matchingPrices, edition: 'synthetic-2026', digest: 'sha256:other' }, completeAdmission),
      BillingInputError,
    )
  })

  // cognovis/fhir-billing-core#33: the KV values TSVG case markers such as 99873A at 0.00 EUR on purpose.
  it('prices a line at 0.00 when the catalog table publishes 0.00 for its code', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [
        { system: 'https://example.invalid/system/service', code: '99873A', unitPrice: '0.00' },
        { system: 'https://example.invalid/system/service', code: 'P', unitPriceUnknown: true as const },
      ],
    }
    const unresolved: BillingCase = {
      ...baseCase,
      lines: [
        { id: 'placeholder', code: { system: 'https://example.invalid/system/service', code: '99873A' }, quantity: 2, unitPrice: { value: '0.00', currency: 'EUR' } },
        { id: 'unknown', code: { system: 'https://example.invalid/system/service', code: '99873A' }, quantity: 1, unitPriceUnknown: true },
        { id: 'points', code: { system: 'https://example.invalid/system/service', code: 'P' }, quantity: 1, unitPrice: { value: '0.00', currency: 'EUR' } },
      ],
    }
    const resolved = resolveCatalogUnitPrices(unresolved, prices, completeAdmission)
    assert.deepEqual(resolved.lines.map((line) => [line.id, line.unitPrice, line.unitPriceUnknown]), [
      ['placeholder', { value: '0.00', currency: 'EUR' }, undefined],
      ['unknown', { value: '0.00', currency: 'EUR' }, undefined],
      ['points', undefined, true],
    ])
    const rules = defineBillingRuleSet({
      schemaVersion: 2,
      semanticMajor: 4,
      id: 'portable-rules',
      rules: [{ id: 'value', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: ['99873A'] }, maximum: '0.00' } }],
    })
    const result = evaluateBillingCase(compileRuleSet(rules, completeAdmission), { ...resolved, lines: resolved.lines.slice(0, 2) })
    assert.equal(result.outcome, 'accepted')
  })

  it('still fails closed for a line without a table entry when another code is published at 0.00', () => {
    const prices = {
      edition: 'synthetic-2026',
      digest: 'sha256:catalog',
      currency: 'EUR',
      prices: [{ system: 'https://example.invalid/system/service', code: '99873A', unitPrice: '0.00' }],
    }
    for (const line of [
      { id: 'a', code: { system: 'https://example.invalid/system/service', code: 'A' }, quantity: 1, unitPrice: { value: '0.00', currency: 'EUR' } },
      { id: 'a', code: { system: 'https://example.invalid/system/service', code: 'A' }, quantity: 1, unitPriceUnknown: true as const },
    ]) {
      assert.throws(
        () => resolveCatalogUnitPrices({ ...baseCase, lines: [line] }, prices, completeAdmission),
        (error: unknown) => error instanceof BillingInputError && /Line a has no catalog unit price for A/.test(error.message),
      )
    }
  })
})
