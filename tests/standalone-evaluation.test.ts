/**
 * Standalone conformance evaluation of the engine (`evaluateConformanceCases`, @cognovis/fhir-billing-engine)
 * on the synthetic dental-shaped example in fixtures/standalone. The command-line tool fhir-billing-check
 * and its tests moved with the SDK to cognovis/chp (cognovis/fhir-billing-core#212).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { BillingInputError, buildBillingLibrary, canonicalizeJson, decodeBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { BILLING_ENGINE_VERSION, compareConformanceRecords, evaluateConformanceCases } from '@cognovis/fhir-billing-engine'
import { BILLING_CONFORMANCE_FORMAT, type BillingConformanceRecord, type BillingRule } from '@cognovis/fhir-billing-types'

const FIXTURES = 'fixtures/standalone'
const RULE_SET_DIGEST = 'sha256:50945204fde3323189a06e28f58f81f43c92ac2d7e55d2634f16d57c7c1fbb82'
const SYSTEM = 'https://example.invalid/CodeSystem/synthetic-dental-fee'

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsonLines(path: string): unknown[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown)
}

const library = () => readJson(`${FIXTURES}/rule-set.json`) as Record<string, unknown>
const payload = () => readJson(`${FIXTURES}/rule-set.payload.json`) as Record<string, unknown>
const cases = () => readJsonLines(`${FIXTURES}/cases.jsonl`)
const jsonLines = (records: readonly BillingConformanceRecord[]) => records.map((record) => `${canonicalizeJson(record)}\n`).join('')

function line(id: string, code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, code: { system: SYSTEM, code }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' }, actualMultiplier: 2.3, ...extra }
}

describe('standalone conformance evaluation', () => {
  it('evaluates the synthetic dental example to one record per case with the rule set identity', () => {
    const records = evaluateConformanceCases({ ruleSet: library(), cases: cases() })
    assert.deepEqual(records.map((record) => [record.caseId, record.decision]), [
      ['exclusive-pair', 'block'],
      ['quantity-limit', 'block'],
      ['missing-companion', 'block'],
      ['unjustified-factor', 'block'],
      ['clean', 'allow'],
    ])
    const findings = (caseId: string) => records.find((record) => record.caseId === caseId)!.findings.map((finding) => [finding.ruleId, finding.lineId, finding.code, finding.effect])
    assert.deepEqual(findings('exclusive-pair'), [['exam-consultation-exclusive', 'exclusive-pair-2', 'MUTUALLY_EXCLUSIVE_CODE_PRESENT', 'reject']])
    assert.deepEqual(findings('quantity-limit'), [['scaling-quantity-limit', 'quantity-limit-1', 'QUANTITY_CAP_EXCEEDED', 'reject']])
    assert.deepEqual(findings('missing-companion'), [['restoration-requires-companion', 'missing-companion-1', 'COMPANION_CODE_REQUIRED', 'reject']])
    assert.deepEqual(findings('unjustified-factor'), [['factor-threshold', 'unjustified-factor-1', 'MULTIPLIER_JUSTIFICATION_REQUIRED', 'reject']])
    assert.deepEqual(findings('clean'), [])
    for (const record of records) {
      assert.equal(record.format, 'fhir-billing-conformance/1')
      assert.equal(record.format, BILLING_CONFORMANCE_FORMAT)
      assert.equal(record.mode, 'standalone')
      assert.equal(record.engineVersion, BILLING_ENGINE_VERSION)
      assert.equal(record.advisories, undefined)
      assert.deepEqual(record.ruleSet, {
        id: 'synthetic-dental-rules-2026',
        digest: RULE_SET_DIGEST,
        canonical: 'https://example.invalid/Library/synthetic-dental-rules',
        version: '2026.1',
        publisher: 'Synthetic Dental Rule Authority',
      })
    }
  })

  it('matches the checked-in expected records of the example', () => {
    const records = evaluateConformanceCases({ ruleSet: library(), cases: cases() })
    assert.equal(jsonLines(records), readFileSync(`${FIXTURES}/expected.jsonl`, 'utf8'))
  })

  it('reports every selected line of an explicit counting window once a counting-scoped limit is exceeded', () => {
    const scoped = payload()
    const rules = (scoped.rules as Record<string, unknown>[]).map((rule) => rule.id === 'scaling-quantity-limit'
      ? { ...rule, parameters: { ...(rule.parameters as Record<string, unknown>), countingScope: { window: 'calendar-year', subject: 'patient' } } }
      : rule)
    const windowCase = {
      id: 'window-limit',
      asOf: '2026-09-14',
      lines: [line('window-1', 'SD-1000'), line('window-2', 'SD-1000')],
      facts: {},
      countingWindows: [{ scope: { window: 'calendar-year', subject: 'patient' }, lineIds: ['window-1', 'window-2'] }],
    }
    const [record] = evaluateConformanceCases({ ruleSet: { ...scoped, rules }, cases: [windowCase] })
    assert.equal(record!.decision, 'block')
    assert.deepEqual(record!.findings.map((finding) => [finding.ruleId, finding.lineId, finding.code, finding.effect]), [
      ['scaling-quantity-limit', 'window-1', 'QUANTITY_CAP_EXCEEDED', 'reject'],
      ['scaling-quantity-limit', 'window-2', 'QUANTITY_CAP_EXCEEDED', 'reject'],
    ])
  })

  it('evaluates the typed counting-window example to its checked-in records', () => {
    const evaluated = evaluateConformanceCases({ ruleSet: readJson(`${FIXTURES}/window-rule-set.payload.json`), cases: readJsonLines(`${FIXTURES}/window-cases.jsonl`) })
    assert.equal(jsonLines(evaluated), readFileSync(`${FIXTURES}/window-expected.jsonl`, 'utf8'))
    const records = readJsonLines(`${FIXTURES}/window-expected.jsonl`) as BillingConformanceRecord[]
    assert.deepEqual(records.map((record) => [record.caseId, record.decision, record.findings.map((finding) => [finding.lineId, finding.code, finding.effect])]), [
      ['window-over-limit', 'block', [['window-over-limit-1', 'QUANTITY_CAP_EXCEEDED', 'reject'], ['window-over-limit-2', 'QUANTITY_CAP_EXCEEDED', 'reject']]],
      ['window-within-limit', 'allow', []],
      ['window-missing', 'unavailable', [[undefined, 'COUNTING_SCOPE_UNAVAILABLE', 'needs-review']]],
    ])
  })

  it('evaluates a bare rule-set payload with its computed digest and no canonical or version', () => {
    const fromPayload = evaluateConformanceCases({ ruleSet: payload(), cases: cases() })
    const fromLibrary = evaluateConformanceCases({ ruleSet: library(), cases: cases() })
    assert.deepEqual(fromPayload[0]!.ruleSet, { id: 'synthetic-dental-rules-2026', digest: RULE_SET_DIGEST })
    assert.deepEqual(
      fromPayload.map(({ caseId, decision, findings }) => ({ caseId, decision, findings })),
      fromLibrary.map(({ caseId, decision, findings }) => ({ caseId, decision, findings })),
    )
  })

  it('is deterministic and orders findings by ruleId, lineId and code whatever the rule priority or line order', () => {
    const tangled = {
      id: 'tangled',
      asOf: '2026-02-02',
      lines: [line('z-consult', 'SD-0020', { actualMultiplier: 3.0 }), line('a-exam', 'SD-0010'), line('m-restore', 'SD-2000', { actualMultiplier: 3.0 })],
      facts: {},
    }
    const reversed = { ...tangled, lines: [...tangled.lines].reverse() }
    const reprioritized = payload()
    const rules = (reprioritized.rules as Record<string, unknown>[]).map((rule, index, all) => ({ ...rule, priority: all.length - index }))
    const first = evaluateConformanceCases({ ruleSet: payload(), cases: [tangled] })
    const second = evaluateConformanceCases({ ruleSet: { ...reprioritized, rules }, cases: [reversed] })
    const expected = [
      ['exam-consultation-exclusive', 'z-consult', 'MUTUALLY_EXCLUSIVE_CODE_PRESENT'],
      ['factor-threshold', 'm-restore', 'MULTIPLIER_JUSTIFICATION_REQUIRED'],
      ['factor-threshold', 'z-consult', 'MULTIPLIER_JUSTIFICATION_REQUIRED'],
      ['restoration-requires-companion', 'm-restore', 'COMPANION_CODE_REQUIRED'],
    ]
    for (const records of [first, second]) {
      assert.deepEqual(records[0]!.findings.map((finding) => [finding.ruleId, finding.lineId, finding.code]), expected)
    }
    assert.equal(jsonLines(evaluateConformanceCases({ ruleSet: library(), cases: cases() })), jsonLines(evaluateConformanceCases({ ruleSet: library(), cases: cases() })))
  })

  it('records a malformed case as unavailable with BILLING_INPUT_INVALID and evaluates the remaining cases', () => {
    const negative = { id: 'negative-quantity', asOf: '2026-03-02', lines: [line('line-1', 'SD-0010', { quantity: -1 })], facts: {} }
    const shapeless = { asOf: '2026-03-02', facts: {} }
    const records = evaluateConformanceCases({ ruleSet: library(), cases: [negative, 42, shapeless, ...cases()] })
    assert.deepEqual(records.map((record) => [record.caseId, record.decision]).slice(0, 4), [
      ['negative-quantity', 'unavailable'],
      ['#2', 'unavailable'],
      ['#3', 'unavailable'],
      ['exclusive-pair', 'block'],
    ])
    for (const record of records.slice(0, 3)) {
      assert.equal(record.findings.length, 1)
      assert.equal(record.findings[0]!.code, 'BILLING_INPUT_INVALID')
      assert.equal(record.findings[0]!.effect, 'needs-review')
      assert.equal(typeof record.findings[0]!.details?.message, 'string')
    }
    assert.equal(records[0]!.findings[0]!.details?.message, 'Line line-1 quantity must be a non-negative integer.')
    assert.equal(records.length, 8)
  })

  it('makes a case outside the rule-set Library effectivePeriod unavailable', () => {
    const clean = cases()[4] as Record<string, unknown>
    const records = evaluateConformanceCases({ ruleSet: library(), cases: [{ ...clean, id: 'early', asOf: '2025-12-31' }, { ...clean, id: 'late', asOf: '2027-01-01' }] })
    assert.deepEqual(records.map((record) => [record.caseId, record.decision, record.findings.map((finding) => [finding.code, finding.effect])]), [
      ['early', 'unavailable', [['EDITION_UNAVAILABLE', 'needs-review']]],
      ['late', 'unavailable', [['EDITION_EXPIRED', 'needs-review']]],
    ])
    assert.equal(evaluateConformanceCases({ ruleSet: payload(), cases: [{ ...clean, asOf: '2025-12-31' }] })[0]!.decision, 'allow')
  })

  it('refuses a digest mismatch, a non-rule-set Library and an unsupported payload before any record', () => {
    const tampered = library()
    tampered.identifier = (tampered.identifier as { system: string; value: string }[]).map((identifier) => identifier.value.startsWith('sha256:') ? { ...identifier, value: `sha256:${'0'.repeat(64)}` } : identifier)
    assert.throws(() => evaluateConformanceCases({ ruleSet: tampered, cases: cases() }), BillingInputError)
    const rule = (payload().rules as BillingRule[])[0]!
    const configuredRule = buildBillingLibrary({
      kind: 'configured-rule',
      id: 'synthetic-factor',
      url: 'https://example.invalid/Library/synthetic-factor',
      version: '2026.1',
      status: 'active',
      payload: { schemaVersion: 2, semanticMajor: 4, rule },
      relatedArtifacts: [{ type: 'depends-on', resource: 'https://example.invalid/Library/synthetic-dental-rules|2026.1' }],
    })
    assert.throws(() => evaluateConformanceCases({ ruleSet: configuredRule, cases: cases() }), /artifact-kind configured-rule is not a rule set/)
    assert.throws(() => evaluateConformanceCases({ ruleSet: { ...payload(), semanticMajor: 3 }, cases: cases() }), BillingInputError)
    assert.throws(() => evaluateConformanceCases({ ruleSet: { ...payload(), schemaVersion: 1 }, cases: cases() }), BillingInputError)
    assert.throws(() => evaluateConformanceCases({ ruleSet: { ...payload(), rules: 'none' }, cases: cases() }), BillingInputError)
    assert.throws(() => evaluateConformanceCases({ ruleSet: 'rules', cases: cases() }), BillingInputError)
  })

  it('refuses a bare payload exactly as the rule-set Library codec refuses its payload', () => {
    const rules = () => (payload().rules as Record<string, unknown>[]).map((rule) => ({ ...rule }))
    const misspelled = rules()
    misspelled[0] = { ...misspelled[0]!, effectiveStrat: '2026-01-01' }
    const classless = rules()
    delete classless[1]!.class
    const refusals: [unknown, string][] = [
      [{ ...payload(), publisher: 'someone' }, 'Rule-set payload must contain exactly id, rules, schemaVersion, semanticMajor.'],
      [{ ...payload(), rules: misspelled }, 'Rule-set rule 0 does not accept effectiveStrat.'],
      [{ ...payload(), rules: classless }, 'Rule-set rule 1 class must be non-empty.'],
      ['rules', 'Rule-set payload must be an object.'],
    ]
    for (const [ruleSet, message] of refusals) {
      assert.throws(() => evaluateConformanceCases({ ruleSet, cases: cases() }), (error: unknown) => error instanceof BillingInputError && error.message === message)
      assert.throws(() => decodeBillingRuleSet(ruleSet), (error: unknown) => error instanceof BillingInputError && error.message === message)
    }
  })

  it('refuses duplicate case ids, including a fallback id that equals another case id, before any record', () => {
    const [first, second] = cases() as Record<string, unknown>[]
    assert.throws(() => evaluateConformanceCases({ ruleSet: library(), cases: [first, { ...second, id: first!.id }] }), /duplicate caseId exclusive-pair/)
    assert.throws(() => evaluateConformanceCases({ ruleSet: library(), cases: [{ ...first, id: '#2' }, 42] }), (error: unknown) => error instanceof BillingInputError && /duplicate caseId #2/.test(error.message))
  })

  it('records every malformed optional or nested field as BILLING_INPUT_INVALID instead of a runtime error', () => {
    const base = cases()[4] as Record<string, unknown>
    const baseLine = (base.lines as Record<string, unknown>[])[0]!
    const withLine = (patch: Record<string, unknown>) => ({ ...base, lines: [{ ...baseLine, ...patch }] })
    const malformed = [
      { ...base, facts: [] },
      { ...base, facts: 'none' },
      { ...base, lines: 'none' },
      withLine({ code: 'SD-0010' }),
      withLine({ unitPrice: '12.50' }),
      withLine({ quantity: '1' }),
      withLine({ modifiers: 'urgent' }),
      withLine({ modifiers: [1] }),
      withLine({ annotations: 'note' }),
      withLine({ annotations: [null] }),
      { ...base, countingWindows: {} },
      { ...base, countingWindows: [{ scope: 'calendar-year', lineIds: ['line-1'] }] },
      { ...base, countingWindows: [{ scope: { window: 'calendar-year', subject: 'patient' }, lineIds: [1] }] },
      { ...base, contracts: 'contract-a' },
      { ...base, contracts: [7] },
    ].map((item, index) => ({ ...item, id: `malformed-${index}` }))
    const records = evaluateConformanceCases({ ruleSet: library(), cases: malformed })
    for (const record of records) {
      assert.equal(record.decision, 'unavailable', record.caseId)
      assert.deepEqual(record.findings.map((finding) => [finding.code, finding.effect]), [['BILLING_INPUT_INVALID', 'needs-review']], record.caseId)
    }
  })

  it('states the effect of a review finding of a reject rule beside another rule\'s reject finding, and compare blocks only on the reject', () => {
    const records = evaluateConformanceCases({
      ruleSet: payload(),
      cases: [{ id: 'mixed', asOf: '2026-02-02', lines: [line('line-1', 'SD-2000', { actualMultiplier: undefined })], facts: {} }],
    })
    assert.equal(records[0]!.decision, 'block')
    assert.deepEqual(records[0]!.findings.map((finding) => [finding.ruleId, finding.code, finding.effect]), [
      ['factor-threshold', 'ACTUAL_MULTIPLIER_UNAVAILABLE', 'needs-review'],
      ['restoration-requires-companion', 'COMPANION_CODE_REQUIRED', 'reject'],
    ])
    assert.deepEqual(compareConformanceRecords(records, []), [{
      kind: 'left-only',
      caseId: 'mixed',
      left: { decision: 'block', blocking: [{ lineId: 'line-1', ruleId: 'restoration-requires-companion' }] },
    }])
    const withoutReview = records.map((record) => ({ ...record, findings: record.findings.filter((finding) => finding.effect === 'reject') }))
    assert.deepEqual(compareConformanceRecords(records, withoutReview), [])
  })

  it('names the rules it ignored because their class is unsupported and not must-understand', () => {
    const extended = payload()
    extended.rules = [
      ...(extended.rules as unknown[]),
      { id: 'z-vendor-hint', class: 'vendor-specific-hint', mustUnderstand: false, effect: 'reject', priority: 9, parameters: {} },
      { id: 'a-vendor-hint', class: 'vendor-specific-hint', mustUnderstand: false, effect: 'reject', priority: 8, parameters: {} },
    ]
    const records = evaluateConformanceCases({ ruleSet: extended, cases: [cases()[4], 42] })
    assert.equal(records[0]!.decision, 'allow')
    for (const record of records) assert.deepEqual(record.ignoredRuleIds, ['a-vendor-hint', 'z-vendor-hint'])
    for (const record of evaluateConformanceCases({ ruleSet: payload(), cases: cases() })) assert.equal('ignoredRuleIds' in record, false)
  })
})
