// The Billing Core admission records: the Provenance resources a producer writes at import time to
// admit catalog editions, rule sets and configured rules for a tenant, and the strict decoder the SDK
// reads them with.
import { createHash } from 'node:crypto'
import {
  BILLING_ADMISSION_PROFILE,
  BILLING_ADMISSION_TENANT_EXTENSION,
  BILLING_ADMITTED_ARTIFACT_EXTENSION,
  BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM,
  BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION,
  BILLING_ADMITTED_CONFIGURED_RULES_PROFILE,
  BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE,
  BILLING_ADMITTED_DIGEST_EXTENSION,
  type BillingAdmittedArtifact,
  type BillingAdmittedConfiguredRule,
} from '@cognovis/fhir-billing-types'
import { BillingInputError, canonicalizeJson } from './index.js'

const CORE_EXTENSION_PREFIX = 'https://fhir.cognovis.de/billing-core/extension/'
const CORE_PROFILE_PREFIX = 'https://fhir.cognovis.de/billing-core/StructureDefinition/'
const DIGEST = /^sha256:[0-9a-f]{64}$/
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/**
 * What a producer admits for one tenant and one Library: record 1, and the record-2 shards when the
 * edition has configured rules.
 */
export interface BillingAdmissionInput {
  /** The id of record 1, deterministic per tenant, producer instance and admitted Library. */
  readonly id: string
  /**
   * The base id of the record-2 shards; required exactly when `configuredRules` is given. Shard `n`
   * (1-based, in key order) has the id `<configuredRulesId>-<n>`, which must be a FHIR id (at most 64
   * characters).
   */
  readonly configuredRulesId?: string
  readonly tenant: string
  /** The id of the admitted Library (catalog edition, or a contract or overlay rule set). */
  readonly target: string
  /** `Provenance.recorded`: when the admission was recorded. */
  readonly recorded: string
  /** The admitting producer (`agent[0].who`): informational, never trusted for a decision. */
  readonly producer: { readonly reference?: string; readonly display?: string }
  /**
   * The admitted artifacts: at most one catalog edition (its member-set digest and source-set digest)
   * and the rule sets admitted with it (payload digest and, when the Library names one, publisher).
   */
  readonly artifacts: readonly BillingAdmittedArtifact[]
  /** The edition's configured-rule members with their configured-rule digests; requires a catalog-edition artifact. */
  readonly configuredRules?: readonly BillingAdmittedConfiguredRule[]
}

/** The Provenance resources of one admission. */
export interface EncodedBillingAdmission {
  /** Record 1. */
  readonly admission: Record<string, unknown>
  /**
   * The record-2 shards in key order, present exactly when `configuredRules` was given: the sorted
   * configured rules in consecutive shards of at most {@link BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE}
   * entries (none for no configured rules). Record 1 binds each by reference and digest, in this order.
   */
  readonly configuredRules?: readonly Record<string, unknown>[]
}

/** One record-2 shard as record 1 binds it: its reference and its configured-rules digest. */
export interface BillingAdmittedConfiguredRulesShard {
  readonly reference: string
  readonly digest: string
}

/** A decoded admission record (record 1). */
export interface DecodedBillingAdmissionRecord {
  readonly kind: 'admission'
  readonly id: string
  readonly tenant: string
  /** The id of the admitted Library. */
  readonly target: string
  readonly artifacts: readonly BillingAdmittedArtifact[]
  /** The record-2 shards record 1 binds, in shard order; absent when it binds none. */
  readonly configuredRules?: readonly BillingAdmittedConfiguredRulesShard[]
  /** `agent[0].who` as reference or display: the admitting producer, informational only. */
  readonly producer: string
  readonly resource: Record<string, unknown>
}

/** A decoded admitted-configured-rules record (one record-2 shard) with its recomputed digest. */
export interface DecodedBillingAdmittedConfiguredRules {
  readonly kind: 'admitted-configured-rules'
  readonly id: string
  readonly target: string
  /** Each admitted configured rule `url|version` of the shard with its configured-rule digest, in key order (at least one). */
  readonly rules: ReadonlyMap<string, string>
  /** {@link billingAdmittedConfiguredRulesDigest} of the entries, computed by the decoder. */
  readonly digest: string
  readonly resource: Record<string, unknown>
}

export type DecodedBillingAdmission = DecodedBillingAdmissionRecord | DecodedBillingAdmittedConfiguredRules

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BillingInputError(`${label} is required.`)
  return value
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new BillingInputError(`${label} must be a lowercase SHA-256 digest.`, { cause: 'digest-invalid' })
  return value
}

function canonicalKey(value: unknown, label: string): string {
  const key = text(value, label)
  const separator = key.lastIndexOf('|')
  if (separator <= 0 || separator === key.length - 1) throw new BillingInputError(`${label} must be canonical|version.`)
  return key
}

function sortedRules(rules: readonly BillingAdmittedConfiguredRule[]): BillingAdmittedConfiguredRule[] {
  const entries = rules.map((rule, index) => ({ key: canonicalKey(rule?.key, `Admitted configured rule ${index}`), digest: digest(rule?.digest, `Admitted configured rule ${index} digest`) }))
  entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.key === entries[index]!.key) throw new BillingInputError(`Admitted configured rule ${entries[index]!.key} occurs more than once.`, { cause: 'duplicate' })
  }
  return entries
}

/**
 * The configured-rules digest: `sha256:<hex>` over the canonical JSON of the `[[url|version, digest], ...]`
 * list sorted by `url|version`. Record 1 binds it; the SDK recomputes it from record 2.
 */
export function billingAdmittedConfiguredRulesDigest(rules: readonly BillingAdmittedConfiguredRule[]): string {
  const pairs = sortedRules(rules).map((rule) => [rule.key, rule.digest])
  return `sha256:${createHash('sha256').update(canonicalizeJson(pairs)).digest('hex')}`
}

function validArtifact(value: unknown, index: number): BillingAdmittedArtifact {
  const label = `Admitted artifact ${index}`
  if (!isRecord(value)) throw new BillingInputError(`${label} must be an object.`)
  const kind = value.kind
  if (kind !== 'catalog-edition' && kind !== 'rule-set') throw new BillingInputError(`${label} kind must be catalog-edition or rule-set.`)
  const canonical = text(value.canonical, `${label} canonical`)
  if (canonical.includes('|')) throw new BillingInputError(`${label} canonical must not carry a version.`)
  const artifact: BillingAdmittedArtifact = {
    kind,
    canonical,
    version: text(value.version, `${label} version`),
    digest: digest(value.digest, `${label} digest`),
  }
  if (kind === 'catalog-edition') {
    if (value.publisher !== undefined) throw new BillingInputError(`${label} is a catalog edition and binds no publisher.`)
    return { ...artifact, sourceSetDigest: digest(value.sourceSetDigest, `${label} sourceSetDigest`) }
  }
  if (value.sourceSetDigest !== undefined) throw new BillingInputError(`${label} is a rule set and binds no source-set digest.`)
  return value.publisher === undefined ? artifact : { ...artifact, publisher: text(value.publisher, `${label} publisher`) }
}

function validArtifacts(values: unknown): BillingAdmittedArtifact[] {
  if (!Array.isArray(values) || values.length === 0) throw new BillingInputError('An admission record binds at least one artifact.')
  const artifacts = values.map(validArtifact)
  if (artifacts.filter((artifact) => artifact.kind === 'catalog-edition').length > 1) throw new BillingInputError('An admission record binds at most one catalog edition.')
  const keys = artifacts.map((artifact) => `${artifact.kind} ${artifact.canonical}|${artifact.version}`)
  if (new Set(keys).size !== keys.length) throw new BillingInputError('An admission record binds each artifact once.', { cause: 'duplicate' })
  return artifacts
}

function provenanceBase(id: string, profile: string, target: string, recorded: string, producer: BillingAdmissionInput['producer']): Record<string, unknown> {
  if (!FHIR_ID.test(id)) throw new BillingInputError('Admission record id must be a FHIR id.')
  if (typeof target !== 'string' || !FHIR_ID.test(target)) throw new BillingInputError('Admission target must be the id of the admitted Library.')
  if (typeof recorded !== 'string' || !INSTANT.test(recorded)) throw new BillingInputError('Admission recorded must be a FHIR instant.')
  if (!isRecord(producer)) throw new BillingInputError('Admission producer is required.')
  const who = {
    ...(producer.reference === undefined ? {} : { reference: text(producer.reference, 'Admission producer reference') }),
    ...(producer.display === undefined ? {} : { display: text(producer.display, 'Admission producer display') }),
  }
  if (Object.keys(who).length === 0) throw new BillingInputError('Admission producer needs a reference or a display.')
  return {
    resourceType: 'Provenance',
    id,
    meta: { profile: [profile] },
    target: [{ reference: `Library/${target}` }],
    recorded,
    agent: [{ who }],
  }
}

function artifactExtension(artifact: BillingAdmittedArtifact): Record<string, unknown> {
  return {
    url: BILLING_ADMITTED_ARTIFACT_EXTENSION,
    extension: [
      { url: 'kind', valueCode: artifact.kind },
      { url: 'canonical', valueUri: artifact.canonical },
      { url: 'version', valueString: artifact.version },
      { url: 'digest', valueString: artifact.digest },
      ...(artifact.sourceSetDigest === undefined ? [] : [{ url: 'sourceSetDigest', valueString: artifact.sourceSetDigest }]),
      ...(artifact.publisher === undefined ? [] : [{ url: 'publisher', valueString: artifact.publisher }]),
    ],
  }
}

/**
 * The producer's encoder: record 1 (admission) and, when `configuredRules` is given, the record-2 shards
 * (admitted configured rules, entities sorted by `url|version`, at most
 * {@link BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE} per shard, ids `<configuredRulesId>-<n>`), each
 * bound into record 1 by reference and its own digest, in shard order. Every input is validated as
 * {@link decodeBillingAdmission} reads it; a record it writes always decodes.
 */
export function encodeBillingAdmission(input: BillingAdmissionInput): EncodedBillingAdmission {
  if (!isRecord(input)) throw new BillingInputError('Admission input must be an object.')
  const tenant = text(input.tenant, 'Admission tenant')
  const artifacts = validArtifacts(input.artifacts)
  const admission = provenanceBase(input.id, BILLING_ADMISSION_PROFILE, input.target, input.recorded, input.producer)
  let configuredRules: Record<string, unknown>[] | undefined
  const bindings: Record<string, unknown>[] = []
  if (input.configuredRules !== undefined) {
    if (!artifacts.some((artifact) => artifact.kind === 'catalog-edition')) throw new BillingInputError('Admitted configured rules belong to an admitted catalog edition.')
    if (!Array.isArray(input.configuredRules)) throw new BillingInputError('Admitted configured rules must be an array.')
    const rules = sortedRules(input.configuredRules)
    const baseId = text(input.configuredRulesId, 'Admitted configured-rules record id')
    configuredRules = []
    for (let start = 0; start < rules.length; start += BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE) {
      const shard = rules.slice(start, start + BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE)
      const id = `${baseId}-${configuredRules.length + 1}`
      configuredRules.push({
        ...provenanceBase(id, BILLING_ADMITTED_CONFIGURED_RULES_PROFILE, input.target, input.recorded, input.producer),
        entity: shard.map((rule) => ({
          role: 'source',
          what: { identifier: { system: BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM, value: rule.key } },
          extension: [{ url: BILLING_ADMITTED_DIGEST_EXTENSION, valueString: rule.digest }],
        })),
      })
      bindings.push({
        url: BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION,
        extension: [
          { url: 'reference', valueReference: { reference: `Provenance/${id}` } },
          { url: 'digest', valueString: billingAdmittedConfiguredRulesDigest(shard) },
        ],
      })
    }
  } else if (input.configuredRulesId !== undefined) {
    throw new BillingInputError('An admitted configured-rules record id requires admitted configured rules.')
  }
  const encoded = {
    ...admission,
    extension: [
      { url: BILLING_ADMISSION_TENANT_EXTENSION, valueString: tenant },
      ...artifacts.map(artifactExtension),
      ...bindings,
    ],
  }
  decodeBillingAdmission(encoded)
  if (configuredRules !== undefined) {
    const shards = configuredRules.map((shard) => decodeBillingAdmission(shard) as DecodedBillingAdmittedConfiguredRules)
    billingAdmittedConfiguredRulesUnion(shards)
  }
  return configuredRules === undefined ? { admission: encoded } : { admission: encoded, configuredRules }
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new BillingInputError(`${label} carries unsupported member ${key}.`)
}

/** The parts of a complex extension, each sub-extension at most once and only of the given names. */
function parts(extension: Record<string, unknown>, names: readonly string[], label: string): Map<string, Record<string, unknown>> {
  onlyKeys(extension, ['url', 'extension'], label)
  if (!Array.isArray(extension.extension)) throw new BillingInputError(`${label} must be a complex extension.`)
  const found = new Map<string, Record<string, unknown>>()
  for (const part of extension.extension) {
    if (!isRecord(part) || typeof part.url !== 'string' || !names.includes(part.url)) throw new BillingInputError(`${label} carries an unsupported part.`)
    if (found.has(part.url)) throw new BillingInputError(`${label} part ${part.url} occurs more than once.`)
    if (Object.keys(part).length !== 2) throw new BillingInputError(`${label} part ${part.url} must carry exactly one value.`)
    found.set(part.url, part)
  }
  return found
}

function decodedArtifact(extension: Record<string, unknown>, index: number): BillingAdmittedArtifact {
  const label = `Admitted artifact ${index}`
  const found = parts(extension, ['kind', 'canonical', 'version', 'digest', 'sourceSetDigest', 'publisher'], label)
  return validArtifact({
    kind: found.get('kind')?.valueCode,
    canonical: found.get('canonical')?.valueUri,
    version: found.get('version')?.valueString,
    digest: found.get('digest')?.valueString,
    ...(found.has('sourceSetDigest') ? { sourceSetDigest: found.get('sourceSetDigest')!.valueString } : {}),
    ...(found.has('publisher') ? { publisher: found.get('publisher')!.valueString } : {}),
  }, index)
}

/** The checks both records share: Provenance, one Billing Core profile, no modifier, one Library target. */
function commonShape(input: unknown): { resource: Record<string, unknown>; profile: string; id: string; target: string; producer: string } {
  if (!isRecord(input) || input.resourceType !== 'Provenance') throw new BillingInputError('A Billing admission record must be a Provenance.')
  if (input.modifierExtension !== undefined || input.implicitRules !== undefined) throw new BillingInputError('A Billing admission record does not support modifierExtension or implicitRules.', { cause: 'modifier-extension' })
  const id = text(input.id, 'Admission record id')
  const profiles = isRecord(input.meta) && Array.isArray(input.meta.profile) ? input.meta.profile.filter((profile): profile is string => typeof profile === 'string' && profile.startsWith(CORE_PROFILE_PREFIX)) : []
  if (profiles.length !== 1 || (profiles[0] !== BILLING_ADMISSION_PROFILE && profiles[0] !== BILLING_ADMITTED_CONFIGURED_RULES_PROFILE)) {
    throw new BillingInputError('A Billing admission record must declare exactly one Billing admission profile.')
  }
  if (!Array.isArray(input.target) || input.target.length !== 1 || !isRecord(input.target[0])) throw new BillingInputError('A Billing admission record targets exactly one Library.')
  const reference = input.target[0].reference
  const match = typeof reference === 'string' ? /^Library\/([A-Za-z0-9\-.]{1,64})$/.exec(reference) : null
  if (match === null) throw new BillingInputError('A Billing admission record targets exactly one Library.')
  text(input.recorded, 'Admission recorded')
  const agent = Array.isArray(input.agent) && isRecord(input.agent[0]) && isRecord(input.agent[0].who) ? input.agent[0].who : undefined
  const producer = typeof agent?.reference === 'string' && agent.reference ? agent.reference : typeof agent?.display === 'string' && agent.display ? agent.display : undefined
  if (producer === undefined) throw new BillingInputError('A Billing admission record names its producer in agent[0].who.')
  return { resource: input, profile: profiles[0], id, target: match[1]!, producer }
}

/** The Billing Core extensions of a record: only the given URLs are accepted; other extensions are left alone. */
function coreExtensions(resource: Record<string, unknown>, permitted: readonly string[]): Record<string, unknown>[] {
  if (resource.extension === undefined) return []
  if (!Array.isArray(resource.extension)) throw new BillingInputError('Billing admission record extensions must be an array.')
  const found: Record<string, unknown>[] = []
  for (const extension of resource.extension) {
    if (!isRecord(extension) || typeof extension.url !== 'string') throw new BillingInputError('Billing admission record extensions need a url.')
    if (!extension.url.startsWith(CORE_EXTENSION_PREFIX)) continue
    if (!permitted.includes(extension.url)) throw new BillingInputError(`Billing admission record carries unsupported extension ${extension.url}.`)
    found.push(extension)
  }
  return found
}

function decodeAdmissionRecord(shape: ReturnType<typeof commonShape>): DecodedBillingAdmissionRecord {
  const extensions = coreExtensions(shape.resource, [BILLING_ADMISSION_TENANT_EXTENSION, BILLING_ADMITTED_ARTIFACT_EXTENSION, BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION])
  if (shape.resource.entity !== undefined) throw new BillingInputError('An admission record carries no entities.')
  const tenants = extensions.filter((extension) => extension.url === BILLING_ADMISSION_TENANT_EXTENSION)
  if (tenants.length !== 1) throw new BillingInputError('An admission record names exactly one tenant.')
  onlyKeys(tenants[0]!, ['url', 'valueString'], 'Admission tenant')
  const tenant = text(tenants[0]!.valueString, 'Admission tenant')
  const artifacts = validArtifacts(extensions.filter((extension) => extension.url === BILLING_ADMITTED_ARTIFACT_EXTENSION).map(decodedArtifact))
  const bindings = extensions.filter((extension) => extension.url === BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION)
  let configuredRules: BillingAdmittedConfiguredRulesShard[] | undefined
  if (bindings.length > 0) {
    if (!artifacts.some((artifact) => artifact.kind === 'catalog-edition')) throw new BillingInputError('Admitted configured rules belong to an admitted catalog edition.')
    configuredRules = bindings.map((binding, index) => {
      const found = parts(binding, ['reference', 'digest'], `Admitted configured-rules shard ${index + 1}`)
      const reference = isRecord(found.get('reference')?.valueReference) ? (found.get('reference')!.valueReference as Record<string, unknown>).reference : undefined
      if (typeof reference !== 'string' || !/^Provenance\/[A-Za-z0-9\-.]{1,64}$/.test(reference)) throw new BillingInputError('Admitted configured rules must reference a Provenance.')
      return { reference, digest: digest(found.get('digest')?.valueString, 'Admitted configured-rules digest') }
    })
    if (new Set(configuredRules.map((shard) => shard.reference)).size !== configuredRules.length) {
      throw new BillingInputError('An admission record binds each admitted configured-rules shard once.', { cause: 'duplicate' })
    }
  }
  return {
    kind: 'admission',
    id: shape.id,
    tenant,
    target: shape.target,
    artifacts,
    ...(configuredRules === undefined ? {} : { configuredRules }),
    producer: shape.producer,
    resource: shape.resource,
  }
}

function decodeConfiguredRulesRecord(shape: ReturnType<typeof commonShape>): DecodedBillingAdmittedConfiguredRules {
  coreExtensions(shape.resource, [])
  if (!Array.isArray(shape.resource.entity) || shape.resource.entity.length === 0) throw new BillingInputError('An admitted configured-rules record lists at least one rule as an entity.')
  const rules = new Map<string, string>()
  let previous: string | undefined
  for (const [index, entity] of shape.resource.entity.entries()) {
    const label = `Admitted configured rule ${index}`
    if (!isRecord(entity)) throw new BillingInputError(`${label} must be an object.`)
    onlyKeys(entity, ['role', 'what', 'extension'], label)
    if (entity.role !== 'source') throw new BillingInputError(`${label} role must be source.`)
    const identifier = isRecord(entity.what) && isRecord(entity.what.identifier) ? entity.what.identifier : undefined
    if (identifier === undefined || identifier.system !== BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM) throw new BillingInputError(`${label} must name its rule by the admitted configured-rule identifier.`)
    const key = canonicalKey(identifier.value, label)
    const extensions = Array.isArray(entity.extension) ? entity.extension : []
    if (extensions.length !== 1 || !isRecord(extensions[0]) || extensions[0].url !== BILLING_ADMITTED_DIGEST_EXTENSION) throw new BillingInputError(`${label} must carry exactly one admitted digest.`)
    if (previous !== undefined && !(previous < key)) throw new BillingInputError('Admitted configured rules must be sorted by url|version and unique.')
    previous = key
    rules.set(key, digest(extensions[0].valueString, `${label} digest`))
  }
  return {
    kind: 'admitted-configured-rules',
    id: shape.id,
    target: shape.target,
    rules,
    digest: billingAdmittedConfiguredRulesDigest([...rules].map(([key, value]) => ({ key, digest: value }))),
    resource: shape.resource,
  }
}

/**
 * The SDK's strict decoder of both records, chosen by profile. A record that is not exactly the contract
 * shape (see {@link encodeBillingAdmission}) throws `BillingInputError`; non-Billing-Core extensions and
 * store `meta` fields are left alone.
 */
export function decodeBillingAdmission(input: unknown): DecodedBillingAdmission {
  const shape = commonShape(input)
  return shape.profile === BILLING_ADMISSION_PROFILE ? decodeAdmissionRecord(shape) : decodeConfiguredRulesRecord(shape)
}

/**
 * The admitted configured rules of an edition: the union of its record-2 shards, given in the order record
 * 1 binds them, each already checked against its bound digest. The shards must be disjoint, sorted and
 * contiguous: the last key of each shard sorts below the first key of the next. Otherwise it throws
 * `BillingInputError` naming the first shard that breaks the order.
 */
export function billingAdmittedConfiguredRulesUnion(shards: readonly DecodedBillingAdmittedConfiguredRules[]): ReadonlyMap<string, string> {
  const union = new Map<string, string>()
  let last: string | undefined
  for (const [index, shard] of shards.entries()) {
    const keys = [...shard.rules.keys()]
    if (keys.length === 0) throw new BillingInputError(`Admitted configured-rules shard ${index + 1} lists no rule.`)
    if (last !== undefined && !(last < keys[0]!)) {
      throw new BillingInputError(`Admitted configured-rules shard ${index + 1} (${shard.id}) overlaps or precedes the shard before it.`)
    }
    for (const [key, value] of shard.rules) union.set(key, value)
    last = keys[keys.length - 1]
  }
  return union
}
