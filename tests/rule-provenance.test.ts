/**
 * Rule provenance (#45): every rule may state its sources and evidence level, a rule-set Library names
 * its publisher, and every finding of a rule with provenance names that rule's sources. Provenance is
 * covered by the rule-set digest and never changes evaluation. All rules, sources and citations here
 * are invented. The SDK block reason and the bundle record naming the publisher are tested with the SDK
 * in cognovis/chp.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BillingInputError,
  billingRulePayloadDigest,
  buildBillingLibrary,
  decodeBillingAdmission,
  decodeBillingLibrary,
  decodeBillingRuleSet,
  defineBillingRuleSet,
  type BillingRuleSetLibraryInput,
} from '@cognovis/fhir-billing-rules'
import { compareConformanceRecords, compileRuleSet, evaluateBillingCaseFindings, evaluateConformanceCases } from '@cognovis/fhir-billing-engine'
import {
  BILLING_RULE_SOURCE_KINDS,
  type AdmissionState,
  type BillingCase,
  type BillingRule,
  type BillingRuleProvenance,
  type BillingRuleSource,
  type BillingRuleSet,
} from '@cognovis/fhir-billing-types'

const SYSTEM = 'https://example.invalid/CodeSystem/synthetic-dental-fee'
const EVIDENCE_SYSTEM = 'https://example.invalid/CodeSystem/synthetic-evidence-level'
const RULE_SET_URL = 'https://example.invalid/Library/synthetic-provenance-rules'
const RULE_SET_VERSION = '2026.1'
const PUBLISHER = 'Synthetic Rule Authority'

const COURT_SOURCE: BillingRuleSource = {
  kind: 'court-decision',
  citation: 'Synthetic Regional Court, file 1 S 23/26, decision of 2026-03-12',
  uri: 'https://example.invalid/decisions/1-s-23-26',
  codes: ['SD-0010'],
}

const PROVENANCE: BillingRuleProvenance = {
  sources: [COURT_SOURCE, { kind: 'fee-schedule', citation: 'Synthetic dental fee schedule 2026, section 2' }],
  evidenceLevel: { system: EVIDENCE_SYSTEM, code: 'binding', display: 'Binding decision' },
  note: 'Invented provenance for the conformance tests.',
}

function exclusiveRule(provenance: BillingRuleProvenance | undefined = PROVENANCE): BillingRule {
  return {
    id: 'exam-consultation-exclusive',
    class: 'mutual-exclusion',
    mustUnderstand: true,
    effect: 'reject',
    priority: 2,
    parameters: {
      selector: { system: SYSTEM, codes: ['SD-0020'] },
      excluded: { system: SYSTEM, codes: ['SD-0010'] },
    },
    ...(provenance === undefined ? {} : { provenance }),
  }
}

const QUANTITY_RULE: BillingRule = {
  id: 'scaling-quantity-limit',
  class: 'quantity-limit',
  mustUnderstand: true,
  effect: 'reject',
  priority: 1,
  parameters: { selector: { system: SYSTEM, codes: ['SD-1000'] }, maximum: 1 },
}

function ruleSet(rules: readonly BillingRule[] = [QUANTITY_RULE, exclusiveRule()]): BillingRuleSet {
  return { schemaVersion: 2, semanticMajor: 4, id: 'synthetic-provenance-rules-2026', rules }
}

function libraryInput(payload: BillingRuleSet = ruleSet(), extra: Partial<BillingRuleSetLibraryInput> = {}): BillingRuleSetLibraryInput {
  return {
    kind: 'rule-set',
    id: 'synthetic-provenance-rules',
    url: RULE_SET_URL,
    version: RULE_SET_VERSION,
    status: 'active',
    effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
    publisher: PUBLISHER,
    contact: [{ name: 'Synthetic rule desk', telecom: [{ system: 'email', value: 'rules@example.invalid' }] }],
    payload,
    relatedArtifacts: [],
    ...extra,
  }
}

function line(id: string, code: string, quantity = 1): BillingCase['lines'][number] {
  return { id, code: { system: SYSTEM, code }, quantity, unitPrice: { value: '10.00', currency: 'EUR' } }
}

const EXCLUSIVE_CASE: BillingCase = { id: 'exclusive-pair', asOf: '2026-06-01', facts: {}, lines: [line('exclusive-pair-1', 'SD-0010'), line('exclusive-pair-2', 'SD-0020')] }
const QUANTITY_CASE: BillingCase = { id: 'quantity-limit', asOf: '2026-06-01', facts: {}, lines: [line('quantity-limit-1', 'SD-1000', 2)] }
const CLEAN_CASE: BillingCase = { id: 'clean', asOf: '2026-06-01', facts: {}, lines: [line('clean-1', 'SD-0020')] }

function withoutProvenance(rules: readonly BillingRule[]): BillingRule[] {
  return rules.map(({ provenance: _provenance, ...rule }) => rule)
}

function admission(payload: BillingRuleSet): AdmissionState {
  const edition = { digest: 'sha256:synthetic', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true } as const
  return { status: 'admitted', catalog: { edition: 'synthetic-catalog', ...edition }, ruleSet: { edition: payload.id, ...edition } }
}

describe('rule provenance', () => {
  it('round-trips a rule set with a court-decision source for one fee number through build and decode unchanged', () => {
    const resource = buildBillingLibrary(libraryInput())
    assert.equal(resource.publisher, PUBLISHER)
    assert.deepEqual(resource.contact, [{ name: 'Synthetic rule desk', telecom: [{ system: 'email', value: 'rules@example.invalid' }] }])
    const decoded = decodeBillingLibrary(resource)
    assert.equal(decoded.kind, 'rule-set')
    if (decoded.kind !== 'rule-set') return
    assert.deepEqual(decoded.payload, ruleSet())
    assert.deepEqual(decoded.payload.rules[1]!.provenance, PROVENANCE)
    assert.deepEqual(decoded.payload.rules[1]!.provenance!.sources[0], COURT_SOURCE)
    assert.equal(decoded.publisher, PUBLISHER)
    assert.deepEqual(decoded.contact, libraryInput().contact)
    assert.deepEqual(decoded.resource, resource)
    assert.deepEqual(buildBillingLibrary(libraryInput(decoded.payload)), resource)
    assert.deepEqual(decodeBillingRuleSet(ruleSet()), ruleSet())
    assert.deepEqual(BILLING_RULE_SOURCE_KINDS, ['statute', 'fee-schedule', 'contract', 'court-decision', 'authority-statement', 'commentary', 'author-assessment'])
  })

  it('covers provenance by the rule-set digest, so changing only the citation is a new rule-set version', () => {
    const changed = ruleSet([QUANTITY_RULE, exclusiveRule({ ...PROVENANCE, sources: [{ ...COURT_SOURCE, citation: 'Synthetic Regional Court, file 1 S 24/26, decision of 2026-03-12' }, PROVENANCE.sources[1]!] })])
    const digest = (payload: BillingRuleSet) => decodeBillingLibrary(buildBillingLibrary(libraryInput(payload))).digest
    assert.equal(digest(ruleSet()), billingRulePayloadDigest({ schemaVersion: 2, rules: ruleSet().rules }))
    assert.notEqual(digest(changed), digest(ruleSet()))
    assert.notEqual(digest(ruleSet(withoutProvenance(ruleSet().rules))), digest(ruleSet()))
  })

  it('never changes evaluation: decisions, reason codes, details and resolutions equal those of the rules without provenance', () => {
    const strip = (records: ReturnType<typeof evaluateConformanceCases>) => records.map((record) => ({
      caseId: record.caseId,
      decision: record.decision,
      findings: record.findings.map(({ sources: _sources, evidenceLevel: _evidenceLevel, ...finding }) => finding),
    }))
    const cases = [EXCLUSIVE_CASE, QUANTITY_CASE, CLEAN_CASE]
    const withProvenance = evaluateConformanceCases({ ruleSet: ruleSet(), cases })
    const plain = evaluateConformanceCases({ ruleSet: ruleSet(withoutProvenance(ruleSet().rules)), cases })
    assert.deepEqual(strip(withProvenance), strip(plain))
    assert.deepEqual(withProvenance.map((record) => record.decision), ['block', 'block', 'allow'])
  })

  it('refuses invalid provenance with a BillingInputError naming the rule id', () => {
    const invalid: [string, unknown][] = [
      ['unknown provenance key', { ...PROVENANCE, confidence: 'high' }],
      ['provenance not an object', 'statute'],
      ['empty sources', { ...PROVENANCE, sources: [] }],
      ['missing sources', { evidenceLevel: PROVENANCE.evidenceLevel }],
      ['unknown source kind', { ...PROVENANCE, sources: [{ kind: 'blog-post', citation: 'Synthetic blog' }] }],
      ['unknown source key', { ...PROVENANCE, sources: [{ ...COURT_SOURCE, court: 'Synthetic Regional Court' }] }],
      ['empty citation', { ...PROVENANCE, sources: [{ kind: 'statute', citation: ' ' }] }],
      ['empty uri', { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'Synthetic act', uri: '' }] }],
      ['duplicate codes', { ...PROVENANCE, sources: [{ ...COURT_SOURCE, codes: ['SD-0010', 'SD-0010'] }] }],
      ['empty code', { ...PROVENANCE, sources: [{ ...COURT_SOURCE, codes: [''] }] }],
      ['empty code list', { ...PROVENANCE, sources: [{ ...COURT_SOURCE, codes: [] }] }],
      ['whitespace-only code', { ...PROVENANCE, sources: [{ ...COURT_SOURCE, codes: ['SD-0010', ' '] }] }],
      ['missing evidence level', { sources: PROVENANCE.sources }],
      ['evidence level without system', { ...PROVENANCE, evidenceLevel: { code: 'binding' } }],
      ['evidence level without code', { ...PROVENANCE, evidenceLevel: { system: EVIDENCE_SYSTEM } }],
      ['evidence level with unknown key', { ...PROVENANCE, evidenceLevel: { ...PROVENANCE.evidenceLevel, rank: 1 } }],
      ['empty note', { ...PROVENANCE, note: '' }],
    ]
    for (const [label, provenance] of invalid) {
      const payload = ruleSet([QUANTITY_RULE, { ...exclusiveRule(undefined), provenance } as unknown as BillingRule])
      const named = (error: unknown) => error instanceof BillingInputError && error.message.includes('exam-consultation-exclusive')
      assert.throws(() => defineBillingRuleSet(payload), named, `defineBillingRuleSet: ${label}`)
      assert.throws(() => decodeBillingRuleSet(payload), named, `decodeBillingRuleSet: ${label}`)
      assert.throws(() => buildBillingLibrary(libraryInput(payload)), named, `buildBillingLibrary: ${label}`)
    }
  })

  it('refuses an unknown top-level rule key on the typed API as the carriers do, so a misspelled provenance fails', () => {
    const { provenance, ...rule } = exclusiveRule()
    const misspelled = ruleSet([QUANTITY_RULE, { ...rule, provenence: provenance } as unknown as BillingRule])
    assert.throws(() => defineBillingRuleSet(misspelled), (error: unknown) => error instanceof BillingInputError && /exam-consultation-exclusive.*provenence/.test(error.message))
    assert.throws(() => compileRuleSet(misspelled, admission(misspelled)), BillingInputError)
    assert.throws(() => decodeBillingRuleSet(misspelled), BillingInputError)
  })

  it('requires a publisher to build a rule-set Library and refuses a malformed contact', () => {
    const { publisher: _publisher, ...withoutPublisher } = libraryInput()
    assert.throws(() => buildBillingLibrary(withoutPublisher as unknown as BillingRuleSetLibraryInput), BillingInputError)
    assert.throws(() => buildBillingLibrary(libraryInput(ruleSet(), { publisher: ' ' })), BillingInputError)
    for (const contact of [[], [{}], [{ name: '' }], [{ name: 'Desk', url: 'https://example.invalid' }], [{ telecom: [] }], [{ telecom: [{ system: 'pigeon', value: 'x' }] }], [{ telecom: [{ system: 'email' }] }]]) {
      assert.throws(() => buildBillingLibrary(libraryInput(ruleSet(), { contact } as never)), BillingInputError, JSON.stringify(contact))
    }
    const { contact: _contact, ...withoutContact } = libraryInput()
    assert.equal('contact' in buildBillingLibrary(withoutContact), false)
  })

  it('still decodes and evaluates a rule-set Library without publisher, and its record names no publisher', () => {
    const { publisher: _publisher, contact: _contact, ...legacy } = buildBillingLibrary(libraryInput())
    const decoded = decodeBillingLibrary(legacy)
    assert.equal(decoded.kind, 'rule-set')
    assert.equal('publisher' in decoded, false)
    assert.equal('contact' in decoded, false)
    const cases = [EXCLUSIVE_CASE, QUANTITY_CASE, CLEAN_CASE]
    const records = evaluateConformanceCases({ ruleSet: legacy, cases })
    const published = evaluateConformanceCases({ ruleSet: buildBillingLibrary(libraryInput()), cases })
    assert.deepEqual(records.map((record) => record.decision), ['block', 'block', 'allow'])
    for (const record of records) assert.equal('publisher' in record.ruleSet, false)
    assert.deepEqual(records.map(({ ruleSet: { publisher: _p, ...identity }, ...record }) => ({ ...record, ruleSet: identity })), published.map(({ ruleSet: { publisher: _p, ...identity }, ...record }) => ({ ...record, ruleSet: identity })))
    assert.deepEqual(compareConformanceRecords(records, published), [])
  })

  it('gives findings of a rule without provenance no sources and no evidence level', () => {
    const plain = ruleSet(withoutProvenance(ruleSet().rules))
    const [record] = evaluateConformanceCases({ ruleSet: buildBillingLibrary(libraryInput(plain)), cases: [EXCLUSIVE_CASE] })
    assert.equal(record!.decision, 'block')
    for (const finding of record!.findings) {
      assert.equal('sources' in finding, false)
      assert.equal('evidenceLevel' in finding, false)
    }
    const [quantity] = evaluateConformanceCases({ ruleSet: buildBillingLibrary(libraryInput()), cases: [QUANTITY_CASE] })
    assert.deepEqual(quantity!.findings.map((finding) => [finding.ruleId, 'sources' in finding, 'evidenceLevel' in finding]), [['scaling-quantity-limit', false, false]])
  })

  it('names the sources and evidence level of the producing rule on a block finding of the standalone record, and the record names the publisher', () => {
    const [record] = evaluateConformanceCases({ ruleSet: buildBillingLibrary(libraryInput()), cases: [EXCLUSIVE_CASE] })
    assert.equal(record!.decision, 'block')
    assert.equal(record!.ruleSet.publisher, PUBLISHER)
    assert.deepEqual(record!.findings.map((finding) => [finding.ruleId, finding.code, finding.effect, finding.sources, finding.evidenceLevel]), [
      ['exam-consultation-exclusive', 'MUTUALLY_EXCLUSIVE_CODE_PRESENT', 'reject', PROVENANCE.sources, PROVENANCE.evidenceLevel],
    ])
    const { result, findings } = evaluateBillingCaseFindings(compileRuleSet(ruleSet(), admission(ruleSet())), EXCLUSIVE_CASE)
    assert.equal(result.outcome, 'rejected')
    assert.deepEqual(findings.map((finding) => [finding.reason.ruleId, finding.reason.sources, finding.reason.evidenceLevel]), [['exam-consultation-exclusive', PROVENANCE.sources, PROVENANCE.evidenceLevel]])
    assert.equal(result.reason.sources, undefined)
  })
})
