import {
  BILLING_CONFORMANCE_FORMAT,
  BILLING_CONFORMANCE_INPUT_INVALID,
  BILLING_CORE_VERSION,
  BILLING_FACT_UNAVAILABLE_CAUSES,
  type AdmissionState,
  type BillingConformanceBlockingPair,
  type BillingConformanceDecision,
  type BillingConformanceDifference,
  type BillingConformanceFinding,
  type BillingConformanceRecord,
  type BillingConformanceRuleSetIdentity,
  type BillingConformanceSide,
  type BillingCase,
  type BillingLine,
  type BillingCountingScope,
  type BillingFact,
  type BillingFactUnavailableCause,
  type BillingFactValue,
  type BillingReason,
  type BillingReasonResolution,
  type BillingResolutionCode,
  type BillingResult,
  type BillingRule,
  type BillingRuleEffect,
  type BillingRuleSet,
  type CompiledRuleSet,
  type FhirParameters,
  type OracleFixture,
} from '@cognovis/fhir-billing-types'
import {
  BILLING_RULE_REASON_SYSTEM,
  BillingInputError,
  admitBillingRuleSet,
  billingRuleSetDigest,
  canonicalizeJson,
  BILLING_INTERPRETABLE_UNITS,
  compareUnitBearingValues,
  decodeBillingLibrary,
  decodeBillingRuleSet,
  defineBillingRuleSet,
  isGenericRuleClass,
  sortRules,
} from '@cognovis/fhir-billing-rules'

export { BillingInputError } from '@cognovis/fhir-billing-rules'
export {
  BILLING_CONFORMANCE_FORMAT,
  BILLING_CONFORMANCE_INPUT_INVALID,
  type BillingConformanceBlockingPair,
  type BillingConformanceDecision,
  type BillingConformanceDifference,
  type BillingConformanceFinding,
  type BillingConformanceRecord,
  type BillingConformanceRuleSetIdentity,
  type BillingConformanceSide,
  type BillingReasonResolution,
  type BillingResolutionCode,
} from '@cognovis/fhir-billing-types'
export const BILLING_ENGINE_VERSION = BILLING_CORE_VERSION
export const BILLING_ENGINE_CAPABILITY = {
  semanticMajors: [4],
  payloadSchemas: [2],
  precision: 'exact-decimal',
  ordering: 'priority-then-id',
} as const

function parseDate(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BillingInputError(`${label} must be an ISO date.`)
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new BillingInputError(`${label} must be an ISO date.`)
  return parsed
}

function validateCase(input: BillingCase): void {
  if (!input.id.trim()) throw new BillingInputError('Case id is required.')
  parseDate(input.asOf, 'Case asOf')
  const ids = new Set<string>()
  for (const line of input.lines) {
    if (!line.id.trim() || ids.has(line.id)) throw new BillingInputError('Line ids must be non-empty and unique.')
    ids.add(line.id)
    if (!line.code.system || !line.code.code) throw new BillingInputError(`Line ${line.id} requires a system and code.`)
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new BillingInputError(`Line ${line.id} quantity must be a non-negative integer.`)
    validateLinePrice(line)
    if (line.multiplier !== undefined && !Number.isFinite(line.multiplier)) throw new BillingInputError(`Line ${line.id} multiplier must be finite.`)
    if (line.actualMultiplier !== undefined && !Number.isFinite(line.actualMultiplier)) throw new BillingInputError(`Line ${line.id} actualMultiplier must be finite.`)
    if (line.actualMultiplier !== undefined && line.multiplier !== undefined && line.actualMultiplier !== line.multiplier) throw new BillingInputError(`Line ${line.id} multiplier aliases conflict.`)
    if (line.multiplierJustified !== undefined && typeof line.multiplierJustified !== 'boolean') throw new BillingInputError(`Line ${line.id} multiplierJustified must be a boolean.`)
    if (line.modifiers !== undefined && (line.modifiers.some((modifier) => !modifier) || new Set(line.modifiers).size !== line.modifiers.length)) throw new BillingInputError(`Line ${line.id} modifiers must be unique and non-empty.`)
  }
  validateFacts(input.facts, 'Fact')
  for (const line of input.lines) {
    if (line.facts !== undefined) validateFacts(line.facts, `Line ${line.id} fact`)
    if (line.information !== undefined) validateFacts(line.information, `Line ${line.id} information`)
  }
  const scopes = new Set<string>()
  for (const window of input.countingWindows ?? []) {
    if (!window.scope.window || !window.scope.subject) throw new BillingInputError('Counting windows require a non-empty window and subject.')
    const scopeKey = `${window.scope.window}\u0000${window.scope.subject}`
    if (scopes.has(scopeKey)) throw new BillingInputError('Counting window scopes must be unique.')
    scopes.add(scopeKey)
    if (window.lineIds.length === 0 || new Set(window.lineIds).size !== window.lineIds.length || window.lineIds.some((id) => !ids.has(id))) throw new BillingInputError('Counting windows must reference unique existing lines.')
  }
}

/** A line carries exactly one of a unit price and the `unitPriceUnknown: true` marker. */
function validateLinePrice(line: BillingLine): void {
  if (line.unitPriceUnknown !== undefined && line.unitPriceUnknown !== true) throw new BillingInputError(`Line ${line.id} unitPriceUnknown must be true when present.`)
  if (line.unitPriceUnknown === true) {
    if (line.unitPrice !== undefined) throw new BillingInputError(`Line ${line.id} cannot carry a unit price and unitPriceUnknown.`)
    return
  }
  if (line.unitPrice === undefined) throw new BillingInputError(`Line ${line.id} requires a unit price or unitPriceUnknown.`)
  if (!/^-?\d+(\.\d{1,2})?$/.test(line.unitPrice.value)) throw new BillingInputError(`Line ${line.id} money must use a decimal string with at most two fraction digits.`)
  if (!line.unitPrice.currency) throw new BillingInputError(`Line ${line.id} currency is required.`)
}

function validateFacts(facts: Readonly<Record<string, unknown>>, label: string): void {
  if (typeof facts !== 'object' || facts === null || Array.isArray(facts)) throw new BillingInputError(`${label}s must be an object.`)
  for (const [name, fact] of Object.entries(facts)) {
    if (typeof fact === 'object' && fact !== null && !isBillingFact(fact) && Object.hasOwn(fact, 'state') && isBillingFactState((fact as { state?: unknown }).state)) {
      throw new BillingInputError(`${label} ${name} uses a reserved availability state without kind billing-fact.`)
    }
    if (!isBillingFact(fact)) continue
    const typed = fact as BillingFact
    if (!isBillingFactState(typed.state)) throw new BillingInputError(`${label} ${name} state is invalid.`)
    if (typed.state === 'known' && !Object.hasOwn(typed, 'value')) throw new BillingInputError(`Known ${label.toLowerCase()} ${name} requires a value.`)
    if (typed.state !== 'known' && Object.hasOwn(typed, 'value')) throw new BillingInputError(`${label} ${name} cannot carry a value in state ${typed.state}.`)
    if (Object.hasOwn(typed, 'cause')) {
      if (typed.state !== 'source-unavailable') throw new BillingInputError(`${label} ${name} cannot carry a cause in state ${typed.state}.`)
      if (!(BILLING_FACT_UNAVAILABLE_CAUSES as readonly unknown[]).includes(typed.cause)) throw new BillingInputError(`${label} ${name} cause must be one of ${BILLING_FACT_UNAVAILABLE_CAUSES.join(', ')}.`)
    }
  }
}

export function compileRuleSet(ruleSet: BillingRuleSet, admission: AdmissionState): CompiledRuleSet {
  const defined = defineBillingRuleSet(ruleSet)
  const decision = admitBillingRuleSet(admission, defined.rules)
  const ignoredRuleIds = defined.rules.filter((rule) => !isGenericRuleClass(rule.class) && !rule.mustUnderstand).map((rule) => rule.id)
  const withheldReasons = decision.status === 'needs-review' ? [...decision.reasons] : []
  if (admission.ruleSet.edition !== defined.id) withheldReasons.push({ code: 'EDITION_INCOMPATIBLE' })
  return deepFreeze({
    id: defined.id,
    admission: structuredClone(admission),
    rules: sortRules(defined.rules).filter((rule) => isGenericRuleClass(rule.class)),
    withheldReasons,
    ignoredRuleIds,
  })
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

/** Codes in the primary selector match literally, except a sole "*" which selects every line code within the optional system. */
function selectorMatches(line: BillingLine, parameters: Record<string, unknown>): boolean {
  const selector = parameters.selector as { system?: string; codes?: string[] }
  const everyCode = selector.codes?.length === 1 && selector.codes[0] === '*'
  return (selector.system === undefined || selector.system === line.code.system) && (everyCode || (selector.codes?.includes(line.code.code) ?? false))
}

function decimalMinor(value: string): bigint {
  const negative = value.startsWith('-')
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const magnitude = BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2))
  return negative ? -magnitude : magnitude
}

function reason(code: BillingReason['code'], rule: BillingRule, line?: BillingLine, details?: BillingReason['details'], resolution?: BillingReasonResolution): BillingReason {
  return { code, ruleId: rule.id, ...(line ? { lineId: line.id } : {}), ...(details ? { details } : {}), ...(resolution ? { resolution } : {}) }
}

/** The codes a selector configures, with its system when it names one, in configured order. */
function selectorCodes(selector: { system?: string | undefined; codes: readonly string[] }): BillingResolutionCode[] {
  return selector.codes.map((code) => ({ ...(selector.system !== undefined ? { system: selector.system } : {}), code }))
}

/**
 * A resolution only for a block: a rule with effect `needs-review` blocks nothing a code change must fix.
 * Codes are de-duplicated by their canonical identity; the first occurrence keeps its position.
 */
function blockResolution(rule: BillingRule, action: BillingReasonResolution['action'], codes: readonly BillingResolutionCode[]): BillingReasonResolution | undefined {
  if (rule.effect !== 'reject') return undefined
  const seen = new Set<string>()
  const unique = codes.filter((item) => {
    const key = canonicalizeJson(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { action, codes: unique }
}

interface RuleFinding {
  reason: BillingReason
  effect: 'reject' | 'needs-review'
}

interface FactResolution {
  available: boolean
  value: unknown
  /** The cause a `source-unavailable` fact names, when it names one. */
  cause?: BillingFactUnavailableCause
}

interface MinimumEvidenceSource {
  fact: string
  credit: number
  maximumCredit?: number
}

function isBillingFact(value: unknown): value is BillingFact {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'billing-fact'
}

function isBillingFactState(value: unknown): value is BillingFact['state'] {
  return typeof value === 'string' && ['known', 'known-absent', 'not-supplied', 'source-unavailable'].includes(value)
}

function resolveFact(input: BillingCase, name: string): FactResolution {
  if (!Object.hasOwn(input.facts, name)) return { available: false, value: undefined }
  const fact = input.facts[name]
  if (isBillingFact(fact)) {
    if (fact.state === 'known') return { available: true, value: fact.value }
    if (fact.state === 'known-absent') return { available: true, value: undefined }
    return { available: false, value: undefined, ...(fact.state === 'source-unavailable' && fact.cause !== undefined ? { cause: fact.cause } : {}) }
  }
  return { available: fact !== undefined, value: fact }
}

function unitQuantity(value: unknown): { value: number; unit: string } | undefined {
  return isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value) && typeof value.unit === 'string' && value.unit
    ? { value: value.value, unit: value.unit }
    : undefined
}

/**
 * The quantity a numeric bound in `boundUnit` is compared against. A single quantity is compared by
 * exact conversion within its dimension. A list states one completed quantity per unit (an age in
 * completed years, months, weeks and days) and yields only the member in the bound's own unit, never
 * a conversion, because a completed coarser unit is not the finer count divided by a factor. A list
 * with an invalid member, a member in a unit Billing Core cannot interpret, or a repeated unit yields
 * nothing.
 */
function boundQuantity(value: unknown, boundUnit: string): { value: number; unit: string } | undefined {
  if (!Array.isArray(value)) return unitQuantity(value)
  // Array.from visits holes, which map and some would skip.
  const members = Array.from(value, unitQuantity)
  if (members.some((member) => member === undefined || !Object.hasOwn(BILLING_INTERPRETABLE_UNITS, member.unit))) return undefined
  const units = new Set(members.map((member) => member!.unit))
  if (units.size !== members.length) return undefined
  return members.find((member) => member!.unit === boundUnit)
}

function matchesScope(left: BillingCountingScope, right: BillingCountingScope): boolean {
  return left.window === right.window && left.subject === right.subject
}

function modifierExempts(line: BillingLine, modifiers: readonly string[] | undefined): boolean {
  return modifiers?.some((modifier) => line.modifiers?.includes(modifier)) ?? false
}

/**
 * What every rule of one case reads about its lines, built once per case instead of once per rule: the
 * lines by code (in case order, with their position), and the lines of each counting scope. Rules only
 * read these arrays.
 */
interface CaseLines {
  readonly position: ReadonlyMap<BillingLine, number>
  readonly byCode: ReadonlyMap<string, readonly BillingLine[]>
  readonly all: readonly BillingLine[]
  /** Per counting scope (`window subject`): its single window's lines in case order, or the number of windows when not exactly one. */
  readonly scopes: Map<string, readonly BillingLine[] | number>
}

const CASE_LINES = new WeakMap<BillingCase, CaseLines>()

function caseLines(input: BillingCase): CaseLines {
  let known = CASE_LINES.get(input)
  if (known === undefined) {
    const position = new Map<BillingLine, number>()
    const byCode = new Map<string, BillingLine[]>()
    for (const [index, line] of input.lines.entries()) {
      position.set(line, index)
      const lines = byCode.get(line.code.code)
      if (lines === undefined) byCode.set(line.code.code, [line])
      else lines.push(line)
    }
    known = { position, byCode, all: [...input.lines], scopes: new Map() }
    CASE_LINES.set(input, known)
  }
  return known
}

/**
 * The case lines a rule's primary selector matches and no modifier exception exempts, in case order:
 * exactly `input.lines.filter(selectorMatches && !modifierExempts)`, found through the lines of the
 * selector's codes instead of every line.
 */
function selectedLines(rule: BillingRule, input: BillingCase, modifierExceptions: readonly string[] | undefined): readonly BillingLine[] {
  const selector = rule.parameters.selector as { system?: string; codes?: string[] }
  const everyCode = selector.codes?.length === 1 && selector.codes[0] === '*'
  if (everyCode) return input.lines.filter((line) => selectorMatches(line, rule.parameters) && !modifierExempts(line, modifierExceptions))
  const index = caseLines(input)
  const found: BillingLine[] = []
  for (const code of new Set(selector.codes ?? [])) {
    for (const line of index.byCode.get(code) ?? []) {
      if ((selector.system === undefined || selector.system === line.code.system) && !modifierExempts(line, modifierExceptions)) found.push(line)
    }
  }
  if (found.length > 1) found.sort((left, right) => index.position.get(left)! - index.position.get(right)!)
  return found
}

function linesForScope(rule: BillingRule, input: BillingCase): readonly BillingLine[] | BillingReason {
  const scope = rule.parameters.countingScope as BillingCountingScope | undefined
  const index = caseLines(input)
  if (scope === undefined) return index.all
  const key = `${scope.window} ${scope.subject}`
  let lines = index.scopes.get(key)
  if (lines === undefined) {
    const windows = (input.countingWindows ?? []).filter((window) => matchesScope(window.scope, scope))
    if (windows.length !== 1) lines = windows.length
    else {
      const lineIds = new Set(windows[0]!.lineIds)
      lines = input.lines.filter((line) => lineIds.has(line.id))
    }
    index.scopes.set(key, lines)
  }
  if (typeof lines === 'number') return { code: 'COUNTING_SCOPE_UNAVAILABLE', ruleId: rule.id, details: { window: scope.window, subject: scope.subject } }
  return lines
}

function reviewFinding(code: BillingReason['code'], rule: BillingRule, details?: BillingReason['details']): RuleFinding {
  return { reason: { code, ruleId: rule.id, ...(details ? { details } : {}) }, effect: 'needs-review' }
}

type FactPrimitive = string | number | boolean | null
type Polarity = 'include' | 'exclude'

/** A supplied value the engine cannot read as the shape its predicate requires. */
const UNANSWERABLE = Symbol('unanswerable')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFactPrimitive(value: unknown): value is FactPrimitive {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function factValues(value: unknown): readonly FactPrimitive[] | typeof UNANSWERABLE {
  if (isFactPrimitive(value)) return [value]
  if (Array.isArray(value) && value.every(isFactPrimitive)) return value
  return UNANSWERABLE
}

function alternationMatches(values: readonly FactPrimitive[], valueIn: readonly FactPrimitive[]): boolean {
  return values.some((value) => valueIn.some((admissible) => Object.is(value, admissible)))
}

interface CodedEntry {
  code: string
  system?: string
  qualifiers: Readonly<Record<string, FactPrimitive>>
}

function codedEntry(value: unknown): CodedEntry | undefined {
  if (typeof value === 'string' && value) return { code: value, qualifiers: {} }
  if (!isRecord(value) || typeof value.code !== 'string' || !value.code) return undefined
  const qualifiers: Record<string, FactPrimitive> = {}
  for (const [key, member] of Object.entries(value)) {
    if (key === 'code' || key === 'system' || !isFactPrimitive(member)) continue
    qualifiers[key] = member
  }
  return { code: value.code, ...(typeof value.system === 'string' && value.system ? { system: value.system } : {}), qualifiers }
}

/** Per member, so one unreadable sibling cannot discard a readable entry's verdict. */
function codedEntries(value: unknown): readonly (CodedEntry | undefined)[] {
  return (Array.isArray(value) ? value : [value]).map(codedEntry)
}

interface ProviderEntry {
  group: string
  member?: string
}

function providerEntry(value: unknown): ProviderEntry | undefined {
  if (typeof value === 'string' && value) return { group: value }
  if (!isRecord(value) || typeof value.group !== 'string' || !value.group) return undefined
  return { group: value.group, ...(typeof value.member === 'string' && value.member ? { member: value.member } : {}) }
}

function providerEntries(value: unknown): readonly (ProviderEntry | undefined)[] {
  return (Array.isArray(value) ? value : [value]).map(providerEntry)
}

interface CodedMember {
  code: string
  qualifiers?: Readonly<Record<string, readonly FactPrimitive[]>>
}

interface CodedPredicate {
  fact: string
  system?: string
  polarity: Polarity
  valueIn: readonly (string | CodedMember)[]
}

/**
 * Entry-verdict rule, shared by every predicate that reads a list of case entries.
 *
 * An entry contributes a decision, an ambiguity, or nothing. A definite mismatch on any conjunctive
 * constraint makes the entry a decidable non-match, so it can never be an ambiguity. An ambiguity is
 * recorded only when the missing information could still change that entry's verdict, and a recorded
 * ambiguity is emitted only when no entry matched fully.
 *
 * Shared coded-fact algorithm behind procedure-finding-requirement and diagnosis-requirement.
 * Each admissible member constrains only the entry carrying its own code, so heterogeneous
 * per-code qualifier combinations stay correlated instead of collapsing into one global set.
 * Entries are read in the order the case supplies them, and the first recorded ambiguity wins.
 */
function evaluateCodedPredicate(
  rule: BillingRule,
  input: BillingCase,
  lines: readonly BillingLine[],
  predicate: CodedPredicate,
  notSatisfied: BillingReason['code'],
  indeterminate: BillingReason['code'],
): RuleFinding[] {
  const fact = resolveFact(input, predicate.fact)
  if (!fact.available) return [reviewFinding(indeterminate, rule, { fact: predicate.fact })]
  const entries = fact.value === undefined ? [] : codedEntries(fact.value)
  const admissible = new Map(predicate.valueIn.map((member) => typeof member === 'string' ? [member, {} as Readonly<Record<string, readonly FactPrimitive[]>>] : [member.code, member.qualifiers ?? {}]))
  let matched = false
  // Every entry with an admissible code that did not definitively mismatch: matched or ambiguous.
  const implicated: CodedEntry[] = []
  let ambiguity: BillingReason['details'] | undefined
  for (const entry of entries) {
    if (entry === undefined) {
      ambiguity ??= { fact: predicate.fact }
      continue
    }
    const qualifiers = admissible.get(entry.code)
    if (qualifiers === undefined) continue
    const names = Object.keys(qualifiers).sort()
    const systemMismatch = predicate.system !== undefined && entry.system !== undefined && entry.system !== predicate.system
    const qualifierMismatch = names.some((name) => Object.hasOwn(entry.qualifiers, name) && !alternationMatches([entry.qualifiers[name]!], qualifiers[name]!))
    if (systemMismatch || qualifierMismatch) continue
    implicated.push(entry)
    if (predicate.system !== undefined && entry.system === undefined) {
      ambiguity ??= { fact: predicate.fact, code: entry.code }
      continue
    }
    const unanswered = names.find((name) => !Object.hasOwn(entry.qualifiers, name))
    if (unanswered !== undefined) {
      ambiguity ??= { fact: predicate.fact, qualifier: unanswered }
      continue
    }
    matched = true
  }
  if (!matched && ambiguity !== undefined) return [reviewFinding(indeterminate, rule, ambiguity)]
  const violated = predicate.polarity === 'include' ? !matched : matched
  if (!violated) return []
  // include: any admissible member, with one of its qualifier values, satisfies the rule;
  // exclude: the present entries that matched or could have matched caused the block.
  const system = predicate.system !== undefined ? { system: predicate.system } : {}
  const resolution = (): BillingReasonResolution | undefined => predicate.polarity === 'include'
    ? blockResolution(rule, 'add-one-of', predicate.valueIn.map((member) => typeof member === 'string'
      ? { ...system, code: member }
      : { ...system, code: member.code, ...(member.qualifiers !== undefined && Object.keys(member.qualifiers).length > 0 ? { qualifiers: member.qualifiers } : {}) }))
    : blockResolution(rule, 'remove', implicated.map((entry) => ({ ...(entry.system !== undefined ? { system: entry.system } : {}), code: entry.code })))
  return lines.map((line) => ({ reason: reason(notSatisfied, rule, line, { fact: predicate.fact, polarity: predicate.polarity }, resolution()), effect: rule.effect }))
}

function evaluateRule(rule: BillingRule, input: BillingCase): RuleFinding[] {
  const modifierExceptions = rule.parameters.modifierExceptions as readonly string[] | undefined
  const applicable = selectedLines(rule, input, modifierExceptions)
  if (applicable.length === 0) return []
  const scoped = linesForScope(rule, input)
  if (!Array.isArray(scoped)) return [{ reason: scoped as BillingReason, effect: 'needs-review' }]
  // Without a counting scope the scoped lines are the case lines, so the selected lines are those found above.
  const lines = rule.parameters.countingScope === undefined ? applicable : scoped.filter((line) => selectorMatches(line, rule.parameters) && !modifierExempts(line, modifierExceptions))
  if (lines.length === 0) return []
  const lineScoped = lineScopedFact(rule)
  if (lineScoped !== undefined) {
    const perLine = evaluatePerLine(rule, input, lines, scoped, lineScoped)
    if (perLine !== undefined) return perLine
  }
  return evaluateLines(rule, input, lines, scoped)
}

/** The rule's `requiredFacts` and `exceptWhen` gates, then its class, over the given lines and facts. */
function evaluateLines(rule: BillingRule, input: BillingCase, lines: readonly BillingLine[], scoped: readonly BillingLine[]): RuleFinding[] {
  for (const factName of rule.requiredFacts ?? []) {
    if (!resolveFact(input, factName).available) return [reviewFinding('REQUIRED_FACT_UNAVAILABLE', rule, { fact: factName })]
  }
  const exception = rule.parameters.exceptWhen as { fact: string; valueIn: readonly unknown[] } | undefined
  if (exception !== undefined) {
    const fact = resolveFact(input, exception.fact)
    if (!fact.available) return [reviewFinding('RULE_EXCEPTION_UNAVAILABLE', rule, { fact: exception.fact })]
    if (exception.valueIn.some((value) => Object.is(value, fact.value))) return []
  }
  return evaluateClass(rule, input, lines, scoped)
}

/** The classes that decide each line on one named fact, and that fact: they read line facts. */
const LINE_SCOPED_FACTS: Readonly<Partial<Record<string, (parameters: Record<string, unknown>) => string>>> = {
  'patient-attribute-constraint': (parameters) => String(parameters.attribute),
  'setting-constraint': (parameters) => String(parameters.setting),
  'prior-authorization-required': (parameters) => (parameters.grant as { fact: string }).fact,
  'diagnosis-requirement': (parameters) => (parameters.diagnosis as { fact: string }).fact,
  'provider-eligibility': (parameters) => (parameters.provider as { fact: string }).fact,
  'accompanying-information-required': (parameters) => (parameters.information as { fact: string }).fact,
}

function lineScopedFact(rule: BillingRule): string | undefined {
  return LINE_SCOPED_FACTS[rule.class]?.(rule.parameters)
}

const NOT_SUPPLIED: BillingFact = { kind: 'billing-fact', state: 'not-supplied' }

/**
 * The value a line states for the fact a line-scoped rule reads, or `undefined` when the line states
 * none and the case fact applies. For `accompanying-information-required`, a line carrying
 * `information` states every name: one it lacks is not supplied for that line, whatever the case or
 * another line states.
 */
function lineFactValue(rule: BillingRule, line: BillingLine, name: string): BillingFactValue | undefined {
  if (rule.class === 'accompanying-information-required' && line.information !== undefined) {
    return Object.hasOwn(line.information, name) ? line.information[name]! : NOT_SUPPLIED
  }
  return line.facts !== undefined && Object.hasOwn(line.facts, name) ? line.facts[name]! : undefined
}

/**
 * Evaluates a line-scoped rule line by line when any of its lines states its own value for a fact the
 * rule reads: the class fact, a `requiredFacts` name or the `exceptWhen` fact. Each such line is
 * evaluated alone, gates included, with its values in place of the case facts, and a finding without
 * a line names it; the other lines are evaluated together on the case facts. Returns `undefined` when
 * no line states a value, so the rule is evaluated exactly as before. Findings keep the order of
 * their lines.
 */
function evaluatePerLine(rule: BillingRule, input: BillingCase, lines: readonly BillingLine[], scoped: readonly BillingLine[], name: string): RuleFinding[] | undefined {
  const exception = rule.parameters.exceptWhen as { fact: string } | undefined
  const gates = [...(rule.requiredFacts ?? []), ...(exception !== undefined ? [exception.fact] : [])]
  const overlays = lines.map((line) => {
    const overlay: Record<string, BillingFactValue> = {}
    for (const gate of gates) {
      if (line.facts !== undefined && Object.hasOwn(line.facts, gate)) overlay[gate] = line.facts[gate]!
    }
    const value = lineFactValue(rule, line, name)
    if (value !== undefined) overlay[name] = value
    return Object.keys(overlay).length > 0 ? overlay : undefined
  })
  if (overlays.every((overlay) => overlay === undefined)) return undefined
  const caseLines = lines.filter((_, index) => overlays[index] === undefined)
  const output: RuleFinding[] = caseLines.length > 0 ? evaluateLines(rule, input, caseLines, scoped) : []
  for (const [index, line] of lines.entries()) {
    const overlay = overlays[index]
    if (overlay === undefined) continue
    const own = evaluateLines(rule, { ...input, facts: { ...input.facts, ...overlay } }, [line], scoped)
    output.push(...own.map((finding) => finding.reason.lineId !== undefined ? finding : { ...finding, reason: { ...finding.reason, lineId: line.id } }))
  }
  const order = new Map(lines.map((line, index) => [line.id, index]))
  return output
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => (order.get(left.finding.reason.lineId ?? '') ?? -1) - (order.get(right.finding.reason.lineId ?? '') ?? -1) || left.index - right.index)
    .map((entry) => entry.finding)
}

function evaluateClass(rule: BillingRule, input: BillingCase, lines: readonly BillingLine[], scoped: readonly BillingLine[]): RuleFinding[] {
  const parameters = rule.parameters
  const findings = (reasons: BillingReason[], effect: BillingRule['effect'] = rule.effect): RuleFinding[] => reasons.map((item) => ({ reason: item, effect }))
  switch (rule.class) {
    case 'quantity-limit': {
      const maximum = Number(parameters.maximum)
      if (parameters.countingScope !== undefined) return lines.reduce((total, line) => total + line.quantity, 0) > maximum ? findings(lines.map((line) => reason('QUANTITY_CAP_EXCEEDED', rule, line))) : []
      return findings(lines.filter((line) => line.quantity > maximum).map((line) => reason('QUANTITY_CAP_EXCEEDED', rule, line)))
    }
    case 'value-limit': {
      const maximum = decimalMinor(String(parameters.maximum))
      // A line with an unknown unit price is never compared: its amount is unknown, not zero.
      const output: RuleFinding[] = []
      for (const line of lines) {
        if (line.unitPrice === undefined) output.push({ reason: reason('UNIT_PRICE_UNAVAILABLE', rule, line), effect: 'needs-review' })
        else if (decimalMinor(line.unitPrice.value) * BigInt(Math.trunc(line.quantity)) > maximum) output.push({ reason: reason('VALUE_CAP_APPLICABLE', rule, line), effect: rule.effect })
      }
      return output
    }
    case 'mutual-exclusion': {
      const excluded = parameters.excluded as { system?: string; codes: string[] }
      const conflicting = scoped.filter((line) => (excluded.system === undefined || excluded.system === line.code.system) && excluded.codes.includes(line.code.code))
      // The presence check includes the reason's own line, so an own line that is itself excluded is
      // resolved only by removing it; otherwise removing every other conflicting line resolves it.
      const resolution = (own: BillingLine) => {
        const remove = conflicting.some((line) => line.id === own.id) ? [own] : conflicting
        return blockResolution(rule, 'remove', remove.map((line) => ({ system: line.code.system, code: line.code.code, lineId: line.id })))
      }
      return conflicting.length > 0 ? findings(lines.map((line) => reason('MUTUALLY_EXCLUSIVE_CODE_PRESENT', rule, line, undefined, resolution(line)))) : []
    }
    case 'companion-required': {
      const required = parameters.required as { system?: string; codes: string[] }
      const present = scoped.some((line) => (required.system === undefined || required.system === line.code.system) && required.codes.includes(line.code.code))
      return present ? [] : findings(lines.map((line) => reason('COMPANION_CODE_REQUIRED', rule, line, undefined, blockResolution(rule, 'add-one-of', selectorCodes(required)))))
    }
    case 'bounded-multiplier': {
      const minimum = Number(parameters.minimum)
      // An absent maximum leaves the multiplier without an upper bound.
      const maximum = parameters.maximum === undefined ? undefined : Number(parameters.maximum)
      const output: RuleFinding[] = []
      for (const line of lines) {
        const actual = line.actualMultiplier ?? line.multiplier
        if (actual === undefined) {
          output.push({ reason: reason('ACTUAL_MULTIPLIER_UNAVAILABLE', rule, line), effect: 'needs-review' })
          continue
        }
        if (actual < minimum || (maximum !== undefined && actual > maximum)) {
          output.push({ reason: reason('MULTIPLIER_OUT_OF_BOUNDS', rule, line), effect: rule.effect })
          continue
        }
        const threshold = parameters.standardThreshold as number | undefined
        if (threshold !== undefined && actual > threshold) {
          const waiver = parameters.justificationWaivesThreshold === true
          // A justification decides a line above the threshold on its own, so the agreement fact is not consulted.
          if (waiver && line.multiplierJustified === true) continue
          const override = parameters.agreementOverride as { fact: string; valueIn: readonly unknown[] } | undefined
          if (override !== undefined) {
            const fact = resolveFact(input, override.fact)
            if (!fact.available) {
              output.push({ reason: reason('AGREEMENT_OVERRIDE_UNAVAILABLE', rule, line), effect: 'needs-review' })
              continue
            }
            if (override.valueIn.some((value) => Object.is(value, fact.value))) continue
          }
          if (waiver) {
            output.push({ reason: reason('MULTIPLIER_JUSTIFICATION_REQUIRED', rule, line), effect: parameters.aboveThresholdEffect as BillingRule['effect'] })
            continue
          }
          output.push({ reason: reason('MULTIPLIER_THRESHOLD_EXCEEDED', rule, line), effect: parameters.aboveThresholdEffect as BillingRule['effect'] })
        }
      }
      return output
    }
    case 'accompanying-information-required': {
      const information = parameters.information as { kind: string; fact: string; valueIn?: readonly string[] }
      const fact = resolveFact(input, information.fact)
      if (!fact.available) return [reviewFinding('REQUIRED_FACT_UNAVAILABLE', rule, { fact: information.fact })]
      const required = () => findings(lines.map((line) => reason('ACCOMPANYING_INFORMATION_REQUIRED', rule, line, { kind: information.kind })))
      if (fact.value === undefined) return required()
      if (information.valueIn === undefined) return []
      const values = factValues(fact.value)
      if (values === UNANSWERABLE) return [reviewFinding('ACCOMPANYING_INFORMATION_INDETERMINATE', rule, { fact: information.fact })]
      return alternationMatches(values, information.valueIn) ? [] : required()
    }
    case 'patient-attribute-constraint': {
      const attribute = String(parameters.attribute)
      const fact = resolveFact(input, attribute)
      if (!fact.available) return [reviewFinding('REQUIRED_FACT_UNAVAILABLE', rule, { fact: attribute })]
      const predicate = parameters.predicate as { valueIn?: readonly FactPrimitive[]; minimum?: number; maximum?: number; unit?: string }
      const mismatch = () => findings(lines.map((line) => reason('PATIENT_ATTRIBUTE_MISMATCH', rule, line)))
      if (predicate.valueIn !== undefined) {
        if (fact.value === undefined) return [reviewFinding('PATIENT_ATTRIBUTE_INDETERMINATE', rule, { attribute })]
        const values = factValues(fact.value)
        if (values === UNANSWERABLE) return [reviewFinding('PATIENT_ATTRIBUTE_INDETERMINATE', rule, { attribute })]
        return alternationMatches(values, predicate.valueIn) ? [] : mismatch()
      }
      const boundUnit = String(predicate.unit)
      const quantity = boundQuantity(fact.value, boundUnit)
      if (quantity === undefined) return [reviewFinding('PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE', rule, { attribute, ...(Array.isArray(fact.value) ? { boundUnit } : {}) })]
      const factUnit = quantity.unit
      for (const [bound, isLowerBound] of [[predicate.minimum, true], [predicate.maximum, false]] as const) {
        if (bound === undefined) continue
        const comparison = compareUnitBearingValues({ value: bound, unit: boundUnit }, { value: quantity.value, unit: factUnit })
        if (comparison === 'uninterpretable') return [reviewFinding('PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE', rule, { attribute, boundUnit, factUnit })]
        if (isLowerBound ? comparison > 0 : comparison < 0) return mismatch()
      }
      return []
    }
    case 'contract-participation':
      return input.contracts?.includes(String(parameters.contract)) ? [] : findings(lines.map((line) => reason('CONTRACT_PARTICIPATION_REQUIRED', rule, line)))
    case 'contract-code-list': {
      const permitted = parameters.permitted as { system?: string; codes: readonly string[] }
      const listed = (line: BillingLine) => (permitted.system === undefined || permitted.system === line.code.system) && permitted.codes.includes(line.code.code)
      return findings(lines.filter((line) => !listed(line)).map((line) => reason('CONTRACT_CODE_NOT_PERMITTED', rule, line)))
    }
    case 'setting-constraint': {
      const setting = String(parameters.setting)
      const predicate = parameters.predicate as { polarity: Polarity; valueIn: readonly FactPrimitive[] }
      const fact = resolveFact(input, setting)
      if (!fact.available || fact.value === undefined) return [reviewFinding('SETTING_INDETERMINATE', rule, { fact: setting })]
      const values = factValues(fact.value)
      if (values === UNANSWERABLE) return [reviewFinding('SETTING_INDETERMINATE', rule, { fact: setting })]
      const present = alternationMatches(values, predicate.valueIn)
      const violated = predicate.polarity === 'include' ? !present : present
      return violated ? findings(lines.map((line) => reason('SETTING_NOT_PERMITTED', rule, line, { setting, polarity: predicate.polarity }))) : []
    }
    case 'prior-authorization-required': {
      const authorization = String(parameters.authorization)
      const grant = parameters.grant as { fact: string; valueIn: readonly FactPrimitive[] }
      const fact = resolveFact(input, grant.fact)
      if (!fact.available) return [reviewFinding('PRIOR_AUTHORIZATION_INDETERMINATE', rule, { fact: grant.fact })]
      let granted = false
      if (fact.value !== undefined) {
        const values = factValues(fact.value)
        if (values === UNANSWERABLE) return [reviewFinding('PRIOR_AUTHORIZATION_INDETERMINATE', rule, { fact: grant.fact })]
        granted = alternationMatches(values, grant.valueIn)
      }
      return granted ? [] : findings(lines.map((line) => reason('PRIOR_AUTHORIZATION_REQUIRED', rule, line, { authorization })))
    }
    case 'procedure-finding-requirement':
      return evaluateCodedPredicate(rule, input, lines, parameters.procedure as CodedPredicate, 'PROCEDURE_FINDING_NOT_SATISFIED', 'PROCEDURE_FINDING_INDETERMINATE')
    case 'diagnosis-requirement':
      return evaluateCodedPredicate(rule, input, lines, parameters.diagnosis as CodedPredicate, 'DIAGNOSIS_NOT_SATISFIED', 'DIAGNOSIS_INDETERMINATE')
    case 'provider-eligibility': {
      const provider = parameters.provider as { fact: string; polarity: Polarity; qualifications: readonly { group: string; members?: readonly string[] }[] }
      const fact = resolveFact(input, provider.fact)
      // A cause the unavailable fact names is kept as a distinct detail, so a consumer can count each one.
      if (!fact.available) return [reviewFinding('PROVIDER_ELIGIBILITY_INDETERMINATE', rule, { fact: provider.fact, ...(fact.cause !== undefined ? { cause: fact.cause } : {}) })]
      const entries = fact.value === undefined ? [] : providerEntries(fact.value)
      // Same entry-verdict rule as evaluateCodedPredicate: a member outside the declared members is
      // a decidable non-match, only an absent member is ambiguous, and an entry that matches some
      // qualification records no ambiguity because the missing member cannot change its verdict.
      let matched = false
      let ambiguity: BillingReason['details'] | undefined
      for (const entry of entries) {
        if (entry === undefined) {
          ambiguity ??= { fact: provider.fact }
          continue
        }
        let entryMatched = false
        let entryAmbiguity: BillingReason['details'] | undefined
        for (const qualification of provider.qualifications) {
          if (entry.group !== qualification.group) continue
          if (qualification.members === undefined) { entryMatched = true; continue }
          if (entry.member === undefined) entryAmbiguity ??= { fact: provider.fact, group: qualification.group }
          else if (qualification.members.includes(entry.member)) entryMatched = true
        }
        if (entryMatched) matched = true
        else if (entryAmbiguity !== undefined) ambiguity ??= entryAmbiguity
      }
      if (!matched && ambiguity !== undefined) return [reviewFinding('PROVIDER_ELIGIBILITY_INDETERMINATE', rule, ambiguity)]
      const violated = provider.polarity === 'include' ? !matched : matched
      return violated ? findings(lines.map((line) => reason('PROVIDER_NOT_ELIGIBLE', rule, line, { fact: provider.fact, polarity: provider.polarity }))) : []
    }
    case 'quota-degression': {
      const scopeAxes = parameters.scopeAxes as Readonly<Record<string, readonly FactPrimitive[]>> | undefined
      for (const axis of Object.keys(scopeAxes ?? {}).sort()) {
        const fact = resolveFact(input, axis)
        if (!fact.available) return [reviewFinding('QUOTA_DEGRESSION_INDETERMINATE', rule, { fact: axis })]
        const values = factValues(fact.value)
        if (values === UNANSWERABLE) return [reviewFinding('QUOTA_DEGRESSION_INDETERMINATE', rule, { fact: axis })]
        if (!alternationMatches(values, scopeAxes![axis]!)) return []
      }
      const threshold = parameters.threshold as { stated: boolean; quantity?: number }
      const adjustment = parameters.adjustment as { stated: boolean; factor?: string }
      const unstated: RuleFinding[] = []
      if (!threshold.stated) unstated.push(reviewFinding('QUOTA_PARAMETER_UNAVAILABLE', rule, { parameter: 'threshold' }))
      if (!adjustment.stated) unstated.push(reviewFinding('QUOTA_PARAMETER_UNAVAILABLE', rule, { parameter: 'adjustment' }))
      if (unstated.length > 0) return unstated
      const maximum = Number(threshold.quantity)
      const applicable = findings(lines.map((line) => reason('QUOTA_DEGRESSION_APPLICABLE', rule, line, { factor: String(adjustment.factor) })))
      if (parameters.countingScope !== undefined) return lines.reduce((total, line) => total + line.quantity, 0) > maximum ? applicable : []
      return findings(lines.filter((line) => line.quantity > maximum).map((line) => reason('QUOTA_DEGRESSION_APPLICABLE', rule, line, { factor: String(adjustment.factor) })))
    }
    case 'minimum-evidence-count': {
      const minimum = parameters.minimum as number
      const sources = parameters.sources as readonly MinimumEvidenceSource[]
      let rawCount = 0
      let creditedCount = 0
      let firstUnavailableFact: string | undefined
      for (const source of sources) {
        const fact = resolveFact(input, source.fact)
        if (!fact.available) {
          firstUnavailableFact ??= source.fact
          continue
        }
        const raw = fact.value === undefined ? 0 : fact.value
        if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) throw new BillingInputError(`Evidence fact ${source.fact} must be a non-negative safe integer.`)
        if (rawCount > Number.MAX_SAFE_INTEGER - raw) throw new BillingInputError('Evidence raw count exceeds the safe integer range.')
        rawCount += raw
        if (raw > Math.floor(Number.MAX_SAFE_INTEGER / source.credit)) throw new BillingInputError(`Evidence fact ${source.fact} credited product exceeds the safe integer range.`)
        const product = raw * source.credit
        const contribution = Math.min(product, source.maximumCredit ?? product)
        if (creditedCount > Number.MAX_SAFE_INTEGER - contribution) throw new BillingInputError('Evidence credited count exceeds the safe integer range.')
        creditedCount += contribution
      }
      if (firstUnavailableFact !== undefined) return [reviewFinding('MINIMUM_EVIDENCE_INDETERMINATE', rule, { fact: firstUnavailableFact })]
      return creditedCount >= minimum ? [] : findings(lines.map((line) => reason('MINIMUM_EVIDENCE_NOT_MET', rule, line, { minimum, rawCount, creditedCount })))
    }
    default:
      return []
  }
}

/**
 * Names the producing rule's provenance on each of its findings, as the rule states it. Provenance is
 * informative: it is attached after evaluation and never changes an outcome, a code or a detail.
 */
function attributed(rule: BillingRule, findings: readonly RuleFinding[]): RuleFinding[] {
  const provenance = rule.provenance
  if (provenance === undefined) return [...findings]
  return findings.map((finding) => ({ ...finding, reason: { ...finding.reason, sources: provenance.sources, evidenceLevel: provenance.evidenceLevel } }))
}

/** The result plus every axis reason with the effect that routed it; withheld admission reasons are `needs-review`. */
interface CaseEvaluation {
  result: BillingResult
  findings: readonly RuleFinding[]
}

function evaluateCase(compiled: CompiledRuleSet, input: BillingCase): CaseEvaluation {
  validateCase(input)
  const admissionReasons = [...compiled.withheldReasons]
  for (const edition of [compiled.admission.catalog, compiled.admission.ruleSet]) {
    if (edition.effectiveStart !== undefined && input.asOf < edition.effectiveStart) admissionReasons.push({ code: 'EDITION_UNAVAILABLE' })
    if (edition.effectiveEnd !== undefined && input.asOf > edition.effectiveEnd) admissionReasons.push({ code: 'EDITION_EXPIRED' })
  }
  if (admissionReasons.length > 0) {
    return {
      result: { outcome: 'needs-review', reason: admissionReasons[0]!, axisReasons: admissionReasons, evaluatedRuleIds: [], engineVersion: BILLING_ENGINE_VERSION },
      findings: admissionReasons.map((item) => ({ reason: item, effect: 'needs-review' })),
    }
  }
  const activeRules = compiled.rules.filter((rule) => (rule.effectiveStart === undefined || input.asOf >= rule.effectiveStart) && (rule.effectiveEnd === undefined || input.asOf <= rule.effectiveEnd))
  // The line index serves this evaluation only: a caller may change the case before evaluating it again.
  CASE_LINES.delete(input)
  let evaluated: RuleFinding[]
  try {
    evaluated = activeRules.flatMap((rule) => attributed(rule, evaluateRule(rule, input)))
  } finally {
    CASE_LINES.delete(input)
  }
  const rejecting = evaluated.filter((finding) => finding.effect === 'reject')
  const review = evaluated.filter((finding) => finding.effect === 'needs-review')
  const outcome = rejecting.length > 0 ? 'rejected' : review.length > 0 ? 'needs-review' : 'accepted'
  // A partial edition is admitted, so only its decoded rules were checked: say so on a decided result.
  const partial = compiled.admission.catalog.completeness === 'partial' || compiled.admission.ruleSet.completeness === 'partial'
  return {
    result: {
      outcome,
      reason: outcome === 'accepted' ? { code: 'ELIGIBLE' } : outcome === 'rejected' ? { code: 'RULE_REJECTED' } : review[0]!.reason,
      axisReasons: [...rejecting, ...review].map((finding) => finding.reason),
      ...(partial && outcome !== 'needs-review' ? { advisories: [{ code: 'CATALOG_PARTIAL', details: { edition: compiled.admission.catalog.edition } }] } : {}),
      evaluatedRuleIds: activeRules.map((rule) => rule.id),
      engineVersion: BILLING_ENGINE_VERSION,
    },
    findings: [...rejecting, ...review],
  }
}

export function evaluateBillingCase(compiled: CompiledRuleSet, input: BillingCase): BillingResult {
  return evaluateCase(compiled, input).result
}

/** One reason of a result with the effect the engine gave it: `reject` blocks, `needs-review` leaves the case undecided. */
export interface BillingFinding {
  readonly reason: BillingReason
  readonly effect: 'reject' | 'needs-review'
}

/**
 * {@link evaluateBillingCase} with the effect of each reason. A rule's finding does not always carry
 * the rule's `effect` (for example `ACTUAL_MULTIPLIER_UNAVAILABLE` of a rejecting rule, or a
 * `bounded-multiplier` finding above `standardThreshold` with `aboveThresholdEffect`), so a caller
 * that combines several results reads the effect here instead of inferring it. Admission reasons
 * are `needs-review` findings. `result` is exactly what `evaluateBillingCase` returns.
 */
export function evaluateBillingCaseFindings(compiled: CompiledRuleSet, input: BillingCase): { result: BillingResult; findings: readonly BillingFinding[] } {
  const { result, findings } = evaluateCase(compiled, input)
  return { result, findings: findings.map((finding) => ({ reason: finding.reason, effect: finding.effect })) }
}

export interface EvaluateConformanceCasesInput {
  /** A rule-set `Library` carrier (decoded and digest-checked) or a bare `BillingRuleSet` payload. */
  ruleSet: unknown
  /** Cases in input order; an unreadable case becomes an `unavailable` record instead of aborting the run. */
  cases: readonly unknown[]
}

interface StandaloneRuleSet {
  payload: BillingRuleSet
  identity: BillingConformanceRuleSetIdentity
  effectivePeriod?: { start: string; end?: string }
}

function loadStandaloneRuleSet(input: unknown): StandaloneRuleSet {
  if (isRecord(input) && input.resourceType === 'Library') {
    const decoded = decodeBillingLibrary(input)
    if (decoded.kind !== 'rule-set') throw new BillingInputError(`Library artifact-kind ${decoded.kind} is not a rule set.`)
    return {
      payload: decoded.payload,
      identity: {
        id: decoded.payload.id,
        digest: decoded.digest,
        canonical: decoded.url,
        version: decoded.version,
        ...(decoded.publisher === undefined ? {} : { publisher: decoded.publisher }),
      },
      ...(decoded.effectivePeriod ? { effectivePeriod: decoded.effectivePeriod } : {}),
    }
  }
  // The same strict payload decoding as the rule-set Library codec, without a declared digest to check.
  const payload = decodeBillingRuleSet(input)
  return { payload, identity: { id: payload.id, digest: billingRuleSetDigest(payload) } }
}

/** Standalone admission: the given rule set is its own admitted, complete edition; no tenant or catalog decides. */
function standaloneAdmission(ruleSet: StandaloneRuleSet): AdmissionState {
  const edition = { digest: ruleSet.identity.digest, availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true } as const
  return {
    status: 'admitted',
    catalog: { edition: 'standalone', ...edition },
    ruleSet: {
      edition: ruleSet.payload.id,
      ...edition,
      ...(ruleSet.effectivePeriod ? { effectiveStart: ruleSet.effectivePeriod.start } : {}),
      ...(ruleSet.effectivePeriod?.end ? { effectiveEnd: ruleSet.effectivePeriod.end } : {}),
    },
  }
}

/** Shape check ahead of validateCase, so a JSON case of the wrong shape yields a typed message rather than a runtime TypeError. */
function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function assertCaseShape(input: Record<string, unknown>): void {
  if (typeof input.id !== 'string') throw new BillingInputError('Case id must be a string.')
  if (typeof input.asOf !== 'string') throw new BillingInputError('Case asOf must be a string.')
  if (!isRecord(input.facts)) throw new BillingInputError('Case facts must be an object.')
  if (!Array.isArray(input.lines)) throw new BillingInputError('Case lines must be an array.')
  for (const [index, line] of input.lines.entries()) {
    const unknownPrice = isRecord(line) && line.unitPriceUnknown === true && line.unitPrice === undefined
    if (!isRecord(line) || typeof line.id !== 'string' || !isRecord(line.code) || (!unknownPrice && !isRecord(line.unitPrice))) {
      throw new BillingInputError(`Case line ${index} must be an object with a string id, a code and a unitPrice or unitPriceUnknown true.`)
    }
    if (typeof line.code.system !== 'string' || typeof line.code.code !== 'string' || (!unknownPrice && (typeof (line.unitPrice as Record<string, unknown>).value !== 'string' || typeof (line.unitPrice as Record<string, unknown>).currency !== 'string'))) {
      throw new BillingInputError(`Case line ${index} code and unitPrice must carry strings.`)
    }
    if (typeof line.quantity !== 'number') throw new BillingInputError(`Case line ${index} quantity must be a number.`)
    for (const key of ['actualMultiplier', 'multiplier'] as const) {
      if (line[key] !== undefined && typeof line[key] !== 'number') throw new BillingInputError(`Case line ${index} ${key} must be a number.`)
    }
    for (const key of ['modifiers', 'annotations'] as const) {
      if (line[key] !== undefined && !isStringArray(line[key])) throw new BillingInputError(`Case line ${index} ${key} must be an array of strings.`)
    }
    for (const key of ['facts', 'information'] as const) {
      if (line[key] !== undefined && !isRecord(line[key])) throw new BillingInputError(`Case line ${index} ${key} must be an object.`)
    }
  }
  if (input.countingWindows !== undefined) {
    if (!Array.isArray(input.countingWindows)) throw new BillingInputError('Case countingWindows must be an array.')
    for (const window of input.countingWindows) {
      if (!isRecord(window) || !isRecord(window.scope) || typeof window.scope.window !== 'string' || typeof window.scope.subject !== 'string' || !isStringArray(window.lineIds)) {
        throw new BillingInputError('Case counting windows require a scope with window and subject and a lineIds array of strings.')
      }
    }
  }
  if (input.contracts !== undefined && !isStringArray(input.contracts)) {
    throw new BillingInputError('Case contracts must be an array of strings.')
  }
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  return left < right ? -1 : 1
}

function compareFindings(left: BillingConformanceFinding, right: BillingConformanceFinding): number {
  return compareOptional(left.ruleId, right.ruleId)
    || compareOptional(left.lineId, right.lineId)
    || compareOptional(left.code, right.code)
    || compareOptional(left.details === undefined ? undefined : canonicalizeJson(left.details), right.details === undefined ? undefined : canonicalizeJson(right.details))
}

function conformanceFinding(finding: RuleFinding): BillingConformanceFinding {
  const { code, ruleId, lineId, details, resolution, sources, evidenceLevel } = finding.reason
  return {
    code,
    ...(ruleId !== undefined ? { ruleId } : {}),
    ...(lineId !== undefined ? { lineId } : {}),
    effect: finding.effect,
    ...(details !== undefined ? { details } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(sources !== undefined ? { sources } : {}),
    ...(evidenceLevel !== undefined ? { evidenceLevel } : {}),
  }
}

const CONFORMANCE_DECISIONS: Readonly<Record<BillingResult['outcome'], BillingConformanceDecision>> = { accepted: 'allow', rejected: 'block', 'needs-review': 'unavailable' }

/**
 * Evaluates one rule set on synthetic cases without a FHIR server, a catalog edition or a tenant.
 * A malformed, digest-mismatched or unsupported rule set throws before any record; a case the engine
 * cannot read yields an `unavailable` record with `BILLING_INPUT_INVALID`, and the run continues.
 */
export function evaluateConformanceCases(input: EvaluateConformanceCasesInput): readonly BillingConformanceRecord[] {
  const ruleSet = loadStandaloneRuleSet(input.ruleSet)
  const compiled = compileRuleSet(ruleSet.payload, standaloneAdmission(ruleSet))
  const caseIds = input.cases.map((item, index) => isRecord(item) && typeof item.id === 'string' && item.id.trim() ? item.id : `#${index + 1}`)
  const seen = new Set<string>()
  for (const caseId of caseIds) {
    // A duplicate makes the records unkeyable for comparison, so it refuses the whole run, fallback ids included.
    if (seen.has(caseId)) throw new BillingInputError(`Cases contain duplicate caseId ${caseId}.`)
    seen.add(caseId)
  }
  const ignoredRuleIds = [...compiled.ignoredRuleIds].sort((left, right) => compareOptional(left, right))
  return deepFreeze(input.cases.map((item, index): BillingConformanceRecord => {
    const record = {
      format: BILLING_CONFORMANCE_FORMAT,
      mode: 'standalone',
      caseId: caseIds[index]!,
      ruleSet: { ...ruleSet.identity },
      engineVersion: BILLING_ENGINE_VERSION,
      ...(ignoredRuleIds.length > 0 ? { ignoredRuleIds: [...ignoredRuleIds] } : {}),
    } as const
    let evaluation: CaseEvaluation
    try {
      if (!isRecord(item)) throw new BillingInputError('Case must be an object.')
      assertCaseShape(item)
      evaluation = evaluateCase(compiled, item as unknown as BillingCase)
    } catch (error) {
      if (!(error instanceof BillingInputError)) throw error
      return { ...record, decision: 'unavailable', findings: [{ code: BILLING_CONFORMANCE_INPUT_INVALID, effect: 'needs-review', details: { message: error.message } }] }
    }
    const { result, findings } = evaluation
    return {
      ...record,
      decision: CONFORMANCE_DECISIONS[result.outcome],
      ...(result.advisories?.length ? { advisories: result.advisories } : {}),
      findings: findings.map(conformanceFinding).sort(compareFindings),
    }
  }))
}

function conformanceSide(input: unknown, label: string): { caseId: string; side: BillingConformanceSide } {
  if (!isRecord(input) || typeof input.caseId !== 'string' || !input.caseId) throw new BillingInputError(`${label} must be an object with a non-empty string caseId.`)
  const where = `${label} ${input.caseId}`
  const decision = input.decision
  if (decision !== 'allow' && decision !== 'block' && decision !== 'unavailable') throw new BillingInputError(`${where} decision must be allow, block or unavailable.`)
  if (!Array.isArray(input.findings)) throw new BillingInputError(`${where} findings must be an array.`)
  const pairs = new Map<string, BillingConformanceBlockingPair>()
  for (const finding of input.findings) {
    if (!isRecord(finding) || typeof finding.code !== 'string') throw new BillingInputError(`${where} findings must be objects with a string code.`)
    if (finding.effect !== 'reject' && finding.effect !== 'needs-review') throw new BillingInputError(`${where} finding effect must be reject or needs-review.`)
    // Another engine may spell an absent id as null.
    const ids: { ruleId?: string; lineId?: string } = {}
    for (const key of ['ruleId', 'lineId'] as const) {
      const value = finding[key]
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') throw new BillingInputError(`${where} finding ${key} must be a string or null.`)
      ids[key] = value
    }
    if (finding.effect !== 'reject') continue
    const pair: BillingConformanceBlockingPair = {
      ...(ids.lineId !== undefined ? { lineId: ids.lineId } : {}),
      ...(ids.ruleId !== undefined ? { ruleId: ids.ruleId } : {}),
    }
    pairs.set(canonicalizeJson([pair.lineId ?? null, pair.ruleId ?? null]), pair)
  }
  const blocking = [...pairs.values()].sort((left, right) => compareOptional(left.lineId, right.lineId) || compareOptional(left.ruleId, right.ruleId))
  return { caseId: input.caseId, side: { decision, blocking } }
}

function conformanceSides(records: readonly unknown[], label: string): Map<string, BillingConformanceSide> {
  const sides = new Map<string, BillingConformanceSide>()
  for (const [index, record] of records.entries()) {
    const { caseId, side } = conformanceSide(record, `${label} record ${index + 1}`)
    if (sides.has(caseId)) throw new BillingInputError(`${label} records contain duplicate caseId ${caseId}.`)
    sides.set(caseId, side)
  }
  return sides
}

/**
 * Compares two engines' conformance records case by case. A case disagrees when the decisions differ or
 * the sets of blocking `(lineId, ruleId)` pairs differ; reason codes, review findings and unknown
 * fields are not compared, so records of another engine are accepted. Differences are sorted by caseId.
 */
export function compareConformanceRecords(left: readonly unknown[], right: readonly unknown[]): readonly BillingConformanceDifference[] {
  const leftSides = conformanceSides(left, 'Left')
  const rightSides = conformanceSides(right, 'Right')
  const caseIds = [...new Set([...leftSides.keys(), ...rightSides.keys()])].sort((a, b) => compareOptional(a, b))
  const differences: BillingConformanceDifference[] = []
  for (const caseId of caseIds) {
    const leftSide = leftSides.get(caseId)
    const rightSide = rightSides.get(caseId)
    if (rightSide === undefined) {
      differences.push({ kind: 'left-only', caseId, left: leftSide! })
      continue
    }
    if (leftSide === undefined) {
      differences.push({ kind: 'right-only', caseId, right: rightSide })
      continue
    }
    const differs: ('decision' | 'blocking')[] = []
    if (leftSide.decision !== rightSide.decision) differs.push('decision')
    if (canonicalizeJson(leftSide.blocking) !== canonicalizeJson(rightSide.blocking)) differs.push('blocking')
    if (differs.length > 0) differences.push({ kind: 'disagree', caseId, differs, left: leftSide, right: rightSide })
  }
  return deepFreeze(differences)
}

export function toOracleParameters(fixture: OracleFixture, result: BillingResult): FhirParameters {
  const actualAxisReasons = result.axisReasons.map((axisReason) => axisReason.code)
  if (result.outcome !== fixture.expectedOutcome || result.reason.code !== fixture.expectedReason || JSON.stringify(actualAxisReasons) !== JSON.stringify(fixture.expectedAxisReasons)) {
    throw new BillingInputError(`Result does not match oracle fixture ${fixture.id}.`)
  }
  return {
    resourceType: 'Parameters',
    id: fixture.id,
    parameter: [
      { name: 'rule-set', valueString: canonicalizeJson(fixture.ruleSet) },
      { name: 'case', valueString: canonicalizeJson(fixture.case) },
      { name: 'expected-outcome', valueCode: fixture.expectedOutcome },
      { name: 'expected-reason', valueCoding: { system: BILLING_RULE_REASON_SYSTEM, code: fixture.expectedReason } },
      ...fixture.expectedAxisReasons.map((code) => ({ name: 'expected-axis-reason', valueCoding: { system: BILLING_RULE_REASON_SYSTEM, code } })),
    ],
  }
}

/**
 * The unit prices of an admitted catalog edition. An entry carries exactly one of `unitPrice` and
 * `unitPriceUnknown: true`; the latter is a definition with points but no amount. `currency` is the
 * currency of every entry with a unit price, and may be absent only when no entry has one.
 */
export interface CatalogPriceTable {
  edition: string
  digest: string
  currency?: string
  prices: readonly {
    system: string
    code: string
    unitPrice?: string
    unitPriceUnknown?: true
  }[]
}

/**
 * Fills each catalog-priced line from the table: a line with a numeric-zero placeholder or the
 * `unitPriceUnknown` marker takes its entry's unit price, or becomes `unitPriceUnknown: true` when
 * the entry has points only. A line with a non-zero unit price keeps it. An entry of 0.00 is a
 * published price and fills the line with 0.00; a code without an entry fails closed.
 */
export function resolveCatalogUnitPrices(
  input: BillingCase,
  prices: CatalogPriceTable,
  admission: AdmissionState,
): BillingCase {
  if (prices.edition !== admission.catalog.edition || prices.digest !== admission.catalog.digest) {
    throw new BillingInputError(`Price table edition ${prices.edition} digest ${prices.digest} does not match admitted catalog edition ${admission.catalog.edition} digest ${admission.catalog.digest}.`, { cause: 'digest-mismatch' })
  }
  return {
    ...input,
    lines: input.lines.map((line) => {
      validateLinePrice(line)
      if (line.unitPrice !== undefined && decimalMinor(line.unitPrice.value) !== 0n) return line
      const hit = prices.prices.find((entry) => entry.system === line.code.system && entry.code === line.code.code)
      if (hit === undefined) throw new BillingInputError(`Line ${line.id} has no catalog unit price for ${line.code.code}.`)
      const { unitPrice: _placeholder, unitPriceUnknown: _unknown, ...rest } = line
      if (hit.unitPriceUnknown === true && hit.unitPrice === undefined) return { ...rest, unitPriceUnknown: true }
      if (hit.unitPriceUnknown !== undefined || hit.unitPrice === undefined || !/^-?\d+(\.\d{1,2})?$/.test(hit.unitPrice)) throw new BillingInputError(`Catalog unit price for ${hit.code} must use a decimal string with at most two fraction digits.`)
      if (!prices.currency) throw new BillingInputError(`Catalog unit price for ${hit.code} requires a table currency.`)
      return { ...rest, unitPrice: { value: hit.unitPrice, currency: prices.currency } }
    }),
  }
}
