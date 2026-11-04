import { createHash } from 'node:crypto'
import {
  BILLING_RULE_PAYLOAD_SCHEMA_VERSION,
  BILLING_RULE_SOURCE_KINDS,
  BILLING_RULE_SEMANTIC_MAJOR,
  type AdmissionState,
  type BillingReason,
  type BillingCountingScope,
  type BillingFactSourceDeclaration,
  type BillingRuleException,
  type BillingRulePayloadV2,
  type BillingRule,
  type BillingRuleSet,
  type BillingRuleSetAppliesTo,
  type GenericRuleClass,
} from '@cognovis/fhir-billing-types'
import { BILLING_FACT_SOURCE_ORIGINS, BILLING_NATIVE_FACT_NAMES } from '@cognovis/fhir-billing-types'
import { BILLING_RULE_KEYS } from './rule-keys.js'

export {
  billingCatalogDefinitionDigest,
  billingCatalogEditionDigest,
  billingCatalogMemberSetDigest,
  billingCatalogSourceSetDigest,
  billingConfiguredRuleMembersDigest,
  buildBillingLibrary,
  decodeBillingLibrary,
  decodeBillingRuleSet,
  type BillingCatalogDefinitionCode,
  type BillingCatalogEditionLibraryInput,
  type BillingCatalogEditionMemberLink,
  type BillingLibraryResourceLink,
  type BillingConfiguredRuleLibraryInput,
  type BillingContactDetail,
  type BillingContactPoint,
  type BillingLibraryKind,
  type BillingLibraryPeriod,
  type BillingLibraryRelatedArtifact,
  type BillingLibraryResource,
  type BillingRuleSetLibraryInput,
  type BuildBillingLibraryInput,
  type DecodedBillingLibrary,
  type DecodedBillingRuleSetLibrary,
} from './carrier.js'
export {
  billingAdmittedConfiguredRulesDigest,
  billingAdmittedConfiguredRulesUnion,
  decodeBillingAdmission,
  encodeBillingAdmission,
  type BillingAdmissionInput,
  type BillingAdmittedConfiguredRulesShard,
  type DecodedBillingAdmission,
  type DecodedBillingAdmissionRecord,
  type DecodedBillingAdmittedConfiguredRules,
  type EncodedBillingAdmission,
} from './admission.js'

export const CORE_CANONICAL = 'https://fhir.cognovis.de/billing-core' as const
export const BILLING_RULE_PAYLOAD_SCHEMA_URI = `${CORE_CANONICAL}/schema/billing-rules/v2` as const
export const BILLING_RULE_CLASS_SYSTEM = `${CORE_CANONICAL}/CodeSystem/billing-rule-class` as const
export const BILLING_RULE_REASON_SYSTEM = `${CORE_CANONICAL}/CodeSystem/billing-reason` as const
export const BILLING_RULE_SET_ID_SYSTEM = `${CORE_CANONICAL}/sid/billing-rule-set` as const

export interface RuleClassDefinition {
  readonly requiredParameters: readonly string[]
  readonly description: string
}

export const BILLING_RULE_CLASS_DEFINITIONS: Readonly<Record<GenericRuleClass, RuleClassDefinition>> = {
  'quantity-limit': { requiredParameters: ['maximum', 'selector'], description: 'Reject quantities above a configured maximum.' },
  'value-limit': { requiredParameters: ['maximum', 'selector'], description: 'Flag pre-multiplier unit-price times quantity above a configured maximum.' },
  'mutual-exclusion': { requiredParameters: ['selector', 'excluded'], description: 'Reject mutually exclusive codes.' },
  'companion-required': { requiredParameters: ['selector', 'required'], description: 'Require a configured companion code.' },
  'bounded-multiplier': { requiredParameters: ['selector', 'minimum'], description: 'Constrain a line multiplier to an inclusive lower bound and an optional inclusive upper bound.' },
  'accompanying-information-required': { requiredParameters: ['selector', 'information'], description: 'Require named accompanying information, optionally drawn from an admissible value alternation.' },
  'patient-attribute-constraint': { requiredParameters: ['selector', 'attribute', 'predicate'], description: 'Constrain a typed patient attribute by value alternation or by unit-bearing numeric bounds.' },
  'contract-participation': { requiredParameters: ['selector', 'contract'], description: 'Require participation in a configured contract.' },
  'contract-code-list': { requiredParameters: ['selector', 'permitted'], description: 'Reject a line whose code the selected contract does not permit.' },
  'setting-constraint': { requiredParameters: ['selector', 'setting', 'predicate'], description: 'Permit or forbid a service in the billing settings carried by a named case fact.' },
  'prior-authorization-required': { requiredParameters: ['selector', 'authorization', 'grant'], description: 'Require an on-file grant from a named authorization programme.' },
  'procedure-finding-requirement': { requiredParameters: ['selector', 'procedure'], description: 'Require or forbid documented procedure findings drawn from a coded alternation.' },
  'diagnosis-requirement': { requiredParameters: ['selector', 'diagnosis'], description: 'Require or forbid documented diagnoses drawn from a coded alternation.' },
  'provider-eligibility': { requiredParameters: ['selector', 'provider'], description: 'Require or forbid a provider qualification group or one of its declared members.' },
  'quota-degression': { requiredParameters: ['selector', 'threshold', 'adjustment'], description: 'Apply a stated volume adjustment above a stated quantity threshold, and flag either parameter when the source leaves it unstated.' },
  'minimum-evidence-count': { requiredParameters: ['selector', 'minimum', 'sources'], description: 'Require a minimum total from named numeric evidence sources with individually bounded contributions.' },
}

export const BILLING_INTERPRETABLE_UNITS = {
  a: { dimension: 'calendar-month', factor: 12 },
  mo: { dimension: 'calendar-month', factor: 1 },
  wk: { dimension: 'elapsed-second', factor: 604800 },
  d: { dimension: 'elapsed-second', factor: 86400 },
  h: { dimension: 'elapsed-second', factor: 3600 },
  min: { dimension: 'elapsed-second', factor: 60 },
  s: { dimension: 'elapsed-second', factor: 1 },
  '1': { dimension: 'count', factor: 1 },
} as const

export type BillingInterpretableUnit = keyof typeof BILLING_INTERPRETABLE_UNITS

function interpretableUnit(unit: string): { readonly dimension: string; readonly factor: number } | undefined {
  return Object.hasOwn(BILLING_INTERPRETABLE_UNITS, unit) ? BILLING_INTERPRETABLE_UNITS[unit as BillingInterpretableUnit] : undefined
}

/** Exact decimal magnitude of a number, refusing exponential notation so no operand is silently rounded. */
function scaledDecimal(value: number): { digits: bigint; scale: number } | undefined {
  if (!Number.isFinite(value)) return undefined
  const text = String(value)
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const digits = BigInt(`${whole}${fraction}`)
  return { digits: negative ? -digits : digits, scale: fraction.length }
}

export function compareUnitBearingValues(left: { value: number; unit: string }, right: { value: number; unit: string }): -1 | 0 | 1 | 'uninterpretable' {
  const leftUnit = interpretableUnit(left.unit)
  const rightUnit = interpretableUnit(right.unit)
  if (leftUnit === undefined || rightUnit === undefined || leftUnit.dimension !== rightUnit.dimension) return 'uninterpretable'
  const leftDecimal = scaledDecimal(left.value)
  const rightDecimal = scaledDecimal(right.value)
  if (leftDecimal === undefined || rightDecimal === undefined) return 'uninterpretable'
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale)
  const leftBase = leftDecimal.digits * BigInt(leftUnit.factor) * 10n ** BigInt(scale - leftDecimal.scale)
  const rightBase = rightDecimal.digits * BigInt(rightUnit.factor) * 10n ** BigInt(scale - rightDecimal.scale)
  return leftBase < rightBase ? -1 : leftBase > rightBase ? 1 : 0
}

export type BillingRuleAdmissionReason = BillingReason['code']
export type BillingRuleAdmission =
  | { status: 'admitted'; reasons: readonly [] }
  | { status: 'needs-review'; reasons: readonly BillingReason[] }

/**
 * Why a `BillingInputError` was raised, where a caller needs to tell causes apart: a digest that does
 * not match its content or is not a valid digest, a catalog edition still carrying a scheme-1
 * member-set digest (to re-import and re-admit), an unsupported payload schema version or semantic
 * major, a modifier extension or implicit rules the carrier schema does not support, or a duplicate.
 * Errors without a cause carry no discriminant; the message is diagnostics only and never a contract.
 */
export type BillingInputErrorCause =
  | 'digest-mismatch'
  | 'digest-scheme-v1'
  | 'digest-invalid'
  | 'schema-version'
  | 'semantic-major'
  | 'modifier-extension'
  | 'implicit-rules'
  | 'duplicate'

export class BillingInputError extends TypeError {
  readonly code = 'BILLING_INPUT_INVALID'
  declare readonly cause?: BillingInputErrorCause

  constructor(message: string, options?: { readonly cause?: BillingInputErrorCause }) {
    super(message, options)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Selector codes match literally; only the primary selector admits "*", and only as its sole code, to select every code within the optional system. */
function assertSelector(value: unknown, label: string, admitsEveryCode = false): void {
  if (!isRecord(value) || !Array.isArray(value.codes) || value.codes.length === 0 || value.codes.some((code) => typeof code !== 'string' || !code)) {
    throw new BillingInputError(`${label} must contain at least one non-empty code.`)
  }
  if (value.system !== undefined && (typeof value.system !== 'string' || !value.system)) throw new BillingInputError(`${label} system must be non-empty.`)
  if (!admitsEveryCode && value.codes.includes('*')) throw new BillingInputError(`${label} cannot contain "*"; it matches codes literally.`)
  if (value.codes.includes('*') && value.codes.length > 1) throw new BillingInputError(`${label} must list "*" as its only code or not at all.`)
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new BillingInputError(`${label} must be a finite number.`)
  return value
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new BillingInputError(`${label} must be a positive safe integer.`)
}

function assertStringList(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item) || new Set(value).size !== value.length) {
    throw new BillingInputError(`${label} must contain unique non-empty strings.`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value) throw new BillingInputError(`${label} must be non-empty.`)
}

function assertPolarity(value: unknown, label: string): asserts value is 'include' | 'exclude' {
  if (value !== 'include' && value !== 'exclude') throw new BillingInputError(`${label} polarity must be include or exclude.`)
}

function assertPrimitiveList(value: unknown, label: string): asserts value is readonly (string | number | boolean | null)[] {
  if (!Array.isArray(value) || value.length === 0) throw new BillingInputError(`${label} must declare at least one value.`)
  if (value.some((item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) throw new BillingInputError(`${label} values must be JSON primitives.`)
}

/**
 * Parameter objects introduced or reshaped at semantic major 3 are strictly shaped: a property the
 * contract does not declare is refused rather than ignored, so a constraint that survives in the
 * payload can never be dropped semantically. Qualifier maps and scope axes stay open key spaces
 * because the projection names their axes.
 */
function assertOnlyKeys(value: object, permitted: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !permitted.includes(key))
  if (unknown !== undefined) throw new BillingInputError(`${label} does not accept key ${unknown}.`)
}

function assertAlternationMap(value: unknown, label: string): void {
  if (!isRecord(value)) throw new BillingInputError(`${label} must be an object.`)
  for (const [key, alternation] of Object.entries(value)) {
    if (!key) throw new BillingInputError(`${label} names must be non-empty.`)
    assertPrimitiveList(alternation, `${label} ${key}`)
  }
}

/**
 * Admissible coded members carry their own qualifier alternation, so a source that admits one code
 * only with one qualifier combination and another code only with a different one stays correlated.
 */
function assertCodedPredicate(value: unknown, label: string): void {
  if (!isRecord(value)) throw new BillingInputError(`${label} must be an object.`)
  assertNonEmptyString(value.fact, `${label} fact`)
  if (value.system !== undefined) assertNonEmptyString(value.system, `${label} system`)
  assertPolarity(value.polarity, label)
  if (value.qualifiers !== undefined) throw new BillingInputError(`${label} qualifiers is replaced by per-member valueIn[].qualifiers.`)
  assertOnlyKeys(value, ['fact', 'system', 'polarity', 'valueIn'], label)
  if (!Array.isArray(value.valueIn) || value.valueIn.length === 0) throw new BillingInputError(`${label} valueIn must declare at least one admissible code.`)
  const codes = new Set<string>()
  for (const member of value.valueIn) {
    if (typeof member === 'string') {
      assertNonEmptyString(member, `${label} valueIn code`)
      if (codes.has(member)) throw new BillingInputError(`${label} valueIn codes must be unique.`)
      codes.add(member)
      continue
    }
    if (!isRecord(member)) throw new BillingInputError(`${label} valueIn members must be codes or objects.`)
    assertNonEmptyString(member.code, `${label} valueIn code`)
    if (codes.has(member.code)) throw new BillingInputError(`${label} valueIn codes must be unique.`)
    codes.add(member.code)
    assertOnlyKeys(member, ['code', 'qualifiers'], `${label} valueIn ${member.code}`)
    if (member.qualifiers !== undefined) assertAlternationMap(member.qualifiers, `${label} valueIn ${member.code} qualifier`)
  }
}

function assertProviderPredicate(value: unknown, label: string): void {
  if (!isRecord(value)) throw new BillingInputError(`${label} must be an object.`)
  assertNonEmptyString(value.fact, `${label} fact`)
  assertPolarity(value.polarity, label)
  assertOnlyKeys(value, ['fact', 'polarity', 'qualifications'], label)
  if (!Array.isArray(value.qualifications) || value.qualifications.length === 0) throw new BillingInputError(`${label} must declare at least one qualification.`)
  for (const qualification of value.qualifications) {
    if (!isRecord(qualification)) throw new BillingInputError(`${label} qualifications must be objects.`)
    assertNonEmptyString(qualification.group, `${label} qualification group`)
    assertOnlyKeys(qualification, ['group', 'members'], `${label} qualification ${qualification.group}`)
    if (qualification.members !== undefined) assertStringList(qualification.members, `${label} qualification members`)
  }
}

function assertStatedParameter(value: unknown, label: string, member: string, assertMember: (member: unknown, label: string) => void): void {
  if (!isRecord(value) || typeof value.stated !== 'boolean') throw new BillingInputError(`${label} must declare whether the source states it.`)
  assertOnlyKeys(value, ['stated', member], label)
  if (value.stated) assertMember(value[member], `${label} ${member}`)
  else if (value[member] !== undefined) throw new BillingInputError(`${label} cannot carry ${member} while it is unstated.`)
}

function assertCountingScope(value: unknown, label: string): asserts value is BillingCountingScope {
  if (!isRecord(value) || typeof value.window !== 'string' || !value.window || typeof value.subject !== 'string' || !value.subject) {
    throw new BillingInputError(`${label} must declare a non-empty window and subject.`)
  }
}

function assertException(value: unknown, label: string): asserts value is BillingRuleException {
  if (!isRecord(value) || typeof value.fact !== 'string' || !value.fact || !Array.isArray(value.valueIn) || value.valueIn.length === 0) {
    throw new BillingInputError(`${label} must declare a fact and at least one matching value.`)
  }
  if (value.valueIn.some((item) => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) {
    throw new BillingInputError(`${label} values must be JSON primitives.`)
  }
}

function assertSharedSemantics(rule: BillingRule): void {
  if (rule.requiredFacts !== undefined) assertStringList(rule.requiredFacts, `Rule ${rule.id} requiredFacts`)
  const parameters = rule.parameters
  if (parameters.countingScope !== undefined) assertCountingScope(parameters.countingScope, `Rule ${rule.id} countingScope`)
  if (parameters.exceptWhen !== undefined) assertException(parameters.exceptWhen, `Rule ${rule.id} exceptWhen`)
  if (parameters.modifierExceptions !== undefined) assertStringList(parameters.modifierExceptions, `Rule ${rule.id} modifierExceptions`)
}

/** Optional parameters the engine reads for every class. A new shared parameter is added here only. */
const SHARED_OPTIONAL_PARAMETERS = ['countingScope', 'exceptWhen', 'modifierExceptions'] as const

/**
 * Classes that take none of the shared parameters. A contract code list judges each line of the Schein
 * by its own code: an exception or a modifier would let a code outside the list pass, and a counting
 * window would let another Account's lines block the Schein.
 */
const WITHOUT_SHARED_PARAMETERS: ReadonlySet<string> = new Set<GenericRuleClass>(['contract-code-list'])

/**
 * Classes whose parameter contract semantic major 3 defines or reshapes carry a strict parameter
 * allowlist, so a misspelled parameter cannot be retained in the payload and dropped semantically.
 * The remaining classes keep their 0.2.x parameter contract unchanged.
 */
const STRICT_CLASS_PARAMETERS: Partial<Record<GenericRuleClass, readonly string[]>> = {
  'accompanying-information-required': ['selector', 'information'],
  'patient-attribute-constraint': ['selector', 'attribute', 'predicate'],
  'setting-constraint': ['selector', 'setting', 'predicate'],
  'prior-authorization-required': ['selector', 'authorization', 'grant'],
  'procedure-finding-requirement': ['selector', 'procedure'],
  'diagnosis-requirement': ['selector', 'diagnosis'],
  'provider-eligibility': ['selector', 'provider'],
  'quota-degression': ['selector', 'threshold', 'adjustment', 'scopeAxes'],
  'minimum-evidence-count': ['selector', 'minimum', 'sources'],
  'contract-code-list': ['selector', 'permitted'],
}

function assertRuleParameters(rule: BillingRule): void {
  const parameters = rule.parameters
  assertSelector(parameters.selector, `Rule ${rule.id} selector`, true)
  if (rule.class === 'quantity-limit') {
    if (assertFiniteNumber(parameters.maximum, `Rule ${rule.id} maximum`) < 0) throw new BillingInputError(`Rule ${rule.id} maximum must be non-negative.`)
  } else if (rule.class === 'value-limit') {
    if (typeof parameters.maximum !== 'string' || !/^\d+(\.\d{1,2})?$/.test(parameters.maximum)) throw new BillingInputError(`Rule ${rule.id} maximum must be a non-negative decimal string with at most two fraction digits.`)
  } else if (rule.class === 'mutual-exclusion') {
    assertSelector(parameters.excluded, `Rule ${rule.id} excluded selector`)
  } else if (rule.class === 'companion-required') {
    assertSelector(parameters.required, `Rule ${rule.id} required selector`)
  } else if (rule.class === 'bounded-multiplier') {
    const minimum = assertFiniteNumber(parameters.minimum, `Rule ${rule.id} minimum`)
    // An absent maximum leaves the multiplier without an upper bound.
    const maximum = parameters.maximum === undefined ? undefined : assertFiniteNumber(parameters.maximum, `Rule ${rule.id} maximum`)
    if (maximum !== undefined && minimum > maximum) throw new BillingInputError(`Rule ${rule.id} minimum cannot exceed maximum.`)
    if (parameters.standardThreshold !== undefined) {
      const threshold = assertFiniteNumber(parameters.standardThreshold, `Rule ${rule.id} standardThreshold`)
      if (threshold < minimum || (maximum !== undefined && threshold > maximum)) throw new BillingInputError(`Rule ${rule.id} standardThreshold must be within the multiplier bounds.`)
      if (parameters.aboveThresholdEffect !== 'reject' && parameters.aboveThresholdEffect !== 'needs-review') throw new BillingInputError(`Rule ${rule.id} aboveThresholdEffect is invalid.`)
      if (parameters.justificationWaivesThreshold !== undefined && typeof parameters.justificationWaivesThreshold !== 'boolean') {
        throw new BillingInputError(`Rule ${rule.id} justificationWaivesThreshold must be a boolean.`)
      }
    } else if (parameters.aboveThresholdEffect !== undefined || parameters.agreementOverride !== undefined || parameters.justificationWaivesThreshold !== undefined) {
      throw new BillingInputError(`Rule ${rule.id} requires standardThreshold for threshold semantics.`)
    }
    if (parameters.agreementOverride !== undefined) assertException(parameters.agreementOverride, `Rule ${rule.id} agreementOverride`)
  } else if (rule.class === 'accompanying-information-required') {
    if (parameters.fact !== undefined) throw new BillingInputError(`Rule ${rule.id} fact is replaced by information.fact.`)
    if (!isRecord(parameters.information)) throw new BillingInputError(`Rule ${rule.id} information must be an object.`)
    assertOnlyKeys(parameters.information, ['kind', 'fact', 'valueIn'], `Rule ${rule.id} information`)
    assertNonEmptyString(parameters.information.kind, `Rule ${rule.id} information kind`)
    assertNonEmptyString(parameters.information.fact, `Rule ${rule.id} information fact`)
    if (parameters.information.valueIn !== undefined) assertStringList(parameters.information.valueIn, `Rule ${rule.id} information valueIn`)
  } else if (rule.class === 'patient-attribute-constraint') {
    assertNonEmptyString(parameters.attribute, `Rule ${rule.id} attribute`)
    if (!isRecord(parameters.predicate)) throw new BillingInputError(`Rule ${rule.id} predicate must be an object.`)
    const predicate = parameters.predicate
    if (predicate.equals !== undefined) throw new BillingInputError(`Rule ${rule.id} predicate equals is replaced by predicate valueIn.`)
    assertOnlyKeys(predicate, ['valueIn', 'minimum', 'maximum', 'unit'], `Rule ${rule.id} predicate`)
    const bounded = predicate.minimum !== undefined || predicate.maximum !== undefined
    if (predicate.valueIn !== undefined && bounded) throw new BillingInputError(`Rule ${rule.id} predicate cannot combine valueIn with a numeric bound.`)
    if (predicate.valueIn !== undefined && predicate.unit !== undefined) throw new BillingInputError(`Rule ${rule.id} predicate unit belongs to a numeric bound and cannot accompany valueIn.`)
    if (predicate.valueIn !== undefined) {
      assertPrimitiveList(predicate.valueIn, `Rule ${rule.id} predicate valueIn`)
    } else if (bounded) {
      if (predicate.minimum !== undefined) assertFiniteNumber(predicate.minimum, `Rule ${rule.id} predicate minimum`)
      if (predicate.maximum !== undefined) assertFiniteNumber(predicate.maximum, `Rule ${rule.id} predicate maximum`)
      if (typeof predicate.minimum === 'number' && typeof predicate.maximum === 'number' && predicate.minimum > predicate.maximum) throw new BillingInputError(`Rule ${rule.id} predicate minimum cannot exceed maximum.`)
      assertNonEmptyString(predicate.unit, `Rule ${rule.id} predicate unit`)
    } else {
      throw new BillingInputError(`Rule ${rule.id} predicate must declare valueIn or a unit-bearing numeric bound.`)
    }
  } else if (rule.class === 'contract-participation') {
    if (typeof parameters.contract !== 'string' || !parameters.contract) throw new BillingInputError(`Rule ${rule.id} contract must be non-empty.`)
  } else if (rule.class === 'contract-code-list') {
    assertSelector(parameters.permitted, `Rule ${rule.id} permitted codes`)
    assertOnlyKeys(parameters.permitted as Record<string, unknown>, ['system', 'codes'], `Rule ${rule.id} permitted codes`)
  } else if (rule.class === 'setting-constraint') {
    assertNonEmptyString(parameters.setting, `Rule ${rule.id} setting`)
    if (!isRecord(parameters.predicate)) throw new BillingInputError(`Rule ${rule.id} predicate must be an object.`)
    assertOnlyKeys(parameters.predicate, ['polarity', 'valueIn'], `Rule ${rule.id} predicate`)
    assertPolarity(parameters.predicate.polarity, `Rule ${rule.id} predicate`)
    assertPrimitiveList(parameters.predicate.valueIn, `Rule ${rule.id} predicate valueIn`)
  } else if (rule.class === 'prior-authorization-required') {
    assertNonEmptyString(parameters.authorization, `Rule ${rule.id} authorization`)
    assertException(parameters.grant, `Rule ${rule.id} grant`)
    assertOnlyKeys(parameters.grant, ['fact', 'valueIn'], `Rule ${rule.id} grant`)
  } else if (rule.class === 'procedure-finding-requirement') {
    assertCodedPredicate(parameters.procedure, `Rule ${rule.id} procedure`)
  } else if (rule.class === 'diagnosis-requirement') {
    assertCodedPredicate(parameters.diagnosis, `Rule ${rule.id} diagnosis`)
  } else if (rule.class === 'provider-eligibility') {
    assertProviderPredicate(parameters.provider, `Rule ${rule.id} provider`)
  } else if (rule.class === 'quota-degression') {
    assertStatedParameter(parameters.threshold, `Rule ${rule.id} threshold`, 'quantity', (quantity, label) => {
      if (assertFiniteNumber(quantity, label) < 0) throw new BillingInputError(`${label} must be non-negative.`)
    })
    assertStatedParameter(parameters.adjustment, `Rule ${rule.id} adjustment`, 'factor', (factor, label) => {
      if (typeof factor !== 'string' || !/^\d+(\.\d{1,4})?$/.test(factor)) throw new BillingInputError(`${label} must be a non-negative decimal string with at most four fraction digits.`)
    })
    if (parameters.scopeAxes !== undefined) assertAlternationMap(parameters.scopeAxes, `Rule ${rule.id} scope axis`)
  } else if (rule.class === 'minimum-evidence-count') {
    assertPositiveSafeInteger(parameters.minimum, `Rule ${rule.id} minimum`)
    if (!Array.isArray(parameters.sources) || parameters.sources.length === 0) throw new BillingInputError(`Rule ${rule.id} sources must declare at least one source.`)
    const facts = new Set<string>()
    for (const [index, source] of parameters.sources.entries()) {
      const label = `Rule ${rule.id} source ${index}`
      if (!isRecord(source)) throw new BillingInputError(`${label} must be an object.`)
      assertOnlyKeys(source, ['fact', 'credit', 'maximumCredit'], label)
      assertNonEmptyString(source.fact, `${label} fact`)
      if (facts.has(source.fact)) throw new BillingInputError(`Rule ${rule.id} sources must name unique facts.`)
      facts.add(source.fact)
      assertPositiveSafeInteger(source.credit, `${label} credit`)
      if (source.maximumCredit !== undefined) assertPositiveSafeInteger(source.maximumCredit, `${label} maximumCredit`)
    }
  }
  // Last, so a named migration refusal such as the removed top-level fact keeps its own message.
  const permitted = STRICT_CLASS_PARAMETERS[rule.class as GenericRuleClass]
  if (permitted !== undefined) assertOnlyKeys(parameters, [...permitted, ...(WITHOUT_SHARED_PARAMETERS.has(rule.class) ? [] : SHARED_OPTIONAL_PARAMETERS)], `Rule ${rule.id} parameters`)
}

function assertEdition(name: string, edition: AdmissionState['catalog']): void {
  if (!edition.edition || !edition.digest) throw new BillingInputError(`${name} edition and digest are required.`, { cause: 'digest-invalid' })
  for (const [label, value] of [['effectiveStart', edition.effectiveStart], ['effectiveEnd', edition.effectiveEnd]] as const) {
    if (value !== undefined && !isIsoDate(value)) throw new BillingInputError(`${name} ${label} must be an ISO date.`)
  }
  if (edition.effectiveStart !== undefined && edition.effectiveEnd !== undefined && edition.effectiveStart > edition.effectiveEnd) {
    throw new BillingInputError(`${name} effectiveStart cannot follow effectiveEnd.`)
  }
}

function editionReasons(edition: AdmissionState['catalog']): BillingReason[] {
  const reasons: BillingReason[] = []
  if (edition.availability === 'missing') reasons.push({ code: 'EDITION_UNAVAILABLE' })
  if (edition.availability === 'expired') reasons.push({ code: 'EDITION_EXPIRED' })
  // A partial edition is admitted: its decoded rules run and the SDK marks the result CATALOG_PARTIAL.
  // Only an edition whose completeness is unknown (or any unrecognized value) is withheld.
  if (edition.completeness !== 'complete' && edition.completeness !== 'partial') reasons.push({ code: 'ADMISSION_INCOMPLETE' })
  if (!edition.entitled) reasons.push({ code: 'EDITION_UNENTITLED' })
  if (!edition.compatible) reasons.push({ code: 'EDITION_INCOMPATIBLE' })
  if (edition.digestMatches !== true) reasons.push({ code: 'DIGEST_MISMATCH' })
  return reasons
}

export function isGenericRuleClass(value: string): value is GenericRuleClass {
  return Object.hasOwn(BILLING_RULE_CLASS_DEFINITIONS, value)
}

/** One code a rule names, with the code system when the rule states it. */
export interface BillingRuleNamedCode {
  readonly system?: string
  readonly code: string
}

/**
 * The parameters through which a generic rule class names fee codes besides its `selector`:
 * `mutual-exclusion` its `excluded` and `companion-required` its `required` codes. Every other parameter
 * of a generic class names facts, values or contracts, not fee codes.
 */
const CODE_PARAMETERS: Readonly<Partial<Record<GenericRuleClass, readonly string[]>>> = {
  'mutual-exclusion': ['excluded'],
  'companion-required': ['required'],
}

/**
 * The fee codes a rule names in any role (selector, excluded, required), unique and ordered by system and
 * code. `undefined` when the rule names no explicit codes, so no per-code publication can carry it: a
 * `"*"` or code-less selector, or a class whose code parameters Core does not know (a jurisdiction's own
 * class such as `unsupported-source-rule`), whose publisher has to name the codes itself.
 */
export function billingRuleNamedCodes(rule: Pick<BillingRule, 'class' | 'parameters'>): readonly BillingRuleNamedCode[] | undefined {
  if (!isGenericRuleClass(rule.class) || !isRecord(rule.parameters)) return undefined
  const named = new Map<string, BillingRuleNamedCode>()
  for (const key of ['selector', ...(CODE_PARAMETERS[rule.class] ?? [])]) {
    const value = rule.parameters[key]
    if (!isRecord(value) || !Array.isArray(value.codes) || value.codes.length === 0) return undefined
    const system = typeof value.system === 'string' && value.system ? value.system : undefined
    for (const code of value.codes) {
      if (typeof code !== 'string' || !code || code === '*') return undefined
      named.set(`${system ?? ''}\u0000${code}`, { ...(system === undefined ? {} : { system }), code })
    }
  }
  return [...named.keys()].sort().map((key) => named.get(key)!)
}

function assertProvenanceText(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new BillingInputError(`${label} must be non-empty.`)
}

/**
 * Provenance is strictly shaped like the parameter objects: an unknown key is refused, so a source a
 * newer author states is never silently dropped. It is informative only and never changes evaluation.
 */
function assertProvenance(rule: BillingRule): void {
  const label = `Rule ${rule.id} provenance`
  const provenance: unknown = rule.provenance
  if (!isRecord(provenance)) throw new BillingInputError(`${label} must be an object.`)
  assertOnlyKeys(provenance, ['sources', 'evidenceLevel', 'note'], label)
  if (!Array.isArray(provenance.sources) || provenance.sources.length === 0) throw new BillingInputError(`${label} sources must be a non-empty array.`)
  for (const [index, source] of provenance.sources.entries()) {
    const where = `${label} source ${index}`
    if (!isRecord(source)) throw new BillingInputError(`${where} must be an object.`)
    assertOnlyKeys(source, ['kind', 'citation', 'uri', 'codes'], where)
    if (!(BILLING_RULE_SOURCE_KINDS as readonly unknown[]).includes(source.kind)) {
      throw new BillingInputError(`${where} kind must be one of ${BILLING_RULE_SOURCE_KINDS.join(', ')}.`)
    }
    assertProvenanceText(source.citation, `${where} citation`)
    if (source.uri !== undefined) assertProvenanceText(source.uri, `${where} uri`)
    if (source.codes !== undefined) {
      const codes: unknown = source.codes
      if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => typeof code !== 'string' || !code.trim()) || new Set(codes).size !== codes.length) {
        throw new BillingInputError(`${where} codes must contain unique non-blank strings.`)
      }
    }
  }
  const level = provenance.evidenceLevel
  if (!isRecord(level)) throw new BillingInputError(`${label} evidenceLevel must be a Coding.`)
  assertOnlyKeys(level, ['system', 'code', 'display', 'version'], `${label} evidenceLevel`)
  assertProvenanceText(level.system, `${label} evidenceLevel system`)
  assertProvenanceText(level.code, `${label} evidenceLevel code`)
  for (const key of ['display', 'version'] as const) {
    if (level[key] !== undefined) assertProvenanceText(level[key], `${label} evidenceLevel ${key}`)
  }
  if (provenance.note !== undefined) assertProvenanceText(provenance.note, `${label} note`)
}

/** One step of a fact-source path: an element name, an extension by url, or the final coding filter by system. */
export type BillingFactSourcePathStep =
  | { readonly kind: 'element'; readonly name: string }
  | { readonly kind: 'extension'; readonly url: string }
  | { readonly kind: 'coding'; readonly system: string }

const PATH_ELEMENT = /^[a-z][A-Za-z0-9]*$/
/**
 * Element names a path may not use: the names of `Object.prototype` members, and `coding` and
 * `extension`, which a path reaches only through `coding('<system>')` and `extension('<url>')`.
 */
const PATH_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'coding', 'extension', 'constructor', 'prototype', '__proto__', 'toString', 'toLocaleString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
])
const PATH_FUNCTION = /^(extension|coding)\('([^']+)'\)$/
const MAX_PATH_STEPS = 32

/**
 * Parses the restricted path of a fact-source declaration: steps separated by `.`, each an element
 * name (`[a-z][A-Za-z0-9]*`, never `coding`, `extension` or an `Object.prototype` member name),
 * `extension('<url>')` or, as the last step after at least one other,
 * `coding('<system>')`. A quoted argument is non-empty and holds no `'`. Anything else, an empty
 * step, or more than 32 steps is a `BillingInputError`.
 */
export function parseBillingFactSourcePath(path: string): readonly BillingFactSourcePathStep[] {
  if (typeof path !== 'string' || !path) throw new BillingInputError('Fact-source path must be a non-empty string.')
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const character of path) {
    if (character === "'") quoted = !quoted
    if (character === '.' && !quoted) {
      tokens.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (quoted) throw new BillingInputError(`Fact-source path ${path} has an unterminated quote.`)
  tokens.push(current)
  if (tokens.length > MAX_PATH_STEPS) throw new BillingInputError(`Fact-source path ${path} has more than ${MAX_PATH_STEPS} steps.`)
  const steps = tokens.map((token, index): BillingFactSourcePathStep => {
    if (PATH_RESERVED_NAMES.has(token)) throw new BillingInputError(`Fact-source path ${path} step ${index + 1} uses the reserved name ${token}; use coding('<system>') or extension('<url>') for codings and extensions.`)
    if (PATH_ELEMENT.test(token)) return { kind: 'element', name: token }
    const call = PATH_FUNCTION.exec(token)
    if (call === null) throw new BillingInputError(`Fact-source path ${path} step ${index + 1} is not an element name, extension('<url>') or coding('<system>').`)
    if (call[1] === 'extension') return { kind: 'extension', url: call[2]! }
    if (index === 0 || index !== tokens.length - 1) throw new BillingInputError(`Fact-source path ${path} may filter by coding('<system>') only as its last step after another step.`)
    return { kind: 'coding', system: call[2]! }
  })
  return steps
}

/** A declared fact name: dot-separated words; never a native fact name nor a `system|code` Observation fact. */
const DECLARED_FACT_NAME = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/
const FACT_SOURCE_VALUE_SHAPES: readonly string[] = ['code', 'system|code', 'boolean-present', 'group-member']

function assertFactSources(value: unknown): asserts value is readonly BillingFactSourceDeclaration[] {
  if (!Array.isArray(value) || value.length === 0) throw new BillingInputError('Rule-set factSources must be a non-empty array; omit it when the rule set declares none.')
  const facts = new Set<string>()
  for (const [index, declaration] of value.entries()) {
    const label = `Fact source ${index}`
    if (!isRecord(declaration)) throw new BillingInputError(`${label} must be an object.`)
    assertOnlyKeys(declaration, ['fact', 'from', 'path', 'valueAs', 'groupPath', 'perBilledCode', 'absent'], label)
    const { fact, from, path, valueAs, groupPath, perBilledCode, absent } = declaration as Record<string, unknown>
    if (typeof fact !== 'string' || !DECLARED_FACT_NAME.test(fact)) throw new BillingInputError(`${label} fact must be a dot-separated name without "|".`)
    if ((BILLING_NATIVE_FACT_NAMES as readonly string[]).includes(fact)) throw new BillingInputError(`${label} cannot declare the native fact ${fact}.`)
    if (facts.has(fact)) throw new BillingInputError(`Rule-set factSources declare ${fact} more than once.`)
    facts.add(fact)
    if (!(BILLING_FACT_SOURCE_ORIGINS as readonly unknown[]).includes(from)) throw new BillingInputError(`${label} from must be one of ${BILLING_FACT_SOURCE_ORIGINS.join(', ')}.`)
    const steps = parseBillingFactSourcePath(path as string)
    if (valueAs !== undefined && !FACT_SOURCE_VALUE_SHAPES.includes(valueAs as string)) throw new BillingInputError(`${label} valueAs must be one of ${FACT_SOURCE_VALUE_SHAPES.join(', ')}.`)
    if (absent !== undefined && absent !== 'known-absent') throw new BillingInputError(`${label} absent must be known-absent when stated.`)
    if (perBilledCode !== undefined) {
      if (!isRecord(perBilledCode)) throw new BillingInputError(`${label} perBilledCode must be an object.`)
      assertOnlyKeys(perBilledCode, ['system'], `${label} perBilledCode`)
      if (perBilledCode.system !== undefined) assertNonEmptyString(perBilledCode.system, `${label} perBilledCode system`)
      if (valueAs !== undefined) throw new BillingInputError(`${label} perBilledCode yields a boolean and cannot combine with valueAs.`)
      if (steps[steps.length - 1]!.kind !== 'coding') throw new BillingInputError(`${label} perBilledCode requires a path ending in coding('<system>').`)
    }
    if (valueAs === 'group-member') {
      // The pairing is read from one PractitionerRole; a missing pairing is never known to be absent.
      if (from !== 'performer-role') throw new BillingInputError(`${label} valueAs group-member requires from performer-role.`)
      if (groupPath === undefined) throw new BillingInputError(`${label} valueAs group-member requires groupPath.`)
      if (absent !== undefined) throw new BillingInputError(`${label} valueAs group-member cannot combine with absent; a missing pairing stays source-unavailable.`)
      if (steps[steps.length - 1]!.kind !== 'coding') throw new BillingInputError(`${label} valueAs group-member requires a path ending in coding('<system>').`)
      const groupSteps = parseBillingFactSourcePath(groupPath as string)
      if (groupSteps[groupSteps.length - 1]!.kind !== 'coding') throw new BillingInputError(`${label} groupPath must end in coding('<system>').`)
    } else if (groupPath !== undefined) {
      throw new BillingInputError(`${label} groupPath is allowed only with valueAs group-member.`)
    }
  }
}

/** A canonical a bound rule set names: an absolute URI without whitespace, optionally `|version`. */
const BILLING_BOUND_CANONICAL = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s|]+(?:\|[^\s|]+)?$/

/**
 * A bound rule set's `appliesTo`: exactly one of `contracts` (a contract rule set) and
 * `catalogEditions` (an overlay rule set), a non-empty list of unique canonicals. Each is an absolute
 * URI, optionally `|version`, without whitespace or a second `|`.
 */
function assertAppliesTo(value: unknown): asserts value is BillingRuleSetAppliesTo {
  if (!isRecord(value)) throw new BillingInputError('Rule-set appliesTo must be an object.')
  assertOnlyKeys(value, ['contracts', 'catalogEditions'], 'Rule-set appliesTo')
  const members = (['contracts', 'catalogEditions'] as const).filter((key) => Object.hasOwn(value, key))
  if (members.length === 2) throw new BillingInputError('Rule-set appliesTo must not name both contracts and catalogEditions; a rule set is bound to Contracts or to catalog editions.')
  if (members.length === 0) throw new BillingInputError('Rule-set appliesTo requires contracts or catalogEditions; omit appliesTo on a rule set that is not bound.')
  const key = members[0]!
  const label = key === 'contracts' ? 'contract' : 'catalog edition'
  const bound = value[key]
  if (!Array.isArray(bound) || bound.length === 0) throw new BillingInputError(`Rule-set appliesTo ${key} must be a non-empty array; omit appliesTo on a rule set that is not bound.`)
  for (const [index, canonical] of bound.entries()) {
    if (typeof canonical !== 'string' || !BILLING_BOUND_CANONICAL.test(canonical)) {
      throw new BillingInputError(`Rule-set appliesTo ${label} ${index} must be an absolute canonical, optionally |version.`)
    }
  }
  if (new Set(bound).size !== bound.length) throw new BillingInputError(`Rule-set appliesTo ${key} must be unique.`)
}

/**
 * The payload digest of a rule set: the canonical JSON of `{ schemaVersion: 2, rules, factSources,
 * appliesTo }`. Canonical JSON drops an absent member, so a rule set without fact sources or Contract
 * binding keeps the digest it had before either member existed.
 */
/** Objects found deep-frozen once: they stay so, so they are not walked again. */
const DEEP_FROZEN = new WeakSet<object>()

/** Whether `value` and everything it holds is frozen, so it can neither change nor be changed. */
function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  if (DEEP_FROZEN.has(value)) return true
  if (!Object.isFrozen(value)) return false
  for (const child of Object.values(value)) if (!isDeepFrozen(child)) return false
  DEEP_FROZEN.add(value)
  return true
}

export function billingRuleSetDigest(ruleSet: Pick<BillingRuleSet, 'rules' | 'factSources' | 'appliesTo'>): string {
  return billingRulePayloadDigest({ schemaVersion: 2, rules: ruleSet.rules, factSources: ruleSet.factSources, appliesTo: ruleSet.appliesTo })
}

export function defineBillingRuleSet(input: BillingRuleSet): BillingRuleSet {
  if (input.schemaVersion !== BILLING_RULE_PAYLOAD_SCHEMA_VERSION) throw new BillingInputError('Payload schema version 2 is required.', { cause: 'schema-version' })
  if (input.semanticMajor !== BILLING_RULE_SEMANTIC_MAJOR) throw new BillingInputError('Rule semantic major 4 is required.', { cause: 'semantic-major' })
  if (!input.id.trim()) throw new BillingInputError('Rule-set id is required.')
  if (input.factSources !== undefined) assertFactSources(input.factSources)
  if (input.appliesTo !== undefined) assertAppliesTo(input.appliesTo)
  const ids = new Set<string>()
  for (const rule of input.rules) {
    if (!rule.id.trim() || ids.has(rule.id)) throw new BillingInputError('Rule ids must be non-empty and unique.')
    ids.add(rule.id)
    assertOnlyKeys(rule, BILLING_RULE_KEYS, `Rule ${rule.id}`)
    if (typeof rule.mustUnderstand !== 'boolean') throw new BillingInputError(`Rule ${rule.id} mustUnderstand must be boolean.`)
    if (!Number.isSafeInteger(rule.priority)) throw new BillingInputError(`Rule ${rule.id} priority must be an integer.`)
    if (rule.effect !== 'reject' && rule.effect !== 'needs-review') throw new BillingInputError(`Rule ${rule.id} effect is invalid.`)
    if (rule.effectiveStart !== undefined && !isIsoDate(rule.effectiveStart)) throw new BillingInputError(`Rule ${rule.id} effectiveStart must be an ISO date.`)
    if (rule.effectiveEnd !== undefined && !isIsoDate(rule.effectiveEnd)) throw new BillingInputError(`Rule ${rule.id} effectiveEnd must be an ISO date.`)
    if (rule.effectiveStart !== undefined && rule.effectiveEnd !== undefined && rule.effectiveStart > rule.effectiveEnd) throw new BillingInputError(`Rule ${rule.id} effectiveStart cannot follow effectiveEnd.`)
    if (!isRecord(rule.parameters)) throw new BillingInputError(`Rule ${rule.id} parameters must be an object.`)
    if (rule.provenance !== undefined) assertProvenance(rule)
    if (isGenericRuleClass(rule.class)) {
      assertSharedSemantics(rule)
      for (const parameter of BILLING_RULE_CLASS_DEFINITIONS[rule.class]!.requiredParameters) {
        if (rule.parameters[parameter] === undefined) throw new BillingInputError(`Rule ${rule.id} requires parameter ${parameter}.`)
      }
      assertRuleParameters(rule)
    }
    // A code list holds only under the Contract that selected it; in any other rule set it would apply to every Schein.
    if (rule.class === 'contract-code-list' && input.appliesTo?.contracts === undefined) {
      throw new BillingInputError(`Rule ${rule.id} is a contract code list and belongs only to a contract rule set (appliesTo.contracts).`)
    }
    // An inactive rule is skipped, so a dated code list would let every code pass outside its dates; its
    // validity is the contract rule set's effective period, which fails closed when it does not hold.
    if (rule.class === 'contract-code-list' && (rule.effectiveStart !== undefined || rule.effectiveEnd !== undefined)) {
      throw new BillingInputError(`Rule ${rule.id} is a contract code list; its validity is the contract rule set's effective period, not effectiveStart or effectiveEnd.`)
    }
  }
  // Deep-frozen rules (a decoded carrier's) cannot change: they are taken as they are, not copied again.
  if (input.rules.every(isDeepFrozen)) {
    const copy: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) copy[key] = key === 'rules' ? Object.freeze([...input.rules]) : deepFreeze(structuredClone(value))
    return Object.freeze(copy) as unknown as BillingRuleSet
  }
  return deepFreeze(structuredClone(input))
}

export function admitBillingRuleSet(admission: AdmissionState, rules: readonly BillingRule[]): BillingRuleAdmission {
  assertEdition('Catalog', admission.catalog)
  assertEdition('Rule set', admission.ruleSet)
  const reasons = [...editionReasons(admission.catalog), ...editionReasons(admission.ruleSet)]
  if (admission.status === 'needs-review' && reasons.length === 0) reasons.push({ code: 'ADMISSION_INCOMPLETE' })
  for (const rule of rules) {
    if (!isGenericRuleClass(rule.class) && rule.mustUnderstand) reasons.push({ code: 'UNSUPPORTED_RULE', ruleId: rule.id })
  }
  return reasons.length === 0 ? { status: 'admitted', reasons: [] } : { status: 'needs-review', reasons }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

/** Quoted object keys, reused across calls: resources repeat the same few hundred member names. */
const QUOTED_KEYS = new Map<string, string>()
const QUOTED_KEY_LIMIT = 4096

function quotedKey(key: string): string {
  let quoted = QUOTED_KEYS.get(key)
  if (quoted === undefined) {
    quoted = JSON.stringify(key)
    if (QUOTED_KEYS.size >= QUOTED_KEY_LIMIT) QUOTED_KEYS.clear()
    QUOTED_KEYS.set(key, quoted)
  }
  return quoted
}

/**
 * Canonical JSON: object members with a defined value sorted by key (UTF-16 code units), arrays in
 * order with `undefined` as `null`, scalars as `JSON.stringify` writes them; a value JSON cannot carry
 * (`undefined`, a function, a symbol) throws. The output is byte-identical to the implementation before
 * 0.25.0 (an array hole still prints as nothing between its commas), built in one pass without
 * intermediate arrays.
 */
export function canonicalizeJson(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    // Fast path: a copy with members in canonical order, written by the native serializer. It is
    // taken only for plain JSON data, where both write the same bytes.
    const clone = sortedPlainClone(value)
    if (clone !== UNSUPPORTED) return JSON.stringify(clone)
  }
  const parts: string[] = []
  writeCanonical(value, parts)
  return parts.join('')
}

const UNSUPPORTED: unique symbol = Symbol('unsupported')
const ARRAY_INDEX = /^\d+$/

/**
 * A copy of plain JSON data whose objects (without prototype, so `__proto__` stays a member) list
 * their defined members in canonical key order, or {@link UNSUPPORTED} when `JSON.stringify` of the copy
 * could differ from the canonical writer: an object that is not a plain object or array (it may carry
 * `toJSON` or box a primitive), an integer-like key (which JavaScript orders first), an array hole, and
 * a function, symbol or bigint value.
 */
function sortedPlainClone(value: unknown): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object':
      break
    default:
      return UNSUPPORTED
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return UNSUPPORTED
    const length = value.length
    const copy: unknown[] = new Array<unknown>(length)
    for (let index = 0; index < length; index += 1) {
      if (!(index in value)) return UNSUPPORTED
      const item: unknown = value[index]
      if (item === undefined) {
        copy[index] = null
        continue
      }
      const cloned = sortedPlainClone(item)
      if (cloned === UNSUPPORTED) return UNSUPPORTED
      copy[index] = cloned
    }
    return copy
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return UNSUPPORTED
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const copy = Object.create(null) as Record<string, unknown>
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!
    if (ARRAY_INDEX.test(key)) return UNSUPPORTED
    const item = record[key]
    if (item === undefined) continue
    const cloned = sortedPlainClone(item)
    if (cloned === UNSUPPORTED) return UNSUPPORTED
    copy[key] = cloned
  }
  return copy
}

function writeCanonical(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push(JSON.stringify(value))
    return
  }
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new BillingInputError('Canonical JSON values must be JSON-compatible.')
    parts.push(serialized)
    return
  }
  if (Array.isArray(value)) {
    const length = value.length
    parts.push('[')
    for (let index = 0; index < length; index += 1) {
      if (index > 0) parts.push(',')
      // `map` skips a hole and `join` prints it as nothing.
      if (!(index in value)) continue
      const item: unknown = value[index]
      if (item === undefined) parts.push('null')
      else writeCanonical(item, parts)
    }
    parts.push(']')
    return
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  parts.push('{')
  let first = true
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!
    const item = record[key]
    if (item === undefined) continue
    parts.push(first ? quotedKey(key) : `,${quotedKey(key)}`, ':')
    first = false
    writeCanonical(item, parts)
  }
  parts.push('}')
}

export function billingRulePayloadDigest(payload: BillingRulePayloadV2): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(payload)).digest('hex')}`
}

export function sortRules(rules: readonly BillingRule[]): BillingRule[] {
  return [...rules].sort((left, right) => left.priority - right.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}
