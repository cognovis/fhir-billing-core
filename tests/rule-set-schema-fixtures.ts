/**
 * The shared rule-set fixtures that pin the published JSON Schema
 * (packages/rules/schema/billing-rule-set.schema.json) to the decoder `decodeBillingRuleSet`
 * (cognovis/fhir-billing-core#16). Every fixture is a bare rule-set file as an author writes it. A fixture
 * is accepted or refused by both; a `decoderOnly` fixture is one the schema accepts and the decoder refuses
 * for a constraint JSON Schema cannot state, named in the schema's `$defs/decoderOnly`. Every code,
 * system, fact and contract is synthetic.
 */

export type RuleSetFixtureExpectation = 'accept' | 'reject'

export interface RuleSetFixture {
  readonly name: string
  readonly ruleSet: unknown
  readonly expect: RuleSetFixtureExpectation
  /** The `$defs/decoderOnly` key of the constraint only the decoder enforces; the schema accepts the fixture. */
  readonly decoderOnly?: string
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type JsonObject = { readonly [key: string]: Json }

export const SYNTHETIC_SYSTEM = 'https://example.invalid/fee-schedule'
const CONTRACT = 'https://example.invalid/Contract/synthetic-care|1'
const EDITION = 'https://example.invalid/Library/synthetic-edition|2026'

/** One valid parameters object per generic rule class; every class fixture starts from it. */
export const CLASS_PARAMETERS: Readonly<Record<string, JsonObject>> = {
  'quantity-limit': { selector: { system: SYNTHETIC_SYSTEM, codes: ['A100'] }, maximum: 1 },
  'value-limit': { selector: { codes: ['A100'] }, maximum: '120.50' },
  'mutual-exclusion': { selector: { codes: ['A100'] }, excluded: { codes: ['A200', 'A201'] } },
  'companion-required': { selector: { codes: ['A100'] }, required: { codes: ['A300'] } },
  'bounded-multiplier': { selector: { codes: ['*'] }, minimum: 1, maximum: 3.5 },
  'accompanying-information-required': { selector: { codes: ['A100'] }, information: { kind: 'justification', fact: 'claim.justification' } },
  'patient-attribute-constraint': { selector: { codes: ['A100'] }, attribute: 'patient.age', predicate: { minimum: 18, unit: 'a' } },
  'contract-participation': { selector: { codes: ['A100'] }, contract: 'synthetic-care' },
  'contract-code-list': { selector: { codes: ['*'] }, permitted: { system: SYNTHETIC_SYSTEM, codes: ['A100', 'A101'] } },
  'setting-constraint': { selector: { codes: ['A100'] }, setting: 'encounter.class', predicate: { polarity: 'include', valueIn: ['AMB'] } },
  'prior-authorization-required': { selector: { codes: ['A100'] }, authorization: 'synthetic-programme', grant: { fact: 'authorization.status', valueIn: ['granted'] } },
  'procedure-finding-requirement': { selector: { codes: ['A100'] }, procedure: { fact: 'procedure.findings', polarity: 'include', valueIn: ['F1'] } },
  'diagnosis-requirement': { selector: { codes: ['A100'] }, diagnosis: { fact: 'diagnoses', system: 'https://example.invalid/icd', polarity: 'exclude', valueIn: ['D1'] } },
  'provider-eligibility': { selector: { codes: ['A100'] }, provider: { fact: 'provider.qualifications', polarity: 'include', qualifications: [{ group: 'surgery' }] } },
  'quota-degression': { selector: { codes: ['A100'] }, threshold: { stated: true, quantity: 10 }, adjustment: { stated: true, factor: '0.75' } },
  'minimum-evidence-count': { selector: { codes: ['A100'] }, minimum: 2, sources: [{ fact: 'evidence.visits', credit: 1 }] },
}

export function rule(ruleClass: string, parameters: Json, extra: JsonObject = {}): JsonObject {
  return { id: `rule-${ruleClass}`, class: ruleClass, mustUnderstand: true, effect: 'reject', priority: 10, parameters, ...extra }
}

/** A rule set holding the given rules; a contract code list is placed in a contract rule set, as it must be. */
export function ruleSet(rules: readonly Json[], extra: JsonObject = {}): JsonObject {
  const needsContract = rules.some((item) => typeof item === 'object' && item !== null && !Array.isArray(item) && (item as JsonObject).class === 'contract-code-list')
  return { schemaVersion: 2, semanticMajor: 4, id: 'synthetic-rule-set', rules, ...(needsContract ? { appliesTo: { contracts: [CONTRACT] } } : {}), ...extra }
}

function withParameters(ruleClass: string, change: JsonObject, remove: readonly string[] = []): JsonObject {
  const parameters: Record<string, Json> = { ...CLASS_PARAMETERS[ruleClass]!, ...change }
  for (const key of remove) delete parameters[key]
  return ruleSet([rule(ruleClass, parameters)])
}

function withRule(extra: JsonObject, ruleClass = 'quantity-limit'): JsonObject {
  return ruleSet([rule(ruleClass, CLASS_PARAMETERS[ruleClass]!, extra)])
}

function withFactSource(declaration: Json): JsonObject {
  return ruleSet([rule('quantity-limit', CLASS_PARAMETERS['quantity-limit']!)], { factSources: [declaration] })
}

const FACT_SOURCE = { fact: 'coverage.programme', from: 'coverage', path: "extension('https://example.invalid/programme').valueCoding.coding('https://example.invalid/programmes')" }
const PROVENANCE = {
  sources: [{ kind: 'fee-schedule', citation: 'Synthetic fee schedule, section 1', uri: 'https://example.invalid/schedule', codes: ['A100'] }],
  evidenceLevel: { system: 'https://example.invalid/evidence', code: 'high', display: 'High', version: '1' },
  note: 'Synthetic note.',
}

const accept = (name: string, value: unknown): RuleSetFixture => ({ name, ruleSet: value, expect: 'accept' })
const reject = (name: string, value: unknown): RuleSetFixture => ({ name, ruleSet: value, expect: 'reject' })
const decoderOnly = (name: string, key: string, value: unknown): RuleSetFixture => ({ name, ruleSet: value, expect: 'reject', decoderOnly: key })

const classFixtures: RuleSetFixture[] = Object.entries(CLASS_PARAMETERS).map(([ruleClass, parameters]) => accept(`valid ${ruleClass}`, ruleSet([rule(ruleClass, parameters)])))

const missingParameterFixtures: RuleSetFixture[] = Object.entries(CLASS_PARAMETERS).flatMap(([ruleClass, parameters]) =>
  Object.keys(parameters).filter((key) => !(ruleClass === 'bounded-multiplier' && key === 'maximum')).map((key) => reject(`${ruleClass} without required ${key}`, withParameters(ruleClass, {}, [key]))))

const thirtyThreeSteps = Array.from({ length: 33 }, () => 'item').join('.')
const thirtyTwoSteps = Array.from({ length: 32 }, () => 'item').join('.')

export const RULE_SET_FIXTURES: readonly RuleSetFixture[] = [
  ...classFixtures,
  ...missingParameterFixtures,

  // Rule-set members
  accept('empty rule list', ruleSet([])),
  accept('$schema reference in a rule-set file', ruleSet([], { $schema: 'https://fhir.cognovis.de/billing-core/schema/billing-rules/v2' })),
  accept('relative $schema reference', ruleSet([], { $schema: './node_modules/@cognovis/fhir-billing-rules/schema/billing-rule-set.schema.json' })),
  reject('blank $schema', ruleSet([], { $schema: ' ' })),
  reject('non-string $schema', ruleSet([], { $schema: 2 })),
  reject('array instead of a rule set', []),
  reject('string instead of a rule set', 'rules'),
  reject('null instead of a rule set', null),
  reject('rule set without rules', { schemaVersion: 2, semanticMajor: 4, id: 'synthetic' }),
  reject('rule set without id', { schemaVersion: 2, semanticMajor: 4, rules: [] }),
  reject('rule set without schemaVersion', { semanticMajor: 4, id: 'synthetic', rules: [] }),
  reject('rule set without semanticMajor', { schemaVersion: 2, id: 'synthetic', rules: [] }),
  reject('unknown rule-set member', ruleSet([], { name: 'synthetic' })),
  reject('blank rule-set id', ruleSet([], { id: '  ' })),
  reject('numeric rule-set id', ruleSet([], { id: 7 })),
  reject('rules as an object', ruleSet([], { rules: {} })),
  reject('schemaVersion 1', ruleSet([], { schemaVersion: 1 })),
  reject('semanticMajor 3', ruleSet([], { semanticMajor: 3 })),
  reject('semanticMajor as a string', ruleSet([], { semanticMajor: '4' })),

  // Rule members
  reject('rule that is not an object', ruleSet(['quantity-limit'])),
  reject('unknown rule member', withRule({ label: 'synthetic' })),
  reject('blank rule id', withRule({ id: ' ' })),
  reject('numeric rule id', withRule({ id: 1 })),
  reject('blank rule class', ruleSet([rule(' ', {})])),
  reject('numeric rule class', ruleSet([rule('x', {}, { class: 3 })])),
  reject('rule without class', ruleSet([{ id: 'r', mustUnderstand: true, effect: 'reject', priority: 1, parameters: {} }])),
  reject('rule without mustUnderstand', ruleSet([{ id: 'r', class: 'x', effect: 'reject', priority: 1, parameters: {} }])),
  reject('rule without effect', ruleSet([{ id: 'r', class: 'x', mustUnderstand: true, priority: 1, parameters: {} }])),
  reject('rule without priority', ruleSet([{ id: 'r', class: 'x', mustUnderstand: true, effect: 'reject', parameters: {} }])),
  reject('rule without parameters', ruleSet([{ id: 'r', class: 'x', mustUnderstand: true, effect: 'reject', priority: 1 }])),
  decoderOnly('duplicate rule ids', 'unique-rule-ids', ruleSet([rule('quantity-limit', CLASS_PARAMETERS['quantity-limit']!), rule('value-limit', CLASS_PARAMETERS['value-limit']!, { id: 'rule-quantity-limit' })])),
  reject('string mustUnderstand', withRule({ mustUnderstand: 'true' })),
  reject('fractional priority', withRule({ priority: 1.5 })),
  reject('priority beyond the safe integers', withRule({ priority: 9007199254740992 })),
  accept('negative priority', withRule({ priority: -9007199254740991 })),
  reject('unknown effect', withRule({ effect: 'warn' })),
  accept('needs-review effect', withRule({ effect: 'needs-review' })),
  accept('effective period', withRule({ effectiveStart: '2024-02-29', effectiveEnd: '2026-12-31' })),
  accept('leap day of a 400-year', withRule({ effectiveStart: '2000-02-29' })),
  reject('leap day of a common year', withRule({ effectiveStart: '2023-02-29' })),
  reject('leap day of a 100-year', withRule({ effectiveEnd: '1900-02-29' })),
  reject('date with time', withRule({ effectiveStart: '2026-01-01T00:00:00Z' })),
  reject('month 13', withRule({ effectiveEnd: '2026-13-01' })),
  reject('effectiveStart as an array', withRule({ effectiveStart: ['2026-01-01'] })),
  reject('numeric effectiveEnd', withRule({ effectiveEnd: 20260101 })),
  decoderOnly('effectiveStart after effectiveEnd', 'effective-period-order', withRule({ effectiveStart: '2026-02-01', effectiveEnd: '2026-01-31' })),
  reject('parameters as an array', ruleSet([rule('x', [])])),
  reject('parameters null', ruleSet([rule('quantity-limit', null)])),

  // A class Core does not know: any parameters, whatever mustUnderstand says
  accept('unknown class with mustUnderstand', ruleSet([rule('synthetic-jurisdiction-rule', { anything: [1, 'two'] })])),
  accept('unknown class without mustUnderstand', ruleSet([rule('synthetic-jurisdiction-rule', {}, { mustUnderstand: false })])),
  accept('unknown class whose requiredFacts the decoder does not read', ruleSet([rule('synthetic-jurisdiction-rule', {}, { requiredFacts: 3 })])),
  accept('unknown class named like an Object member', ruleSet([rule('toString', {})])),
  reject('unknown class with unknown rule member', ruleSet([rule('synthetic-jurisdiction-rule', {}, { extra: true })])),

  // Provenance
  accept('full provenance', withRule({ provenance: PROVENANCE })),
  accept('provenance on an unknown class', ruleSet([rule('synthetic-jurisdiction-rule', {}, { provenance: PROVENANCE })])),
  reject('provenance as a string', withRule({ provenance: 'statute' })),
  reject('unknown provenance member', withRule({ provenance: { ...PROVENANCE, author: 'x' } })),
  reject('provenance without sources', withRule({ provenance: { evidenceLevel: PROVENANCE.evidenceLevel } })),
  reject('provenance with empty sources', withRule({ provenance: { ...PROVENANCE, sources: [] } })),
  reject('provenance source that is not an object', withRule({ provenance: { ...PROVENANCE, sources: ['statute'] } })),
  reject('unknown provenance source member', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'x', page: 2 }] } })),
  reject('unknown provenance source kind', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'blog', citation: 'x' }] } })),
  reject('blank provenance citation', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: '\t' }] } })),
  reject('blank provenance uri', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'x', uri: ' ' }] } })),
  reject('empty provenance codes', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'x', codes: [] }] } })),
  reject('duplicate provenance codes', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'x', codes: ['A', 'A'] }] } })),
  reject('blank provenance code', withRule({ provenance: { ...PROVENANCE, sources: [{ kind: 'statute', citation: 'x', codes: [' '] }] } })),
  reject('provenance without evidenceLevel', withRule({ provenance: { sources: PROVENANCE.sources } })),
  reject('unknown evidenceLevel member', withRule({ provenance: { ...PROVENANCE, evidenceLevel: { system: 's', code: 'c', userSelected: true } } })),
  reject('evidenceLevel without system', withRule({ provenance: { ...PROVENANCE, evidenceLevel: { code: 'c' } } })),
  reject('blank evidenceLevel code', withRule({ provenance: { ...PROVENANCE, evidenceLevel: { system: 's', code: ' ' } } })),
  reject('blank evidenceLevel display', withRule({ provenance: { ...PROVENANCE, evidenceLevel: { system: 's', code: 'c', display: '' } } })),
  reject('blank evidenceLevel version', withRule({ provenance: { ...PROVENANCE, evidenceLevel: { system: 's', code: 'c', version: ' ' } } })),
  reject('blank provenance note', withRule({ provenance: { ...PROVENANCE, note: ' ' } })),

  // Shared semantics of the generic classes
  accept('requiredFacts', withRule({ requiredFacts: ['patient.age', 'coverage.programme'] })),
  reject('duplicate requiredFacts', withRule({ requiredFacts: ['patient.age', 'patient.age'] })),
  reject('empty requiredFacts', withRule({ requiredFacts: [] })),
  reject('blank requiredFact', withRule({ requiredFacts: [''] })),
  accept('shared parameters', withParameters('quantity-limit', { countingScope: { window: 'quarter', subject: 'patient' }, exceptWhen: { fact: 'coverage.programme', valueIn: ['x', 1, true, null] }, modifierExceptions: ['M1'] })),
  reject('countingScope without subject', withParameters('quantity-limit', { countingScope: { window: 'quarter' } })),
  reject('countingScope with empty window', withParameters('quantity-limit', { countingScope: { window: '', subject: 'patient' } })),
  reject('exceptWhen without values', withParameters('quantity-limit', { exceptWhen: { fact: 'x', valueIn: [] } })),
  reject('exceptWhen with an object value', withParameters('quantity-limit', { exceptWhen: { fact: 'x', valueIn: [{}] } })),
  reject('exceptWhen without fact', withParameters('quantity-limit', { exceptWhen: { valueIn: ['x'] } })),
  reject('duplicate modifierExceptions', withParameters('quantity-limit', { modifierExceptions: ['M1', 'M1'] })),
  accept('open class keeps an unknown parameter', withParameters('quantity-limit', { note: 'kept' })),

  // Selectors
  accept('selector of every code', withParameters('quantity-limit', { selector: { codes: ['*'] } })),
  accept('selector repeating a code', withParameters('quantity-limit', { selector: { codes: ['A100', 'A100'] } })),
  accept('selector with an unknown member', withParameters('quantity-limit', { selector: { codes: ['A100'], display: 'x' } })),
  reject('selector without codes', withParameters('quantity-limit', { selector: { system: SYNTHETIC_SYSTEM } })),
  reject('selector with empty codes', withParameters('quantity-limit', { selector: { codes: [] } })),
  reject('selector with an empty code', withParameters('quantity-limit', { selector: { codes: [''] } })),
  reject('selector with a numeric code', withParameters('quantity-limit', { selector: { codes: [100] } })),
  reject('selector with an empty system', withParameters('quantity-limit', { selector: { system: '', codes: ['A100'] } })),
  reject('selector mixing "*" with a code', withParameters('quantity-limit', { selector: { codes: ['*', 'A100'] } })),
  reject('selector as a list', withParameters('quantity-limit', { selector: ['A100'] })),
  reject('"*" in an excluded selector', withParameters('mutual-exclusion', { excluded: { codes: ['*'] } })),
  reject('"*" in a required selector', withParameters('companion-required', { required: { codes: ['*'] } })),
  reject('excluded selector without codes', withParameters('mutual-exclusion', { excluded: {} })),

  // quantity-limit and value-limit
  accept('quantity-limit maximum zero', withParameters('quantity-limit', { maximum: 0 })),
  reject('negative quantity-limit maximum', withParameters('quantity-limit', { maximum: -1 })),
  reject('quantity-limit maximum as a string', withParameters('quantity-limit', { maximum: '1' })),
  accept('value-limit integer maximum', withParameters('value-limit', { maximum: '120' })),
  reject('value-limit maximum with three fraction digits', withParameters('value-limit', { maximum: '1.005' })),
  reject('value-limit maximum as a number', withParameters('value-limit', { maximum: 120 })),
  reject('negative value-limit maximum', withParameters('value-limit', { maximum: '-1' })),

  // bounded-multiplier
  accept('bounded-multiplier without maximum', withParameters('bounded-multiplier', {}, ['maximum'])),
  accept('bounded-multiplier threshold semantics', withParameters('bounded-multiplier', { standardThreshold: 2.3, aboveThresholdEffect: 'needs-review', justificationWaivesThreshold: true, agreementOverride: { fact: 'agreement', valueIn: [true] } })),
  reject('bounded-multiplier minimum as a string', withParameters('bounded-multiplier', { minimum: '1' })),
  reject('bounded-multiplier maximum as a string', withParameters('bounded-multiplier', { maximum: '3' })),
  decoderOnly('bounded-multiplier minimum above maximum', 'bounded-multiplier-order', withParameters('bounded-multiplier', { minimum: 4 })),
  decoderOnly('bounded-multiplier threshold above maximum', 'bounded-multiplier-order', withParameters('bounded-multiplier', { standardThreshold: 4, aboveThresholdEffect: 'reject' })),
  decoderOnly('bounded-multiplier threshold below minimum', 'bounded-multiplier-order', withParameters('bounded-multiplier', { standardThreshold: 0.5, aboveThresholdEffect: 'reject' })),
  reject('bounded-multiplier threshold as a string', withParameters('bounded-multiplier', { standardThreshold: '2', aboveThresholdEffect: 'reject' })),
  reject('bounded-multiplier threshold without effect', withParameters('bounded-multiplier', { standardThreshold: 2 })),
  reject('bounded-multiplier unknown threshold effect', withParameters('bounded-multiplier', { standardThreshold: 2, aboveThresholdEffect: 'warn' })),
  reject('bounded-multiplier string justificationWaivesThreshold', withParameters('bounded-multiplier', { standardThreshold: 2, aboveThresholdEffect: 'reject', justificationWaivesThreshold: 'yes' })),
  reject('bounded-multiplier threshold effect without threshold', withParameters('bounded-multiplier', { aboveThresholdEffect: 'reject' })),
  reject('bounded-multiplier agreementOverride without threshold', withParameters('bounded-multiplier', { agreementOverride: { fact: 'agreement', valueIn: [true] } })),
  reject('bounded-multiplier justification without threshold', withParameters('bounded-multiplier', { justificationWaivesThreshold: true })),
  reject('bounded-multiplier agreementOverride without values', withParameters('bounded-multiplier', { standardThreshold: 2, aboveThresholdEffect: 'reject', agreementOverride: { fact: 'agreement', valueIn: [] } })),

  // accompanying-information-required
  accept('accompanying information alternation', withParameters('accompanying-information-required', { information: { kind: 'site', fact: 'claim.site', valueIn: ['left', 'right'] } })),
  reject('accompanying information top-level fact', withParameters('accompanying-information-required', { fact: 'claim.justification' })),
  reject('accompanying information as a string', withParameters('accompanying-information-required', { information: 'justification' })),
  reject('unknown accompanying information member', withParameters('accompanying-information-required', { information: { kind: 'k', fact: 'f', label: 'x' } })),
  reject('empty accompanying information kind', withParameters('accompanying-information-required', { information: { kind: '', fact: 'f' } })),
  reject('accompanying information without fact', withParameters('accompanying-information-required', { information: { kind: 'k' } })),
  reject('duplicate accompanying information values', withParameters('accompanying-information-required', { information: { kind: 'k', fact: 'f', valueIn: ['a', 'a'] } })),
  reject('unknown accompanying information parameter', withParameters('accompanying-information-required', { note: 'x' })),

  // patient-attribute-constraint
  accept('patient attribute value alternation', withParameters('patient-attribute-constraint', { attribute: 'patient.gender', predicate: { valueIn: ['female', null, 1, false] } })),
  accept('patient attribute upper bound only', withParameters('patient-attribute-constraint', { predicate: { maximum: 6, unit: 'mo' } })),
  reject('empty patient attribute', withParameters('patient-attribute-constraint', { attribute: '' })),
  reject('patient attribute predicate as a list', withParameters('patient-attribute-constraint', { predicate: ['female'] })),
  reject('patient attribute predicate equals', withParameters('patient-attribute-constraint', { predicate: { equals: 'female' } })),
  reject('unknown patient attribute predicate member', withParameters('patient-attribute-constraint', { predicate: { minimum: 1, unit: 'a', inclusive: true } })),
  reject('patient attribute valueIn with a bound', withParameters('patient-attribute-constraint', { predicate: { valueIn: [1], minimum: 1 } })),
  reject('patient attribute valueIn with a unit', withParameters('patient-attribute-constraint', { predicate: { valueIn: [1], unit: 'a' } })),
  reject('patient attribute empty valueIn', withParameters('patient-attribute-constraint', { predicate: { valueIn: [] } })),
  reject('patient attribute object value', withParameters('patient-attribute-constraint', { predicate: { valueIn: [{ code: 'x' }] } })),
  reject('patient attribute minimum as a string', withParameters('patient-attribute-constraint', { predicate: { minimum: '18', unit: 'a' } })),
  reject('patient attribute maximum as a string', withParameters('patient-attribute-constraint', { predicate: { maximum: '18', unit: 'a' } })),
  decoderOnly('patient attribute minimum above maximum', 'patient-attribute-bounds-order', withParameters('patient-attribute-constraint', { predicate: { minimum: 18, maximum: 6, unit: 'a' } })),
  reject('patient attribute bound without unit', withParameters('patient-attribute-constraint', { predicate: { minimum: 18 } })),
  reject('patient attribute bound with an empty unit', withParameters('patient-attribute-constraint', { predicate: { minimum: 18, unit: '' } })),
  reject('patient attribute unit only', withParameters('patient-attribute-constraint', { predicate: { unit: 'a' } })),
  reject('empty patient attribute predicate', withParameters('patient-attribute-constraint', { predicate: {} })),
  reject('unknown patient attribute parameter', withParameters('patient-attribute-constraint', { label: 'x' })),

  // contract-participation and contract-code-list
  reject('empty contract', withParameters('contract-participation', { contract: '' })),
  reject('numeric contract', withParameters('contract-participation', { contract: 1 })),
  reject('contract code list permitting "*"', withParameters('contract-code-list', { permitted: { codes: ['*'] } })),
  reject('unknown contract code list member', withParameters('contract-code-list', { permitted: { codes: ['A100'], display: 'x' } })),
  reject('contract code list with a counting scope', withParameters('contract-code-list', { countingScope: { window: 'quarter', subject: 'patient' } })),
  reject('contract code list with modifierExceptions', withParameters('contract-code-list', { modifierExceptions: ['M1'] })),
  reject('contract code list outside a rule set', { schemaVersion: 2, semanticMajor: 4, id: 'synthetic', rules: [rule('contract-code-list', CLASS_PARAMETERS['contract-code-list']!)] }),
  reject('contract code list in an overlay rule set', { schemaVersion: 2, semanticMajor: 4, id: 'synthetic', appliesTo: { catalogEditions: [EDITION] }, rules: [rule('contract-code-list', CLASS_PARAMETERS['contract-code-list']!)] }),
  reject('contract code list with effectiveStart', withRule({ effectiveStart: '2026-01-01' }, 'contract-code-list')),
  reject('contract code list with effectiveEnd', withRule({ effectiveEnd: '2026-12-31' }, 'contract-code-list')),

  // setting-constraint
  reject('empty setting', withParameters('setting-constraint', { setting: '' })),
  reject('setting predicate as a string', withParameters('setting-constraint', { predicate: 'AMB' })),
  reject('unknown setting predicate member', withParameters('setting-constraint', { predicate: { polarity: 'include', valueIn: ['AMB'], system: 's' } })),
  reject('unknown setting polarity', withParameters('setting-constraint', { predicate: { polarity: 'only', valueIn: ['AMB'] } })),
  reject('setting predicate without polarity', withParameters('setting-constraint', { predicate: { valueIn: ['AMB'] } })),
  reject('setting predicate without values', withParameters('setting-constraint', { predicate: { polarity: 'exclude' } })),

  // prior-authorization-required
  reject('empty authorization', withParameters('prior-authorization-required', { authorization: '' })),
  reject('grant without fact', withParameters('prior-authorization-required', { grant: { valueIn: ['granted'] } })),
  reject('unknown grant member', withParameters('prior-authorization-required', { grant: { fact: 'f', valueIn: ['granted'], system: 's' } })),
  reject('grant without values', withParameters('prior-authorization-required', { grant: { fact: 'f', valueIn: [] } })),

  // procedure-finding-requirement and diagnosis-requirement
  accept('coded members with qualifiers', withParameters('procedure-finding-requirement', { procedure: { fact: 'procedure.findings', system: 'https://example.invalid/findings', polarity: 'include', valueIn: ['F1', { code: 'F2', qualifiers: { site: ['left', 'right'] } }, { code: 'F3' }] } })),
  reject('procedure as a string', withParameters('procedure-finding-requirement', { procedure: 'F1' })),
  reject('empty procedure fact', withParameters('procedure-finding-requirement', { procedure: { fact: '', polarity: 'include', valueIn: ['F1'] } })),
  reject('empty procedure system', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', system: '', polarity: 'include', valueIn: ['F1'] } })),
  reject('procedure without polarity', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', valueIn: ['F1'] } })),
  reject('procedure predicate-level qualifiers', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: ['F1'], qualifiers: { site: ['left'] } } })),
  reject('unknown procedure member', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: ['F1'], display: 'x' } })),
  reject('empty procedure valueIn', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [] } })),
  reject('duplicate procedure codes', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: ['F1', 'F1'] } })),
  decoderOnly('procedure code given as a string and as an object', 'unique-coded-codes', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: ['F1', { code: 'F1' }] } })),
  decoderOnly('procedure code given twice with different qualifiers', 'unique-coded-codes', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', qualifiers: { site: ['left'] } }, { code: 'F1', qualifiers: { site: ['right'] } }] } })),
  reject('empty procedure code', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [''] } })),
  reject('numeric procedure member', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [1] } })),
  reject('procedure member without code', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ qualifiers: {} }] } })),
  reject('unknown procedure member key', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', display: 'x' }] } })),
  reject('procedure qualifier with an empty name', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', qualifiers: { '': ['x'] } }] } })),
  reject('procedure qualifier that is not a list', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', qualifiers: { site: 'left' } }] } })),
  reject('procedure qualifier with no values', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', qualifiers: { site: [] } }] } })),
  reject('procedure qualifiers as a list', withParameters('procedure-finding-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: [{ code: 'F1', qualifiers: ['left'] }] } })),
  reject('unknown diagnosis polarity', withParameters('diagnosis-requirement', { diagnosis: { fact: 'diagnoses', polarity: 'any', valueIn: ['D1'] } })),
  reject('unknown diagnosis-requirement parameter', withParameters('diagnosis-requirement', { procedure: { fact: 'f', polarity: 'include', valueIn: ['F1'] } })),

  // provider-eligibility
  accept('provider qualification members', withParameters('provider-eligibility', { provider: { fact: 'provider.qualifications', polarity: 'exclude', qualifications: [{ group: 'surgery', members: ['hand', 'foot'] }, { group: 'radiology' }] } })),
  reject('provider as a list', withParameters('provider-eligibility', { provider: [] })),
  reject('empty provider fact', withParameters('provider-eligibility', { provider: { fact: '', polarity: 'include', qualifications: [{ group: 'g' }] } })),
  reject('unknown provider polarity', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'all', qualifications: [{ group: 'g' }] } })),
  reject('unknown provider member', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: [{ group: 'g' }], system: 's' } })),
  reject('empty provider qualifications', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: [] } })),
  reject('provider qualification as a string', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: ['g'] } })),
  reject('empty provider qualification group', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: [{ group: '' }] } })),
  reject('unknown provider qualification member', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: [{ group: 'g', display: 'x' }] } })),
  reject('duplicate provider qualification members', withParameters('provider-eligibility', { provider: { fact: 'f', polarity: 'include', qualifications: [{ group: 'g', members: ['m', 'm'] }] } })),

  // quota-degression
  accept('quota degression with unstated parameters and scope axes', withParameters('quota-degression', { threshold: { stated: false }, adjustment: { stated: false }, scopeAxes: { insurer: ['statutory', 'private'] } })),
  reject('quota threshold as a number', withParameters('quota-degression', { threshold: 10 })),
  reject('quota threshold without stated', withParameters('quota-degression', { threshold: { quantity: 10 } })),
  reject('quota threshold with a string stated', withParameters('quota-degression', { threshold: { stated: 'true', quantity: 10 } })),
  reject('unknown quota threshold member', withParameters('quota-degression', { threshold: { stated: true, quantity: 10, unit: '1' } })),
  reject('stated quota threshold without quantity', withParameters('quota-degression', { threshold: { stated: true } })),
  reject('negative quota threshold', withParameters('quota-degression', { threshold: { stated: true, quantity: -1 } })),
  reject('unstated quota threshold with quantity', withParameters('quota-degression', { threshold: { stated: false, quantity: 10 } })),
  reject('quota factor with five fraction digits', withParameters('quota-degression', { adjustment: { stated: true, factor: '0.12345' } })),
  reject('quota factor as a number', withParameters('quota-degression', { adjustment: { stated: true, factor: 0.75 } })),
  reject('unstated quota adjustment with factor', withParameters('quota-degression', { adjustment: { stated: false, factor: '0.75' } })),
  reject('quota scope axis without values', withParameters('quota-degression', { scopeAxes: { insurer: [] } })),
  reject('quota scope axes as a list', withParameters('quota-degression', { scopeAxes: ['insurer'] })),
  reject('unknown quota parameter', withParameters('quota-degression', { window: 'year' })),

  // minimum-evidence-count
  accept('evidence sources with maximum credit', withParameters('minimum-evidence-count', { sources: [{ fact: 'evidence.visits', credit: 1, maximumCredit: 3 }, { fact: 'evidence.reports', credit: 2 }] })),
  reject('evidence minimum zero', withParameters('minimum-evidence-count', { minimum: 0 })),
  reject('fractional evidence minimum', withParameters('minimum-evidence-count', { minimum: 1.5 })),
  reject('evidence minimum beyond the safe integers', withParameters('minimum-evidence-count', { minimum: 9007199254740992 })),
  reject('empty evidence sources', withParameters('minimum-evidence-count', { sources: [] })),
  reject('evidence source as a string', withParameters('minimum-evidence-count', { sources: ['evidence.visits'] })),
  reject('unknown evidence source member', withParameters('minimum-evidence-count', { sources: [{ fact: 'f', credit: 1, weight: 2 }] })),
  reject('empty evidence source fact', withParameters('minimum-evidence-count', { sources: [{ fact: '', credit: 1 }] })),
  decoderOnly('duplicate evidence source facts', 'unique-evidence-source-facts', withParameters('minimum-evidence-count', { sources: [{ fact: 'f', credit: 1 }, { fact: 'f', credit: 2 }] })),
  reject('evidence credit zero', withParameters('minimum-evidence-count', { sources: [{ fact: 'f', credit: 0 }] })),
  reject('evidence maximumCredit zero', withParameters('minimum-evidence-count', { sources: [{ fact: 'f', credit: 1, maximumCredit: 0 }] })),

  // Fact-source declarations
  accept('fact source', withFactSource(FACT_SOURCE)),
  accept('fact source of known absence', withFactSource({ fact: 'patient.flag', from: 'patient', path: 'extension(\'https://example.invalid/flag\')', valueAs: 'boolean-present', absent: 'known-absent' })),
  accept('fact source per billed code', withFactSource({ fact: 'encounter.covered', from: 'encounter', path: "type.coding('https://example.invalid/types')", perBilledCode: { system: SYNTHETIC_SYSTEM } })),
  accept('fact source of a group member', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member', groupPath: "code.coding('https://example.invalid/groups')" })),
  accept('fact source path of 32 steps', withFactSource({ ...FACT_SOURCE, path: thirtyTwoSteps })),
  accept('fact source path whose url holds dots and parentheses', withFactSource({ ...FACT_SOURCE, path: "extension('https://example.invalid/a.b(c)').value" })),
  accept('fact source path with an element named like a reserved prefix', withFactSource({ ...FACT_SOURCE, path: 'codingSystem.extensionValue' })),
  reject('fact sources as an object', ruleSet([], { factSources: FACT_SOURCE })),
  reject('empty fact sources', ruleSet([], { factSources: [] })),
  reject('fact source as a string', withFactSource('coverage.programme')),
  reject('unknown fact source member', withFactSource({ ...FACT_SOURCE, system: 's' })),
  reject('fact source name with a bar', withFactSource({ ...FACT_SOURCE, fact: 'system|code' })),
  reject('fact source name starting with a digit', withFactSource({ ...FACT_SOURCE, fact: '1fact' })),
  reject('fact source name with an empty word', withFactSource({ ...FACT_SOURCE, fact: 'coverage..programme' })),
  reject('fact source declaring a native fact', withFactSource({ ...FACT_SOURCE, fact: 'patient.age' })),
  decoderOnly('fact source declared twice', 'unique-fact-source-facts', ruleSet([], { factSources: [FACT_SOURCE, { ...FACT_SOURCE, from: 'account' }] })),
  reject('unknown fact source origin', withFactSource({ ...FACT_SOURCE, from: 'claim' })),
  reject('fact source without path', withFactSource({ fact: 'coverage.programme', from: 'coverage' })),
  reject('fact source path as a number', withFactSource({ ...FACT_SOURCE, path: 7 })),
  reject('empty fact source path', withFactSource({ ...FACT_SOURCE, path: '' })),
  reject('fact source path with an empty step', withFactSource({ ...FACT_SOURCE, path: 'type..coding' })),
  reject('fact source path with a trailing dot', withFactSource({ ...FACT_SOURCE, path: 'type.' })),
  reject('fact source path using coding as an element', withFactSource({ ...FACT_SOURCE, path: 'type.coding' })),
  reject('fact source path using extension as an element', withFactSource({ ...FACT_SOURCE, path: 'extension.value' })),
  reject('fact source path using an Object member name', withFactSource({ ...FACT_SOURCE, path: 'constructor.prototype' })),
  reject('fact source path using toString', withFactSource({ ...FACT_SOURCE, path: 'type.toString' })),
  reject('fact source path with an upper-case element', withFactSource({ ...FACT_SOURCE, path: 'Type' })),
  reject('fact source path starting with coding', withFactSource({ ...FACT_SOURCE, path: "coding('https://example.invalid/types')" })),
  reject('fact source path with coding in the middle', withFactSource({ ...FACT_SOURCE, path: "type.coding('https://example.invalid/types').code" })),
  reject('fact source path with an unterminated quote', withFactSource({ ...FACT_SOURCE, path: "extension('https://example.invalid" })),
  reject('fact source path with an empty argument', withFactSource({ ...FACT_SOURCE, path: "extension('')" })),
  reject('fact source path with an unknown function', withFactSource({ ...FACT_SOURCE, path: "where('x')" })),
  reject('fact source path with text after a function', withFactSource({ ...FACT_SOURCE, path: "extension('u')x" })),
  reject('fact source path of 33 steps', withFactSource({ ...FACT_SOURCE, path: thirtyThreeSteps })),
  reject('unknown fact source valueAs', withFactSource({ ...FACT_SOURCE, valueAs: 'string' })),
  reject('unknown fact source absent', withFactSource({ ...FACT_SOURCE, absent: 'unknown' })),
  reject('per billed code as a string', withFactSource({ ...FACT_SOURCE, perBilledCode: SYNTHETIC_SYSTEM })),
  reject('unknown per billed code member', withFactSource({ ...FACT_SOURCE, perBilledCode: { code: 'x' } })),
  reject('per billed code with an empty system', withFactSource({ ...FACT_SOURCE, perBilledCode: { system: '' } })),
  reject('per billed code with valueAs', withFactSource({ ...FACT_SOURCE, perBilledCode: {}, valueAs: 'code' })),
  reject('per billed code on a path without coding', withFactSource({ ...FACT_SOURCE, path: 'type.text', perBilledCode: {} })),
  reject('group member from the patient', withFactSource({ fact: 'provider.pairing', from: 'patient', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member', groupPath: "code.coding('https://example.invalid/groups')" })),
  reject('group member without groupPath', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member' })),
  reject('group member with absent', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member', groupPath: "code.coding('https://example.invalid/groups')", absent: 'known-absent' })),
  reject('group member on a path without coding', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: 'specialty.text', valueAs: 'group-member', groupPath: "code.coding('https://example.invalid/groups')" })),
  reject('group member whose groupPath ends without coding', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member', groupPath: 'code.text' })),
  reject('group member with an invalid groupPath', withFactSource({ fact: 'provider.pairing', from: 'performer-role', path: "specialty.coding('https://example.invalid/members')", valueAs: 'group-member', groupPath: 'code..text' })),
  reject('groupPath without group member', withFactSource({ ...FACT_SOURCE, groupPath: "code.coding('https://example.invalid/groups')" })),

  // Rule-set binding
  accept('contract rule set', ruleSet([], { appliesTo: { contracts: [CONTRACT, 'https://example.invalid/Contract/other'] } })),
  accept('overlay rule set', ruleSet([], { appliesTo: { catalogEditions: [EDITION] } })),
  reject('appliesTo as a list', ruleSet([], { appliesTo: [CONTRACT] })),
  reject('unknown appliesTo member', ruleSet([], { appliesTo: { contracts: [CONTRACT], tenants: ['t'] } })),
  reject('appliesTo naming contracts and editions', ruleSet([], { appliesTo: { contracts: [CONTRACT], catalogEditions: [EDITION] } })),
  reject('empty appliesTo', ruleSet([], { appliesTo: {} })),
  reject('appliesTo with no contracts', ruleSet([], { appliesTo: { contracts: [] } })),
  reject('appliesTo contracts null', ruleSet([], { appliesTo: { contracts: null } })),
  reject('appliesTo with a relative canonical', ruleSet([], { appliesTo: { contracts: ['Contract/synthetic'] } })),
  reject('appliesTo canonical with whitespace', ruleSet([], { appliesTo: { catalogEditions: ['https://example.invalid/a b'] } })),
  reject('appliesTo canonical with two versions', ruleSet([], { appliesTo: { contracts: ['https://example.invalid/c|1|2'] } })),
  reject('appliesTo canonical with an empty version', ruleSet([], { appliesTo: { contracts: ['https://example.invalid/c|'] } })),
  reject('duplicate appliesTo canonicals', ruleSet([], { appliesTo: { contracts: [CONTRACT, CONTRACT] } })),
  reject('numeric appliesTo canonical', ruleSet([], { appliesTo: { contracts: [1] } })),
]
