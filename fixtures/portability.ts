import type { AdmissionState, BillingCase, BillingRuleSet, OracleFixture } from '@cognovis/fhir-billing-types'

const admitted = (catalogEdition: string): AdmissionState => ({
  status: 'admitted',
  catalog: { edition: catalogEdition, digest: `sha256:${catalogEdition}`, availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
  ruleSet: { edition: 'synthetic-portability', digest: 'sha256:portable-rules-1', availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true },
})

const ruleSet: BillingRuleSet = {
  schemaVersion: 2,
  semanticMajor: 4,
  id: 'synthetic-portability',
  rules: [{ id: 'portable-quantity', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 10, parameters: { selector: { codes: ['SYN-1'] }, maximum: 2 } }],
}

const billingCase = (id: string, quantity: number, currency: string): BillingCase => ({
  id,
  asOf: '2026-08-14',
  lines: [{ id: `${id}-line`, code: { system: 'https://example.invalid/fhir-billing-core/synthetic-service', code: 'SYN-1' }, quantity, unitPrice: { value: '10.00', currency } }],
  facts: {},
})

const selector = { codes: ['SYN-1'] } as const

/**
 * One rule per published generic class, so every algorithm travels inside a single portable rule set.
 * It is bound to a Contract because `contract-code-list` belongs only to a contract rule set.
 */
export const mixedClassRuleSet: BillingRuleSet = {
  schemaVersion: 2,
  semanticMajor: 4,
  id: 'synthetic-portability',
  appliesTo: { contracts: ['https://example.invalid/Contract/synthetic-contract'] },
  rules: [
    { id: 'mixed-01-quantity-limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector, maximum: 5 } },
    { id: 'mixed-02-value-limit', class: 'value-limit', mustUnderstand: true, effect: 'reject', priority: 2, parameters: { selector, maximum: '20.00' } },
    { id: 'mixed-03-mutual-exclusion', class: 'mutual-exclusion', mustUnderstand: true, effect: 'reject', priority: 3, parameters: { selector, excluded: { codes: ['SYN-9'] } } },
    { id: 'mixed-04-companion-required', class: 'companion-required', mustUnderstand: true, effect: 'reject', priority: 4, parameters: { selector, required: { codes: ['SYN-1'] } } },
    { id: 'mixed-05-bounded-multiplier', class: 'bounded-multiplier', mustUnderstand: true, effect: 'reject', priority: 5, parameters: { selector, minimum: 1, maximum: 2 } },
    { id: 'mixed-06-accompanying-information', class: 'accompanying-information-required', mustUnderstand: true, effect: 'reject', priority: 6, parameters: { selector, information: { kind: 'synthetic-report', fact: 'accompanying-report', valueIn: ['freeform', 'structured'] } } },
    { id: 'mixed-07-patient-attribute', class: 'patient-attribute-constraint', mustUnderstand: true, effect: 'reject', priority: 7, parameters: { selector, attribute: 'patient-age', predicate: { minimum: 18, unit: 'a' } } },
    { id: 'mixed-08-contract-participation', class: 'contract-participation', mustUnderstand: true, effect: 'reject', priority: 8, parameters: { selector, contract: 'synthetic-contract' } },
    { id: 'mixed-09-setting-constraint', class: 'setting-constraint', mustUnderstand: true, effect: 'reject', priority: 9, parameters: { selector, setting: 'billing-setting', predicate: { polarity: 'include', valueIn: ['synthetic-setting-one', 'synthetic-setting-two'] } } },
    { id: 'mixed-10-prior-authorization', class: 'prior-authorization-required', mustUnderstand: true, effect: 'reject', priority: 10, parameters: { selector, authorization: 'synthetic-programme', grant: { fact: 'authorization-grant', valueIn: ['granted'] } } },
    { id: 'mixed-11-procedure-finding', class: 'procedure-finding-requirement', mustUnderstand: true, effect: 'reject', priority: 11, parameters: { selector, procedure: { fact: 'procedure-findings', polarity: 'include', valueIn: ['SYN-P1', { code: 'SYN-P2', qualifiers: { laterality: ['left'] } }] } } },
    { id: 'mixed-12-diagnosis-requirement', class: 'diagnosis-requirement', mustUnderstand: true, effect: 'reject', priority: 12, parameters: { selector, diagnosis: { fact: 'diagnoses', polarity: 'exclude', valueIn: ['SYN-D9'] } } },
    { id: 'mixed-13-provider-eligibility', class: 'provider-eligibility', mustUnderstand: true, effect: 'reject', priority: 13, parameters: { selector, provider: { fact: 'provider-qualifications', polarity: 'include', qualifications: [{ group: 'synthetic-group', members: ['synthetic-member'] }] } } },
    { id: 'mixed-14-quota-degression', class: 'quota-degression', mustUnderstand: true, effect: 'reject', priority: 14, parameters: { selector, threshold: { stated: true, quantity: 5 }, adjustment: { stated: true, factor: '0.8500' }, scopeAxes: { 'quota-period': ['synthetic-period'] } } },
    { id: 'mixed-15-minimum-evidence', class: 'minimum-evidence-count', mustUnderstand: true, effect: 'reject', priority: 15, parameters: { selector, minimum: 3, sources: [{ fact: 'evidence-alpha', credit: 1 }, { fact: 'evidence-beta', credit: 1, maximumCredit: 1 }] } },
    { id: 'mixed-16-contract-code-list', class: 'contract-code-list', mustUnderstand: true, effect: 'reject', priority: 16, parameters: { selector, permitted: { codes: ['SYN-1'] } } },
  ],
}

export const mixedClassCase = (id: string, facts: BillingCase['facts'] = {}): BillingCase => ({
  id,
  asOf: '2026-08-14',
  lines: [{ id: `${id}-line`, code: { system: 'https://example.invalid/fhir-billing-core/synthetic-service', code: 'SYN-1' }, quantity: 1, unitPrice: { value: '10.00', currency: 'EUR' }, actualMultiplier: 1.5 }],
  contracts: ['synthetic-contract'],
  facts: {
    'accompanying-report': 'structured',
    'patient-age': { value: 240, unit: 'mo' },
    'billing-setting': 'synthetic-setting-two',
    'authorization-grant': 'granted',
    'procedure-findings': [{ code: 'SYN-P2', laterality: 'left' }],
    diagnoses: ['SYN-D1'],
    'provider-qualifications': [{ group: 'synthetic-group', member: 'synthetic-member' }],
    'quota-period': 'synthetic-period',
    'evidence-alpha': 2,
    'evidence-beta': 1,
    ...facts,
  },
})

export const syntheticFixtures: readonly OracleFixture[] = [
  { id: 'core-accepted', admission: admitted('core-synthetic-1'), ruleSet, case: billingCase('core-case', 1, 'EUR'), expectedOutcome: 'accepted', expectedReason: 'ELIGIBLE', expectedAxisReasons: [] },
  { id: 'synthetic-german-rejected', admission: admitted('german-synthetic-1'), ruleSet, case: billingCase('german-synthetic-case', 3, 'EUR'), expectedOutcome: 'rejected', expectedReason: 'RULE_REJECTED', expectedAxisReasons: ['QUANTITY_CAP_EXCEEDED'] },
  { id: 'synthetic-swiss-rejected', admission: admitted('swiss-synthetic-1'), ruleSet, case: billingCase('swiss-synthetic-case', 3, 'CHF'), expectedOutcome: 'rejected', expectedReason: 'RULE_REJECTED', expectedAxisReasons: ['QUANTITY_CAP_EXCEEDED'] },
  {
    id: 'synthetic-swiss-unavailable',
    admission: { ...admitted('swiss-synthetic-1'), catalog: { ...admitted('swiss-synthetic-1').catalog, availability: 'missing', completeness: 'unknown', entitled: false } },
    ruleSet,
    case: billingCase('swiss-unavailable-case', 1, 'CHF'),
    expectedOutcome: 'needs-review',
    expectedReason: 'EDITION_UNAVAILABLE',
    expectedAxisReasons: ['EDITION_UNAVAILABLE', 'ADMISSION_INCOMPLETE', 'EDITION_UNENTITLED'],
  },
  {
    id: 'mixed-class-accepted',
    admission: admitted('core-synthetic-1'),
    ruleSet: mixedClassRuleSet,
    case: mixedClassCase('mixed-accepted-case'),
    expectedOutcome: 'accepted',
    expectedReason: 'ELIGIBLE',
    expectedAxisReasons: [],
  },
  {
    id: 'mixed-class-setting-rejected',
    admission: admitted('core-synthetic-1'),
    ruleSet: mixedClassRuleSet,
    case: mixedClassCase('mixed-setting-case', { 'billing-setting': 'synthetic-setting-three' }),
    expectedOutcome: 'rejected',
    expectedReason: 'RULE_REJECTED',
    expectedAxisReasons: ['SETTING_NOT_PERMITTED'],
  },
  {
    id: 'mixed-class-authorization-indeterminate',
    admission: admitted('core-synthetic-1'),
    ruleSet: mixedClassRuleSet,
    case: mixedClassCase('mixed-authorization-case', { 'authorization-grant': { kind: 'billing-fact', state: 'not-supplied' } }),
    expectedOutcome: 'needs-review',
    expectedReason: 'PRIOR_AUTHORIZATION_INDETERMINATE',
    expectedAxisReasons: ['PRIOR_AUTHORIZATION_INDETERMINATE'],
  },
]
