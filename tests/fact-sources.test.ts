/**
 * Fact-source declarations and line facts in the rule set and the engine (cognovis/fhir-billing-core#51,
 * #130, #134): declarations are validated and covered by the rule-set digest, the restricted path
 * grammar refuses prototype names and bare steps, line facts decide line-scoped classes, and a named
 * unavailable-fact cause reaches the finding. Reading the declared facts from FHIR is tested with the SDK
 * in cognovis/chp (fhir-foundation/packages/fhir-billing-sdk). Every code system and url is invented.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
import {
  BillingInputError,
  billingRulePayloadDigest,
  decodeBillingLibrary,
  decodeBillingRuleSet,
  defineBillingRuleSet,
  parseBillingFactSourcePath,
} from '@cognovis/fhir-billing-rules'
import type { AdmissionState, BillingCase, BillingFactSourceDeclaration, BillingRuleSet } from '@cognovis/fhir-billing-types'
import { nativeRuleSetLibrary } from './rule-set-binding-fixtures.js'

const SERVICE = 'https://example.invalid/CodeSystem/synthetic-fact-service'
const APPROVAL = 'https://example.invalid/CodeSystem/synthetic-approval'
const SCHEIN_TYPE = 'https://example.invalid/CodeSystem/synthetic-schein-type'
const FACT = 'https://example.invalid/CodeSystem/synthetic-fact'
const STATUS_EXTENSION = 'https://example.invalid/StructureDefinition/synthetic-insured-status'
const AS_OF = '2026-06-15'
const RULE_SET_URL = 'https://example.invalid/Library/synthetic-fact-rules'

type Rule = BillingRuleSet['rules'][number]

function rule(id: string, ruleClass: string, parameters: Record<string, unknown>, codes: readonly string[] = ['F-1']): Rule {
  return { id, class: ruleClass, mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { system: SERVICE, codes: [...codes] }, ...parameters } }
}

function payload(rules: readonly Rule[], factSources?: readonly BillingFactSourceDeclaration[]): BillingRuleSet {
  return { schemaVersion: 2, semanticMajor: 4, id: 'synthetic-fact-rules', rules, ...(factSources ? { factSources } : {}) }
}

const APPROVAL_SOURCE: BillingFactSourceDeclaration = {
  fact: 'authorization.grant',
  from: 'performer',
  path: `qualification.code.coding('${APPROVAL}')`,
  perBilledCode: { system: SERVICE },
  absent: 'known-absent',
}

const SCHEIN_SOURCE: BillingFactSourceDeclaration = { fact: 'schein.type', from: 'account', path: `type.coding('${SCHEIN_TYPE}')`, valueAs: 'code' }
const SCHEIN_RULE = rule('schein-type', 'setting-constraint', { setting: 'schein.type', predicate: { polarity: 'include', valueIn: ['SYN-T1'] } })

const SECTOR = 'https://example.invalid/CodeSystem/synthetic-sector'
const SPECIALTY = 'https://example.invalid/CodeSystem/synthetic-specialty'

const ELIGIBILITY_SOURCE: BillingFactSourceDeclaration = {
  fact: 'provider.eligibility',
  from: 'performer-role',
  path: `specialty.coding('${SPECIALTY}')`,
  valueAs: 'group-member',
  groupPath: `code.coding('${SECTOR}')`,
}

const ELIGIBILITY_RULE = rule('sector-1-synthetic-specialty', 'provider-eligibility', {
  provider: { fact: 'provider.eligibility', polarity: 'include', qualifications: [{ group: `${SECTOR}|1`, members: ['SYN-S80'] }] },
})


describe('fact-source declarations', () => {
  it('covers a declaration by the rule-set digest and keeps every digest without declarations', () => {
    const rules = [SCHEIN_RULE]
    const plain = billingRulePayloadDigest({ schemaVersion: 2, rules })
    assert.equal(billingRulePayloadDigest({ schemaVersion: 2, rules, factSources: undefined }), plain)
    const declared = billingRulePayloadDigest({ schemaVersion: 2, rules, factSources: [SCHEIN_SOURCE] })
    assert.notEqual(declared, plain)
    const changed = billingRulePayloadDigest({ schemaVersion: 2, rules, factSources: [{ ...SCHEIN_SOURCE, path: `type.coding('${SCHEIN_TYPE}-other')` }] })
    assert.notEqual(changed, declared)
    const carrier = nativeRuleSetLibrary({ id: 'synthetic-fact-rules', url: RULE_SET_URL, version: '2026.1', payload: payload(rules, [SCHEIN_SOURCE]) })
    const decoded = decodeBillingLibrary(carrier)
    assert.equal(decoded.digest, declared)
    assert.deepEqual(decoded.kind === 'rule-set' ? decoded.payload.factSources : undefined, [SCHEIN_SOURCE])
    // The checked-in dental rule set carries no declarations; its published digest is unchanged.
    const dental = JSON.parse(readFileSync('fixtures/standalone/rule-set.json', 'utf8')) as Record<string, unknown>
    const dentalDecoded = decodeBillingLibrary(dental)
    assert.equal(dentalDecoded.kind === 'rule-set' ? dentalDecoded.payload.factSources : 'no rule set', undefined)
    assert.equal(dentalDecoded.digest, billingRulePayloadDigest({ schemaVersion: 2, rules: dentalDecoded.kind === 'rule-set' ? dentalDecoded.payload.rules : [] }))
  })

  it('refuses a malformed declaration with BillingInputError', () => {
    const malformed: unknown[] = [
      [],
      [{ ...SCHEIN_SOURCE, unknown: true }],
      [{ ...SCHEIN_SOURCE, from: 'organization' }],
      [{ ...SCHEIN_SOURCE, fact: 'patient.age' }],
      [{ ...SCHEIN_SOURCE, fact: `${FACT}|report` }],
      [SCHEIN_SOURCE, SCHEIN_SOURCE],
      [{ ...SCHEIN_SOURCE, path: 'type..coding' }],
      [{ ...SCHEIN_SOURCE, path: `type.coding('${SCHEIN_TYPE}').code` }],
      [{ ...SCHEIN_SOURCE, path: 'extension(https://example.invalid/x)' }],
      [{ ...SCHEIN_SOURCE, path: "type.where(system='x')" }],
      [{ ...SCHEIN_SOURCE, path: `coding('${SCHEIN_TYPE}')` }],
      [{ ...SCHEIN_SOURCE, valueAs: 'display' }],
      [{ ...SCHEIN_SOURCE, absent: 'false' }],
      [{ ...SCHEIN_SOURCE, perBilledCode: {} }],
      [{ ...APPROVAL_SOURCE, perBilledCode: { system: '' } }],
      [{ ...APPROVAL_SOURCE, perBilledCode: { code: 'x' } }],
      [{ ...APPROVAL_SOURCE, path: 'qualification.code' }],
      'not-an-array',
    ]
    for (const factSources of malformed) {
      const input = { ...payload([SCHEIN_RULE]), factSources } as unknown as BillingRuleSet
      assert.throws(() => defineBillingRuleSet(input), BillingInputError, JSON.stringify(factSources))
      assert.throws(() => decodeBillingRuleSet(input), BillingInputError, JSON.stringify(factSources))
    }
    assert.deepEqual(decodeBillingRuleSet(payload([SCHEIN_RULE], [SCHEIN_SOURCE])).factSources, [SCHEIN_SOURCE])
  })

  it('parses the restricted path grammar', () => {
    assert.deepEqual(parseBillingFactSourcePath(`qualification.extension('${STATUS_EXTENSION}').valueCodeableConcept.coding('${APPROVAL}')`), [
      { kind: 'element', name: 'qualification' },
      { kind: 'extension', url: STATUS_EXTENSION },
      { kind: 'element', name: 'valueCodeableConcept' },
      { kind: 'coding', system: APPROVAL },
    ])
  })

  it('R5 and R9: refuses prototype names and bare coding or extension steps in a path', () => {
    for (const path of ['constructor', 'type.toString', 'type.hasOwnProperty', 'type.coding', 'extension.valueCode', `qualification.extension.coding('${APPROVAL}')`]) {
      assert.throws(() => parseBillingFactSourcePath(path), BillingInputError, path)
      assert.throws(() => defineBillingRuleSet(payload([SCHEIN_RULE], [{ ...SCHEIN_SOURCE, path }])), BillingInputError, path)
    }
  })

  it('AC3: accepts the group-member form on performer-role', () => {
    assert.deepEqual(defineBillingRuleSet(payload([ELIGIBILITY_RULE], [ELIGIBILITY_SOURCE])).factSources, [ELIGIBILITY_SOURCE])
    assert.deepEqual(decodeBillingRuleSet(payload([ELIGIBILITY_RULE], [ELIGIBILITY_SOURCE])).factSources, [ELIGIBILITY_SOURCE])
  })

  it('AC3: refuses the group-member form on any other from and every malformed variant', () => {
    const { groupPath: _groupPath, ...withoutGroupPath } = ELIGIBILITY_SOURCE
    const malformed: [string, unknown][] = [
      ...(['patient', 'coverage', 'account', 'encounter', 'performer'] as const).map((from): [string, unknown] => [`from ${from}`, { ...ELIGIBILITY_SOURCE, from }]),
      ['missing groupPath', withoutGroupPath],
      ['groupPath without group-member', { ...ELIGIBILITY_SOURCE, valueAs: 'code' }],
      ['groupPath without valueAs', { fact: 'provider.eligibility', from: 'performer-role', path: ELIGIBILITY_SOURCE.path, groupPath: ELIGIBILITY_SOURCE.groupPath }],
      ['groupPath not ending in coding', { ...ELIGIBILITY_SOURCE, groupPath: 'code' }],
      ['path not ending in coding', { ...ELIGIBILITY_SOURCE, path: 'specialty' }],
      ['unparsable groupPath', { ...ELIGIBILITY_SOURCE, groupPath: 'code..coding' }],
      ['non-string groupPath', { ...ELIGIBILITY_SOURCE, groupPath: 7 }],
      ['with absent', { ...ELIGIBILITY_SOURCE, absent: 'known-absent' }],
      ['with perBilledCode', { ...ELIGIBILITY_SOURCE, perBilledCode: { system: SERVICE } }],
    ]
    for (const [label, declaration] of malformed) {
      const input = payload([ELIGIBILITY_RULE], [declaration as BillingFactSourceDeclaration])
      assert.throws(() => defineBillingRuleSet(input), BillingInputError, label)
      assert.throws(() => decodeBillingRuleSet(input), BillingInputError, label)
    }
  })

  it('AC4: the engine copies a named cause into the finding details and refuses a malformed one', () => {
    const admission: AdmissionState = {
      status: 'admitted',
      catalog: { edition: 'standalone', digest: 'sha256:c', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
      ruleSet: { edition: 'cause-rules', digest: 'sha256:r', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
    }
    const compiled = compileRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'cause-rules', rules: [ELIGIBILITY_RULE] }, admission)
    const line = { id: 'l1', code: { system: SERVICE, code: 'F-1' }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' } }
    const run = (fact: unknown) => evaluateBillingCase(compiled, { id: 'case', asOf: AS_OF, facts: { 'provider.eligibility': fact }, lines: [line] } as BillingCase)
    for (const cause of ['account-owner-missing', 'role-missing', 'ambiguous-role']) {
      assert.deepEqual(run({ kind: 'billing-fact', state: 'source-unavailable', cause }).axisReasons.map((reason) => [reason.code, reason.details]), [['PROVIDER_ELIGIBILITY_INDETERMINATE', { fact: 'provider.eligibility', cause }]], cause)
    }
    assert.deepEqual(run({ kind: 'billing-fact', state: 'source-unavailable' }).axisReasons.map((reason) => [reason.code, reason.details]), [['PROVIDER_ELIGIBILITY_INDETERMINATE', { fact: 'provider.eligibility' }]])
    for (const fact of [
      { kind: 'billing-fact', state: 'source-unavailable', cause: 'other' },
      { kind: 'billing-fact', state: 'not-supplied', cause: 'role-missing' },
      { kind: 'billing-fact', state: 'known', value: [], cause: 'role-missing' },
    ]) assert.throws(() => run(fact), BillingInputError, JSON.stringify(fact))
  })
})

describe('engine line facts', () => {
  const admission: AdmissionState = {
    status: 'admitted',
    catalog: { edition: 'standalone', digest: 'sha256:c', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
    ruleSet: { edition: 'line-fact-rules', digest: 'sha256:r', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  }
  const line = (id: string, extra: Record<string, unknown> = {}) => ({ id, code: { system: SERVICE, code: 'F-1' }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' }, ...extra })
  const compiled = (rules: readonly Rule[]) => compileRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'line-fact-rules', rules }, admission)

  it('reads a line fact before the case fact for line-scoped classes only', () => {
    const settingRule = rule('setting', 'setting-constraint', { setting: 'site', predicate: { polarity: 'include', valueIn: ['a'] } })
    const input: BillingCase = { id: 'case', asOf: AS_OF, facts: { site: 'a' }, lines: [line('l1'), line('l2', { facts: { site: 'b' } })] }
    const result = evaluateBillingCase(compiled([settingRule]), input)
    assert.deepEqual(result.axisReasons.map((reason) => [reason.code, reason.lineId]), [['SETTING_NOT_PERMITTED', 'l2']])
    // minimum-evidence-count is not line-scoped: it reads the case fact only.
    const evidenceRule = rule('evidence', 'minimum-evidence-count', { minimum: 1, sources: [{ fact: 'count', credit: 1 }] })
    const counted = evaluateBillingCase(compiled([evidenceRule]), { id: 'case', asOf: AS_OF, facts: { count: 1 }, lines: [line('l1', { facts: { count: 0 } })] })
    assert.equal(counted.outcome, 'accepted')
  })

  it('reads accompanying information from the line information alone when the line carries it', () => {
    const reportRule = rule('report', 'accompanying-information-required', { information: { kind: 'synthetic-report', fact: 'report' } })
    const input: BillingCase = {
      id: 'case',
      asOf: AS_OF,
      facts: { report: 'present' },
      lines: [line('l1', { information: {} }), line('l2', { information: { report: 'present' } }), line('l3'), line('l4', { information: { report: { kind: 'billing-fact', state: 'known-absent' } } })],
    }
    const result = evaluateBillingCase(compiled([reportRule]), input)
    assert.deepEqual(result.axisReasons.map((reason) => [reason.code, reason.lineId]), [['ACCOMPANYING_INFORMATION_REQUIRED', 'l4'], ['REQUIRED_FACT_UNAVAILABLE', 'l1']])
  })

  it('names the line on an indeterminate finding decided from a line fact', () => {
    const settingRule = rule('setting', 'setting-constraint', { setting: 'site', predicate: { polarity: 'include', valueIn: ['a'] } })
    const input: BillingCase = { id: 'case', asOf: AS_OF, facts: {}, lines: [line('l1', { facts: { site: { kind: 'billing-fact', state: 'source-unavailable' } } })] }
    const result = evaluateBillingCase(compiled([settingRule]), input)
    assert.deepEqual(result.axisReasons, [{ code: 'SETTING_INDETERMINATE', ruleId: 'setting', lineId: 'l1', details: { fact: 'site' } }])
  })

  it('refuses a malformed line fact', () => {
    const settingRule = rule('setting', 'setting-constraint', { setting: 'site', predicate: { polarity: 'include', valueIn: ['a'] } })
    assert.throws(() => evaluateBillingCase(compiled([settingRule]), { id: 'case', asOf: AS_OF, facts: {}, lines: [line('l1', { facts: { site: { kind: 'billing-fact', state: 'maybe' } } })] }), BillingInputError)
  })
})
