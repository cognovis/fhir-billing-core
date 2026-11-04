import { createHash } from 'node:crypto'
import {
  BILLING_ARTIFACT_KIND_SYSTEM,
  BILLING_CATALOG_DEFINITION_CODING_EXTENSION,
  BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION,
  BILLING_CATALOG_EDITION_MIME,
  BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION,
  BILLING_CONFIGURED_RULE_MIME,
  BILLING_MEMBER_SET_DIGEST_SYSTEM,
  BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE,
  BILLING_RULE_COMPLETENESS_SYSTEM,
  BILLING_RULE_DIGEST_SYSTEM,
  BILLING_RULE_SET_DIGEST_SYSTEM,
  BILLING_RULE_SET_MIME,
  BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM,
  type BillingCatalogEditionManifestV1,
  type BillingCatalogSource,
  type BillingRuleCompleteness,
  type BillingRuleSet,
} from '@cognovis/fhir-billing-types'
import { type BillingConfiguredRulePayloadV2 } from '@cognovis/fhir-billing-types'
import { BillingInputError, billingRuleNamedCodes, billingRuleSetDigest, canonicalizeJson, defineBillingRuleSet, isGenericRuleClass } from './index.js'
import { BILLING_RULE_KEYS as RULE_KEYS } from './rule-keys.js'

const LIBRARY_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/library-type'

export type BillingLibraryKind = 'catalog-edition' | 'configured-rule' | 'rule-set'
export interface BillingLibraryPeriod { readonly start: string; readonly end?: string }
export interface BillingLibraryRelatedArtifact { readonly type: 'composed-of' | 'depends-on'; readonly resource: string }
/**
 * A catalog edition's `composed-of` member. On an edition that declares per-code rule completeness,
 * `configuredRuleMembersDigest` is the digest ({@link billingConfiguredRuleMembersDigest}) of the
 * configured-rule members whose `depends-on` names this member, a catalog definition; it is carried as the
 * `BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION` extension of the entry and is absent for a member
 * without configured rules. `catalogDefinitionDigest` is the content digest
 * ({@link billingCatalogDefinitionDigest}) of the member when it is a catalog definition, carried as the
 * `BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION` extension. The edition's member-set digest
 * ({@link billingCatalogEditionDigest}) covers both. `buildBillingLibrary` computes them and ignores
 * supplied values.
 */
export interface BillingCatalogEditionMemberLink {
  readonly type: 'composed-of'
  readonly resource: string
  readonly configuredRuleMembersDigest?: string
  readonly catalogDefinitionDigest?: string
  /**
   * On a contract-bound edition, the billed coding (`system|code`) of a catalog definition member, carried
   * as the `BILLING_CATALOG_DEFINITION_CODING_EXTENSION` extension and covered by the member-set digest;
   * absent on every other entry and on an unbound edition. `buildBillingLibrary` writes it.
   */
  readonly catalogDefinitionCoding?: string
}
/** A catalog definition a declaring edition's configured rules may name: its `canonical|version` and its billed `system|code`. */
export interface BillingCatalogDefinitionCode {
  readonly canonical: string
  readonly system: string
  readonly code: string
}
/** A related artifact as a Billing Library carries it; only an edition's `composed-of` entry carries an extension. */
export interface BillingLibraryResourceLink extends BillingLibraryRelatedArtifact {
  readonly extension?: readonly { readonly url: string; readonly valueString: string }[]
}
/** A FHIR R4 ContactPoint of a rule-set publisher contact; `value` is required. */
export interface BillingContactPoint {
  readonly system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other'
  readonly value: string
  readonly use?: 'home' | 'work' | 'temp' | 'old' | 'mobile'
  readonly rank?: number
}
/** A FHIR R4 ContactDetail: a name, telecom entries, or both. */
export interface BillingContactDetail {
  readonly name?: string
  readonly telecom?: readonly BillingContactPoint[]
}

interface BillingLibraryInputBase {
  readonly id: string
  readonly url: string
  readonly version: string
  readonly status: string
  readonly effectivePeriod?: BillingLibraryPeriod
}

export interface BillingCatalogEditionLibraryInput extends BillingLibraryInputBase {
  readonly kind: 'catalog-edition'
  readonly publisher: string
  readonly payload: BillingCatalogEditionManifestV1
  /**
   * The edition's `composed-of` members. A contract-bound edition's Contracts are its manifest `contracts`:
   * the builder writes one `depends-on` link per Contract after the members, sorted, and the decoder
   * refuses an edition whose `depends-on` links differ from them (cognovis/fhir-billing-core#127).
   */
  readonly relatedArtifacts: readonly BillingCatalogEditionMemberLink[]
  /**
   * Build input only (not decoded), required: every ChargeItemDefinition member of the edition as the
   * resource the producer writes, each a member by `url|version` and given once. The builder writes each
   * one's {@link billingCatalogDefinitionDigest} on its `composed-of` entry, so the member-set digest an
   * admission record binds covers the definitions' prices.
   */
  readonly catalogDefinitions?: readonly Record<string, unknown>[]
  /**
   * The edition's rule completeness declaration (`BILLING_RULE_COMPLETENESS_SYSTEM` identifier):
   * `configured-rule-per-code` states that its configured-rule members carry every rule of the edition,
   * one Library per rule whose `depends-on` links name the edition's definition of every code the rule
   * names; a named code without a definition in the edition needs no link. Outside the manifest, so an
   * older SDK still decodes the edition; absent when the edition declares nothing. Building it requires
   * `configuredRules` and `definitions`, which with `ruleSet` account for every `composed-of` member.
   */
  readonly ruleCompleteness?: BillingRuleCompleteness
  /**
   * Build input of a declaring or a contract-bound edition only (not decoded): every configured-rule Library member of the
   * edition. The builder refuses the declaration when one is no member, two carry one rule id, a rule of
   * a class Core knows names no explicit codes (`billingRuleNamedCodes` is `undefined`: a `"*"` or
   * code-less selector), or its `depends-on` links are not exactly the given `definitions` of the codes it
   * names (a named code none of them carries needs no link).
   * For a class Core does not know, the publisher's `depends-on` links stand as given.
   */
  readonly configuredRules?: readonly unknown[]
  /**
   * Build input of a declaring edition only (not decoded): every catalog definition of the edition, each
   * canonical once and each an edition member. A named code counts as absent from the edition only when no
   * given definition carries it, so the builder refuses an incomplete inventory: every `composed-of` member
   * must be a given definition, a given configured rule or the given `ruleSet`, and any other member is
   * refused as a catalog definition missing from `definitions` or an unknown member.
   */
  readonly definitions?: readonly BillingCatalogDefinitionCode[]
  /**
   * Build input of a declaring or a contract-bound edition only (not decoded): the edition's one rule-set Library member, when
   * it has one, as `configuredRules` passes its Libraries. The builder decodes it, refuses anything but a
   * rule-set Library, and exempts its `url|version`, which must be a member and neither a given definition
   * nor a given configured rule. A canonical alone is not accepted, so an omitted catalog definition cannot
   * pass as the rule-set member.
   */
  readonly ruleSet?: unknown
}

export interface BillingConfiguredRuleLibraryInput extends BillingLibraryInputBase {
  readonly kind: 'configured-rule'
  readonly payload: BillingConfiguredRulePayloadV2
  /**
   * At least one `depends-on` link, each a catalog definition `canonical|version`, unique; the Library
   * carries them sorted. Under an edition's per-code rule completeness declaration they name the
   * edition's definition of every code the rule names in any role ({@link billingRuleNamedCodes}) that
   * has one there. The links are
   * outside the payload, so they never change the configured-rule digest.
   */
  readonly relatedArtifacts: readonly (BillingLibraryRelatedArtifact & { readonly type: 'depends-on' })[]
}

export interface BillingRuleSetLibraryInput extends BillingLibraryInputBase {
  readonly kind: 'rule-set'
  /** Who maintains the rule set and is responsible for it; required to build a rule-set Library. */
  readonly publisher: string
  readonly contact?: readonly BillingContactDetail[]
  readonly payload: BillingRuleSet
  /**
   * Empty for a rule set that is not bound. A contract rule set carries one `depends-on` link per
   * Contract canonical of its payload's `appliesTo.contracts`, an overlay rule set one per catalog-edition
   * canonical of `appliesTo.catalogEditions`, and no other link.
   */
  readonly relatedArtifacts: readonly (BillingLibraryRelatedArtifact & { readonly type: 'depends-on' })[]
}

/**
 * A decoded rule-set Library. `publisher` and `contact` are present when the Library carries them;
 * a rule-set Library published before 0.17.0 carries neither and still decodes.
 */
export type DecodedBillingRuleSetLibrary = Omit<BillingRuleSetLibraryInput, 'publisher'> & { readonly publisher?: string }

export type BuildBillingLibraryInput = BillingCatalogEditionLibraryInput | BillingConfiguredRuleLibraryInput | BillingRuleSetLibraryInput

export interface BillingLibraryResource extends Record<string, unknown> {
  readonly resourceType: 'Library'
  readonly id: string
  readonly url: string
  readonly version: string
  readonly status: string
  readonly type: { readonly coding: readonly { readonly system: typeof LIBRARY_TYPE_SYSTEM; readonly code: 'asset-collection' | 'logic-library' }[] }
  readonly identifier: readonly { readonly system: string; readonly value: string }[]
  readonly effectivePeriod?: BillingLibraryPeriod
  readonly publisher?: string
  readonly contact?: readonly BillingContactDetail[]
  readonly relatedArtifact?: readonly BillingLibraryResourceLink[]
  readonly content: readonly [{ readonly contentType: string; readonly data: string }]
}

export type DecodedBillingLibrary = (BillingCatalogEditionLibraryInput | BillingConfiguredRuleLibraryInput | DecodedBillingRuleSetLibrary) & {
  readonly digest: string
  readonly resource: BillingLibraryResource
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BillingInputError(`${label} must be non-empty.`)
  return value
}

function requirePublicationStatus(value: unknown): string {
  if (value !== 'draft' && value !== 'active' && value !== 'retired' && value !== 'unknown') {
    throw new BillingInputError('Billing Library status must be a FHIR publication status.')
  }
  return value
}

function requireOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new BillingInputError(`${label} must contain exactly ${expected.join(', ')}.`)
  }
}

function requirePermittedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key))
  if (unknown !== undefined) throw new BillingInputError(`${label} does not accept ${unknown}.`)
}

function isoDate(value: unknown, label: string): string {
  const text = requireText(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BillingInputError(`${label} must be an ISO date.`)
  const parsed = Date.parse(`${text}T00:00:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) throw new BillingInputError(`${label} must be an ISO date.`)
  return text
}

function isoInstant(value: unknown, label: string): string {
  const text = requireText(value, label)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text)
  if (match === null) throw new BillingInputError(`${label} must be a valid FHIR instant.`)
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const zone = match[7]!
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const zoneHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3))
  const zoneMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6))
  if (
    year === 0
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]!
    || hour > 23
    || minute > 59
    || second > 59
    || zoneHour > 14
    || zoneMinute > 59
    || (zoneHour === 14 && zoneMinute !== 0)
    || !Number.isFinite(Date.parse(text))
  ) throw new BillingInputError(`${label} must be a valid FHIR instant.`)
  return text
}

function validatePeriod(value: unknown, label: string): BillingLibraryPeriod {
  if (!isRecord(value)) throw new BillingInputError(`${label} must be a Period.`)
  requireOnlyKeys(value, value.end === undefined ? ['start'] : ['start', 'end'], label)
  const start = isoDate(value.start, `${label} start`)
  const end = value.end === undefined ? undefined : isoDate(value.end, `${label} end`)
  if (end !== undefined && end < start) throw new BillingInputError(`${label} end cannot precede start.`)
  return { start, ...(end === undefined ? {} : { end }) }
}

const CONTACT_POINT_SYSTEMS: readonly string[] = ['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']
const CONTACT_POINT_USES: readonly string[] = ['home', 'work', 'temp', 'old', 'mobile']

function validateContacts(value: unknown): BillingContactDetail[] {
  if (!Array.isArray(value) || value.length === 0) throw new BillingInputError('Rule-set contact must be a non-empty array.')
  return value.map((detail, index) => {
    const label = `Rule-set contact ${index}`
    if (!isRecord(detail)) throw new BillingInputError(`${label} must be a ContactDetail.`)
    requirePermittedKeys(detail, ['name', 'telecom'], label)
    if (detail.name === undefined && detail.telecom === undefined) throw new BillingInputError(`${label} must name a contact or a telecom.`)
    const name = detail.name === undefined ? undefined : requireText(detail.name, `${label} name`)
    let telecom: BillingContactPoint[] | undefined
    if (detail.telecom !== undefined) {
      if (!Array.isArray(detail.telecom) || detail.telecom.length === 0) throw new BillingInputError(`${label} telecom must be a non-empty array.`)
      telecom = detail.telecom.map((point, pointIndex) => {
        const where = `${label} telecom ${pointIndex}`
        if (!isRecord(point)) throw new BillingInputError(`${where} must be a ContactPoint.`)
        requirePermittedKeys(point, ['system', 'value', 'use', 'rank'], where)
        if (point.system !== undefined && !CONTACT_POINT_SYSTEMS.includes(point.system as string)) throw new BillingInputError(`${where} system is invalid.`)
        if (point.use !== undefined && !CONTACT_POINT_USES.includes(point.use as string)) throw new BillingInputError(`${where} use is invalid.`)
        if (point.rank !== undefined && (!Number.isSafeInteger(point.rank) || (point.rank as number) <= 0)) throw new BillingInputError(`${where} rank must be a positive integer.`)
        return {
          ...(point.system === undefined ? {} : { system: point.system as NonNullable<BillingContactPoint['system']> }),
          value: requireText(point.value, `${where} value`),
          ...(point.use === undefined ? {} : { use: point.use as NonNullable<BillingContactPoint['use']> }),
          ...(point.rank === undefined ? {} : { rank: point.rank as number }),
        }
      })
    }
    return { ...(name === undefined ? {} : { name }), ...(telecom === undefined ? {} : { telecom }) }
  })
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = canonicalizeJson(left)
  const b = canonicalizeJson(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function canonicalVersion(value: unknown, label: string): string {
  const text = requireText(value, label)
  const separator = text.lastIndexOf('|')
  if (separator <= 0 || separator === text.length - 1) throw new BillingInputError(`${label} must be canonical|version.`)
  return text
}

/**
 * The digest of the configured-rule members whose `depends-on` names one catalog definition: `sha256:<hex>`
 * over the canonical JSON of their sorted, unique `url|version` list, as the member-set digest is formed.
 */
export function billingConfiguredRuleMembersDigest(members: readonly string[]): string {
  return billingCatalogMemberSetDigest(members)
}

/**
 * The last membership digested, and its digest: an edition is checked by its decoder and by its reader
 * in turn, so the same 50,000 members are not sorted and hashed twice. The members are compared one by
 * one, which is exact and far cheaper.
 */
let lastMembership: { readonly members: readonly string[]; readonly digest: string } | undefined

export function billingCatalogMemberSetDigest(members: readonly string[]): string {
  if (members.length === 0) throw new BillingInputError('Catalog membership must not be empty.')
  const last = lastMembership
  if (last !== undefined && last.members.length === members.length && last.members.every((member, index) => member === members[index])) return last.digest
  const normalized = members.map((member, index) => canonicalVersion(member.trim(), `Catalog member ${index}`)).sort()
  if (new Set(normalized).size !== normalized.length) throw new BillingInputError('Catalog membership must not contain duplicates.', { cause: 'duplicate' })
  const digest = sha256(normalized)
  if (members.length >= 1000) lastMembership = { members: [...members], digest }
  return digest
}

/**
 * A catalog definition's content digest: `sha256:<hex>` over the canonical JSON of its `resourceType`,
 * `url`, `version`, `code` and `propertyGroup`, so it changes with every price and nothing outside the
 * definition's content (its id or `meta`) changes it.
 */
export function billingCatalogDefinitionDigest(definition: Record<string, unknown>): string {
  return sha256({
    resourceType: definition.resourceType,
    url: definition.url,
    version: definition.version,
    code: definition.code,
    propertyGroup: definition.propertyGroup,
  })
}

/**
 * A native catalog edition's member-set digest, scheme 2 (cognovis/fhir-billing-core#165): `sha256:<hex>`
 * over the canonical JSON of `{ scheme: 2, members }`, where `members` lists `[url|version, catalog
 * definition digest or null, configured-rule members digest or null]` per `composed-of` entry, sorted by
 * `url|version`. An admission record binding it binds every definition's prices and every definition's
 * configured rules. A contract-bound edition's digest also covers its manifest's `contracts`, sorted, as
 * `{ scheme: 2, members, contracts }` (cognovis/fhir-billing-core#127), each member with its catalog
 * definition coding or null as a fourth element, so the admission record binds the Contract assignment
 * and which codings the edition holds; an unbound edition's digest is unchanged. A legacy edition keeps the scheme-1
 * {@link billingCatalogMemberSetDigest}.
 */
export function billingCatalogEditionDigest(members: readonly BillingCatalogEditionMemberLink[], contracts?: readonly string[]): string {
  if (members.length === 0) throw new BillingInputError('Catalog membership must not be empty.')
  const entries = members.map((member, index) => [
    canonicalVersion(member.resource.trim(), `Catalog member ${index}`),
    member.catalogDefinitionDigest ?? null,
    member.configuredRuleMembersDigest ?? null,
    // Only a contract-bound edition's entries carry their coding; an unbound edition keeps its digest.
    ...(contracts === undefined ? [] : [member.catalogDefinitionCoding ?? null]),
  ] as const).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
  if (entries.some((entry, index) => index > 0 && entries[index - 1]![0] === entry[0])) {
    throw new BillingInputError('Catalog membership must not contain duplicates.', { cause: 'duplicate' })
  }
  if (contracts === undefined) return sha256({ scheme: 2, members: entries })
  const bound = [...contracts].sort()
  if (bound.length === 0 || bound.some((contract, index) => index > 0 && bound[index - 1] === contract)) {
    throw new BillingInputError('Catalog edition contracts must be a non-empty list of unique Contract canonicals.')
  }
  return sha256({ scheme: 2, members: entries, contracts: bound })
}

function validateCatalogSource(value: unknown, index: number): BillingCatalogSource {
  if (!isRecord(value)) throw new BillingInputError(`Catalog source ${index} must be an object.`)
  requireOnlyKeys(value, ['sourceUri', 'sourceVersion', 'sourceDigest', 'retrievedAt', 'producerVersion', 'completeness'], `Catalog source ${index}`)
  const sourceDigest = requireText(value.sourceDigest, `Catalog source ${index} sourceDigest`)
  if (!/^sha256:[0-9a-f]{64}$/.test(sourceDigest)) throw new BillingInputError(`Catalog source ${index} sourceDigest must be a lowercase SHA-256 digest.`, { cause: 'digest-invalid' })
  if (value.completeness !== 'complete' && value.completeness !== 'partial' && value.completeness !== 'unknown') {
    throw new BillingInputError(`Catalog source ${index} completeness is invalid.`)
  }
  return {
    sourceUri: requireText(value.sourceUri, `Catalog source ${index} sourceUri`),
    sourceVersion: requireText(value.sourceVersion, `Catalog source ${index} sourceVersion`),
    sourceDigest: sourceDigest as `sha256:${string}`,
    retrievedAt: isoInstant(value.retrievedAt, `Catalog source ${index} retrievedAt`),
    producerVersion: requireText(value.producerVersion, `Catalog source ${index} producerVersion`),
    completeness: value.completeness,
  }
}

export function billingCatalogSourceSetDigest(sources: readonly BillingCatalogSource[]): string {
  if (sources.length === 0) throw new BillingInputError('Catalog source evidence must not be empty.')
  const validated = sources.map((source, index) => validateCatalogSource(source, index))
  const identities = validated.map((source) => `${source.sourceUri}\u0000${source.sourceVersion}`)
  if (new Set(identities).size !== identities.length) throw new BillingInputError('Catalog source identities must be unique.', { cause: 'duplicate' })
  return sha256([...validated].sort(compareCanonical))
}

/** A Contract canonical a contract-bound edition names, as a contract rule set's: an absolute URI without whitespace, optionally `|version`. */
const CONTRACT_CANONICAL = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s|]+(?:\|[^\s|]+)?$/

function validateEditionContracts(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BillingInputError('Catalog edition contracts must be a non-empty array; omit contracts on an edition that is not bound.')
  for (const [index, canonical] of value.entries()) {
    if (typeof canonical !== 'string' || !CONTRACT_CANONICAL.test(canonical)) throw new BillingInputError(`Catalog edition contract ${index} must be an absolute canonical, optionally |version.`)
  }
  if (new Set(value).size !== value.length) throw new BillingInputError('Catalog edition contracts must be unique.')
  return [...value] as string[]
}

/** The `depends-on` links a contract-bound edition carries: one per manifest Contract, sorted; none on an unbound edition. */
function editionContractLinks(manifest: BillingCatalogEditionManifestV1): { readonly type: 'depends-on'; readonly resource: string }[] {
  return [...(manifest.contracts ?? [])].sort().map((resource) => ({ type: 'depends-on' as const, resource }))
}

/**
 * Refuses a catalog edition whose `depends-on` links are not exactly its manifest's `contracts`: a
 * contract-bound edition names its Contracts in both, an unbound edition in neither, and an edition bound
 * by one and unbound by the other is refused.
 */
function requireEditionContractLinks(links: readonly BillingLibraryRelatedArtifact[], manifest: BillingCatalogEditionManifestV1): void {
  const named = links.filter((link) => link.type === 'depends-on').map((link) => link.resource)
  const declared = new Set(manifest.contracts ?? [])
  if (new Set(named).size !== named.length || named.length !== declared.size || named.some((contract) => !declared.has(contract))) {
    throw new BillingInputError('Catalog edition depends-on links must name exactly the Contract canonicals of its manifest contracts; an edition is contract-bound by both or by neither.')
  }
}

function validateManifest(value: unknown): BillingCatalogEditionManifestV1 {
  if (!isRecord(value)) throw new BillingInputError('Edition manifest must be an object.')
  // `contracts` is present only on a contract-bound edition; an unbound edition keeps its earlier manifest.
  requireOnlyKeys(value, ['schemaVersion', 'kind', 'catalogScope', 'publicationPeriod', 'sources', ...(Object.hasOwn(value, 'contracts') ? ['contracts'] : [])], 'Edition manifest')
  if (value.schemaVersion !== 1 || value.kind !== 'billing-catalog-edition') throw new BillingInputError('Edition manifest schema is unsupported.')
  if (!Array.isArray(value.sources) || value.sources.length === 0) throw new BillingInputError('Catalog edition sources are required.')
  const sources = value.sources.map((source, index) => validateCatalogSource(source, index))
  billingCatalogSourceSetDigest(sources)
  return {
    schemaVersion: 1,
    kind: 'billing-catalog-edition',
    catalogScope: requireText(value.catalogScope, 'Catalog edition catalogScope'),
    publicationPeriod: validatePeriod(value.publicationPeriod, 'Catalog edition publicationPeriod'),
    sources,
    ...(Object.hasOwn(value, 'contracts') ? { contracts: validateEditionContracts(value.contracts) } : {}),
  }
}

function validateConfiguredRule(value: unknown): BillingConfiguredRulePayloadV2 {
  if (!isRecord(value)) throw new BillingInputError('Configured-rule payload must be an object.')
  // The one optional member is `factSources`; omitting it keeps the earlier digest.
  const optional = Object.hasOwn(value, 'factSources') ? ['factSources'] : []
  requireOnlyKeys(value, ['schemaVersion', 'semanticMajor', 'rule', ...optional], 'Configured-rule payload')
  if (value.schemaVersion !== 2 || value.semanticMajor !== 4 || !isRecord(value.rule)) throw new BillingInputError('Configured-rule payload schema is unsupported.')
  requirePermittedKeys(value.rule, RULE_KEYS, 'Configured rule')
  requireText(value.rule.id, 'Configured rule id')
  requireText(value.rule.class, 'Configured rule class')
  // The declarations are validated exactly as a rule set's, together with the rule.
  const defined = defineBillingRuleSet({
    schemaVersion: 2,
    semanticMajor: 4,
    id: `configured:${String(value.rule.id ?? '')}`,
    rules: [value.rule as unknown as BillingRuleSet['rules'][number]],
    ...(optional.length > 0 ? { factSources: value.factSources as NonNullable<BillingRuleSet['factSources']> } : {}),
  })
  return { schemaVersion: 2, semanticMajor: 4, rule: defined.rules[0]!, ...(defined.factSources !== undefined ? { factSources: defined.factSources } : {}) }
}

/** The edition's rule completeness declaration: absent, or exactly one known value. */
function ruleCompletenessOf(resource: Record<string, unknown>): BillingRuleCompleteness | undefined {
  const values = relevantIdentifiers(resource, BILLING_RULE_COMPLETENESS_SYSTEM)
  if (values.length === 0) return undefined
  if (values.length > 1) throw new BillingInputError('Catalog edition rule completeness identifier must occur at most once.')
  return requireRuleCompleteness(values[0])
}

function requireRuleCompleteness(value: unknown): BillingRuleCompleteness {
  if (value !== BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE) throw new BillingInputError('Catalog edition rule completeness is unsupported.')
  return value
}

function relevantIdentifiers(resource: Record<string, unknown>, system: string): string[] {
  if (!Array.isArray(resource.identifier)) throw new BillingInputError('Billing Library identifiers are required.')
  return resource.identifier.flatMap((identifier) => (
    isRecord(identifier) && identifier.system === system && typeof identifier.value === 'string' ? [identifier.value] : []
  ))
}

function oneIdentifier(resource: Record<string, unknown>, system: string, label: string): string {
  const values = relevantIdentifiers(resource, system)
  if (values.length !== 1 || !values[0]) throw new BillingInputError(`${label} identifier must occur exactly once.`)
  return values[0]
}

function libraryType(resource: Record<string, unknown>): string {
  if (!isRecord(resource.type) || !Array.isArray(resource.type.coding)) throw new BillingInputError('Billing Library type is required.')
  const codes = resource.type.coding.flatMap((coding) => isRecord(coding) && coding.system === LIBRARY_TYPE_SYSTEM && typeof coding.code === 'string' ? [coding.code] : [])
  if (codes.length !== 1) throw new BillingInputError('Billing Library type must contain exactly one native library-type coding.')
  return codes[0]!
}

function decodeContent(resource: Record<string, unknown>, contentType: string): unknown {
  if (!Array.isArray(resource.content) || resource.content.length !== 1 || !isRecord(resource.content[0])) throw new BillingInputError('Billing Library must contain exactly one attachment.')
  const attachment = resource.content[0]
  requireOnlyKeys(attachment, ['contentType', 'data'], 'Billing Library attachment')
  if (attachment.contentType !== contentType || typeof attachment.data !== 'string' || !attachment.data) throw new BillingInputError(`Billing Library must contain inline ${contentType}.`)
  const bytes = Buffer.from(attachment.data, 'base64')
  if (bytes.toString('base64').replace(/=+$/, '') !== attachment.data.replace(/=+$/, '')) throw new BillingInputError('Billing Library content is not canonical base64.')
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new BillingInputError('Billing Library content is not valid JSON.')
  }
}

/** The links as written; each kind checks the form of its link targets. */
type EntryExtensions = { configuredRuleMembersDigest?: string; catalogDefinitionDigest?: string; catalogDefinitionCoding?: string }
type DecodedLink = BillingLibraryRelatedArtifact & Readonly<EntryExtensions>

function decodeLinks(resource: Record<string, unknown>): DecodedLink[] {
  if (resource.relatedArtifact === undefined) return []
  if (!Array.isArray(resource.relatedArtifact)) throw new BillingInputError('Billing Library relatedArtifact must be an array.')
  return resource.relatedArtifact.map((artifact, index) => {
    if (!isRecord(artifact) || (artifact.type !== 'composed-of' && artifact.type !== 'depends-on')) throw new BillingInputError(`Billing Library link ${index} is invalid.`)
    const label = `Billing Library link ${index}`
    requireOnlyKeys(artifact, artifact.extension === undefined ? ['type', 'resource'] : ['type', 'resource', 'extension'], label)
    const link: BillingLibraryRelatedArtifact = { type: artifact.type, resource: requireText(artifact.resource, label) }
    if (artifact.extension === undefined) return link
    if (artifact.type !== 'composed-of') throw new BillingInputError(`${label} carries an extension; only a catalog edition's composed-of entry may.`)
    return { ...link, ...entryDigestsOf(artifact.extension, label) }
  })
}

const ENTRY_DIGEST_EXTENSIONS: Readonly<Record<string, keyof EntryExtensions>> = {
  [BILLING_CATALOG_DEFINITION_CODING_EXTENSION]: 'catalogDefinitionCoding',
  [BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION]: 'configuredRuleMembersDigest',
  [BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION]: 'catalogDefinitionDigest',
}

/** A billed coding as an entry carries it: `system|code`, a system without whitespace or `|` and a non-empty code. */
const ENTRY_CODING = /^[^\s|]+\|.+$/

/**
 * The extensions of an edition's composed-of entry, each once: the configured-rule members digest, the
 * catalog definition digest and, on a contract-bound edition, the catalog definition coding.
 */
function entryDigestsOf(value: unknown, label: string): EntryExtensions {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) throw new BillingInputError(`${label} must carry one to three entry extensions.`)
  const digests: EntryExtensions = {}
  for (const extension of value) {
    if (!isRecord(extension)) throw new BillingInputError(`${label} extension must be an object.`)
    requireOnlyKeys(extension, ['url', 'valueString'], `${label} extension`)
    const field = typeof extension.url === 'string' && Object.hasOwn(ENTRY_DIGEST_EXTENSIONS, extension.url) ? ENTRY_DIGEST_EXTENSIONS[extension.url]! : undefined
    if (field === undefined) throw new BillingInputError(`${label} extension is neither the configured-rule members digest, the catalog definition digest nor the catalog definition coding.`)
    if (digests[field] !== undefined) throw new BillingInputError(`${label} carries the ${field} extension more than once.`, { cause: 'duplicate' })
    if (field === 'catalogDefinitionCoding') {
      if (typeof extension.valueString !== 'string' || !ENTRY_CODING.test(extension.valueString)) throw new BillingInputError(`${label} catalogDefinitionCoding must be system|code.`)
      digests[field] = extension.valueString
      continue
    }
    if (typeof extension.valueString !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(extension.valueString)) {
      throw new BillingInputError(`${label} ${field} must be a lowercase SHA-256 digest.`, { cause: 'digest-invalid' })
    }
    digests[field] = extension.valueString
  }
  return digests
}

/** Refuses entry digests on any Library other than a catalog edition. */
function requireNoEntryDigests(links: readonly DecodedLink[], label: string): void {
  if (links.some((link) => link.configuredRuleMembersDigest !== undefined || link.catalogDefinitionDigest !== undefined || link.catalogDefinitionCoding !== undefined)) {
    throw new BillingInputError(`${label} links must not carry a configured-rule members or catalog definition digest.`)
  }
}

/**
 * The content digest of each given catalog definition by its `url|version`. Every native edition is built
 * with its definitions, each a member and given once, so the member-set digest binds their prices.
 */
function catalogDefinitionDigests(definitions: unknown, members: ReadonlySet<string>): Map<string, string> {
  if (!Array.isArray(definitions)) throw new BillingInputError('A catalog edition requires its catalogDefinitions, every ChargeItemDefinition member.')
  const digests = new Map<string, string>()
  for (const [index, definition] of definitions.entries()) {
    const label = `Catalog definition ${index}`
    if (!isRecord(definition) || definition.resourceType !== 'ChargeItemDefinition') throw new BillingInputError(`${label} must be a ChargeItemDefinition.`)
    const key = `${requireText(definition.url, `${label} url`)}|${requireText(definition.version, `${label} version`)}`
    if (!members.has(key)) throw new BillingInputError(`${label} ${key} is not a member of the edition.`)
    if (digests.has(key)) throw new BillingInputError(`${label} ${key} is given more than once.`, { cause: 'duplicate' })
    digests.set(key, billingCatalogDefinitionDigest(definition))
  }
  return digests
}

/** Refuses a configured-rule members digest on an edition without a rule completeness declaration. */
function requireNoMembersDigest(links: readonly DecodedLink[], label: string): void {
  if (links.some((link) => link.configuredRuleMembersDigest !== undefined)) throw new BillingInputError(`${label} links must not carry a configured-rule members digest.`)
}

/** Catalog-edition links name a catalog member as `canonical|version`, with its entry digests when it has them. */
function memberLinks(links: readonly DecodedLink[]): BillingCatalogEditionMemberLink[] {
  return links.filter((link) => link.type === 'composed-of').map((link, index) => ({
    type: 'composed-of' as const,
    resource: canonicalVersion(link.resource, `Billing Library link ${index}`),
    ...(link.configuredRuleMembersDigest === undefined ? {} : { configuredRuleMembersDigest: link.configuredRuleMembersDigest }),
    ...(link.catalogDefinitionDigest === undefined ? {} : { catalogDefinitionDigest: link.catalogDefinitionDigest }),
    ...(link.catalogDefinitionCoding === undefined ? {} : { catalogDefinitionCoding: link.catalogDefinitionCoding }),
  }))
}

/**
 * Refuses an edition whose entry codings do not match its binding: a contract-bound edition's every
 * catalog definition entry carries its coding and no other entry does; an unbound edition's entries carry
 * none.
 */
function requireEntryCodings(members: readonly BillingCatalogEditionMemberLink[], bound: boolean): void {
  const invalid = members.find((member) => (member.catalogDefinitionCoding !== undefined) !== (bound && member.catalogDefinitionDigest !== undefined))
  if (invalid !== undefined) {
    throw new BillingInputError(bound
      ? `Contract-bound catalog edition entry ${invalid.resource} must carry the catalog definition coding exactly when it is a catalog definition.`
      : `Catalog edition entry ${invalid.resource} carries a catalog definition coding, which only a contract-bound edition carries.`)
  }
}

/**
 * Refuses a contract-bound edition built from an incomplete inventory: every member must be a given
 * catalog definition (whose entry then carries its digest and coding), the given rule-set Library or a
 * given configured-rule Library. A definition member left without its digest and coding could otherwise
 * make the edition look as if it did not hold a coding, and a line fall back to another edition's price
 * (cognovis/fhir-billing-core#127).
 */
function requireBoundInventory(members: readonly string[], definitionDigests: ReadonlyMap<string, string>, ruleSet: unknown, configuredRules: readonly unknown[] | undefined): void {
  const libraries = new Set<string>()
  const given: [unknown, 'rule-set' | 'configured-rule'][] = [
    ...(ruleSet === undefined ? [] : [[ruleSet, 'rule-set'] as [unknown, 'rule-set']]),
    ...(configuredRules ?? []).map((library) => [library, 'configured-rule'] as [unknown, 'configured-rule']),
  ]
  for (const [library, kind] of given) {
    const decoded = decodeBillingLibrary(library)
    if (decoded.kind !== kind) throw new BillingInputError(`Contract-bound catalog edition ${kind === 'rule-set' ? 'ruleSet' : 'configuredRules'} must be ${kind} Libraries.`)
    libraries.add(`${decoded.url}|${decoded.version}`)
  }
  const unaccounted = members.find((member) => !definitionDigests.has(member) && !libraries.has(member))
  if (unaccounted !== undefined) {
    throw new BillingInputError(`Contract-bound catalog edition member ${unaccounted} is neither a given catalog definition nor the given ruleSet or configuredRules; a contract-bound edition is built from its whole inventory.`)
  }
}

/** The single billed coding of a catalog definition, as `system|code`. */
function definitionCodingKey(definition: Record<string, unknown>, label: string): string {
  const codings = isRecord(definition.code) && Array.isArray(definition.code.coding) ? definition.code.coding : []
  if (codings.length !== 1 || !isRecord(codings[0])) throw new BillingInputError(`${label} of a contract-bound edition must carry exactly one coding.`)
  const key = `${requireText(codings[0].system, `${label} coding system`)}|${requireText(codings[0].code, `${label} coding code`)}`
  if (!ENTRY_CODING.test(key)) throw new BillingInputError(`${label} coding must be system|code.`)
  return key
}

/**
 * The configured-rule members digest of each catalog definition of a declaring edition, keyed by the
 * definition's `canonical|version`, after checking the configured rules against the declaration: each is a
 * configured-rule Library and an edition member, no two carry one rule id, a rule of a class Core knows
 * names explicit codes, and its `depends-on` links are exactly the given definitions of those codes (a
 * named code without a system is covered by every given definition with that code). A named code no given
 * definition carries needs no link. Every `depends-on` target must be an edition member. The given
 * definitions are the edition's whole catalog inventory: each is a member, none is given twice, and the
 * members are exactly the definitions, the configured rules and at most the one given rule-set Library.
 */
function configuredRuleMembersDigests(configuredRules: readonly unknown[], definitions: readonly BillingCatalogDefinitionCode[], ruleSetLibrary: unknown, members: ReadonlySet<string>): Map<string, string> {
  const definitionCodes = definitions.map((definition, index) => ({
    canonical: canonicalVersion(definition?.canonical, `Catalog definition ${index}`),
    system: requireText(definition?.system, `Catalog definition ${index} system`),
    code: requireText(definition?.code, `Catalog definition ${index} code`),
  }))
  const definitionKeys = new Set<string>()
  for (const { canonical } of definitionCodes) {
    if (definitionKeys.has(canonical)) throw new BillingInputError(`Catalog definition ${canonical} is given more than once.`)
    if (!members.has(canonical)) throw new BillingInputError(`Catalog definition ${canonical} is not a member of the declaring edition.`)
    definitionKeys.add(canonical)
  }
  const configuredKeys = new Set<string>()
  const ruleIds = new Set<string>()
  const byDefinition = new Map<string, string[]>()
  for (const [index, input] of configuredRules.entries()) {
    const decoded = decodeBillingLibrary(input)
    if (decoded.kind !== 'configured-rule') throw new BillingInputError(`Configured rule ${index} is not a configured-rule Library.`)
    const key = `${decoded.url}|${decoded.version}`
    if (!members.has(key)) throw new BillingInputError(`Configured rule ${key} is not a member of the declaring edition.`)
    if (definitionKeys.has(key)) throw new BillingInputError(`Configured rule ${key} is also given as a catalog definition.`)
    configuredKeys.add(key)
    const { rule } = decoded.payload
    if (ruleIds.has(rule.id)) throw new BillingInputError(`Configured rule id ${rule.id} is carried by more than one configured-rule Library.`, { cause: 'duplicate' })
    ruleIds.add(rule.id)
    const dependsOn = decoded.relatedArtifacts.map((link) => link.resource)
    if (isGenericRuleClass(rule.class)) {
      const named = billingRuleNamedCodes(rule)
      if (named === undefined) throw new BillingInputError(`Configured rule ${rule.id} names no explicit codes (a "*" or code-less selector), so per-code rule completeness cannot be declared.`)
      // A named code no given definition carries cannot be billed from the edition, so no evaluation reaches
      // the rule through it and it needs no link; every named code with a definition does.
      const expected = new Set<string>()
      for (const code of named) {
        for (const definition of definitionCodes) {
          if (definition.code === code.code && (code.system === undefined || code.system === definition.system)) expected.add(definition.canonical)
        }
      }
      if (dependsOn.length !== expected.size || dependsOn.some((target) => !expected.has(target))) {
        throw new BillingInputError(`Configured rule ${rule.id} depends-on links must name exactly the catalog definitions of the codes it names: ${[...expected].sort().join(', ') || 'none'}.`)
      }
    }
    for (const target of dependsOn) {
      if (!members.has(target)) throw new BillingInputError(`Configured rule ${rule.id} depends-on ${target}, which is not a member of the declaring edition.`)
      byDefinition.set(target, [...(byDefinition.get(target) ?? []), key])
    }
  }
  // A named code counts as absent only when no edition definition carries it, so the inventory must be whole.
  // The exempt member is derived from a decoded rule-set Library, never taken as a bare canonical.
  let ruleSet: string | undefined
  if (ruleSetLibrary !== undefined) {
    let decoded: ReturnType<typeof decodeBillingLibrary>
    try {
      decoded = decodeBillingLibrary(ruleSetLibrary)
    } catch (error) {
      throw new BillingInputError(`Catalog edition ruleSet is not a rule-set Library: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (decoded.kind !== 'rule-set') throw new BillingInputError('Catalog edition ruleSet is not a rule-set Library.')
    ruleSet = `${decoded.url}|${decoded.version}`
    if (!members.has(ruleSet)) throw new BillingInputError(`Catalog edition rule-set Library ${ruleSet} is not a member of the declaring edition.`)
    if (definitionKeys.has(ruleSet) || configuredKeys.has(ruleSet)) throw new BillingInputError(`Catalog edition rule-set Library ${ruleSet} is also given as a catalog definition or configured rule.`)
  }
  for (const member of [...members].sort()) {
    if (definitionKeys.has(member) || configuredKeys.has(member) || member === ruleSet) continue
    throw new BillingInputError(`Catalog edition member ${member} is neither a given catalog definition, a given configured rule nor the given rule-set Library, so the definitions inventory is incomplete.`)
  }
  return new Map([...byDefinition].map(([definition, keys]) => [definition, billingConfiguredRuleMembersDigest(keys)]))
}

/**
 * The links of a configured-rule Library: at least one, each a `depends-on` catalog definition
 * `canonical|version`, none twice.
 */
function configuredRuleLinks(links: readonly BillingLibraryRelatedArtifact[]): (BillingLibraryRelatedArtifact & { readonly type: 'depends-on' })[] {
  if (links.length === 0 || links.some((link) => link.type !== 'depends-on')) throw new BillingInputError('Configured-rule Library requires at least one depends-on canonical version and no other link.')
  const dependency = links.map((link, index) => ({ type: 'depends-on' as const, resource: canonicalVersion(link.resource, `Configured-rule depends-on link ${index}`) }))
  if (new Set(dependency.map((link) => link.resource)).size !== dependency.length) throw new BillingInputError('Configured-rule Library depends-on links must be unique.')
  return dependency
}

/**
 * The binding of a rule-set Library: no link without `appliesTo`, and with it exactly one `depends-on`
 * link per canonical of `appliesTo.contracts` (a contract rule set) or `appliesTo.catalogEditions` (an
 * overlay rule set), naming each exactly as the payload does. Any other link, or a link and a payload
 * member that name different canonicals, is refused, so the searchable carrier element and the
 * digest-covered payload always agree.
 */
function bindingLinks(links: readonly BillingLibraryRelatedArtifact[], payload: BillingRuleSet): (BillingLibraryRelatedArtifact & { readonly type: 'depends-on' })[] {
  if (payload.appliesTo === undefined) {
    if (links.length !== 0) throw new BillingInputError('Rule-set Library must not carry related artifacts unless its payload declares appliesTo.')
    return []
  }
  const label = payload.appliesTo.contracts !== undefined ? 'Contract' : 'catalog edition'
  if (links.some((link) => link.type !== 'depends-on')) throw new BillingInputError(`Bound rule-set Library links must be depends-on ${label} canonicals.`)
  const linked = links.map((link) => link.resource)
  const declared = payload.appliesTo.contracts ?? payload.appliesTo.catalogEditions ?? []
  if (new Set(linked).size !== linked.length) throw new BillingInputError(`Bound rule-set Library must link each ${label} canonical once.`)
  if (linked.length !== declared.length || linked.some((canonical) => !declared.includes(canonical))) {
    throw new BillingInputError(`Bound rule-set Library depends-on links must name exactly the ${label} canonicals of the payload appliesTo.`)
  }
  return links.map((link) => ({ type: 'depends-on' as const, resource: link.resource }))
}

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return value
}

/** Strict rule-set payload decoding shared by the rule-set Library codec and bare-payload consumers. */
export function decodeBillingRuleSet(input: unknown): BillingRuleSet {
  if (!isRecord(input)) throw new BillingInputError('Rule-set payload must be an object.')
  // The fact-source declarations and the Contract binding are the optional members; every other key is
  // required, and no other is accepted.
  const optional = ['factSources', 'appliesTo'].filter((key) => Object.hasOwn(input, key))
  requireOnlyKeys(input, ['schemaVersion', 'semanticMajor', 'id', 'rules', ...optional], 'Rule-set payload')
  requireText(input.id, 'Rule-set id')
  if (!Array.isArray(input.rules)) throw new BillingInputError('Rule-set rules must be an array.')
  for (const [index, rule] of input.rules.entries()) {
    if (!isRecord(rule)) throw new BillingInputError(`Rule-set rule ${index} must be an object.`)
    requirePermittedKeys(rule, RULE_KEYS, `Rule-set rule ${index}`)
    requireText(rule.id, `Rule-set rule ${index} id`)
    requireText(rule.class, `Rule-set rule ${index} class`)
  }
  return defineBillingRuleSet(input as unknown as BillingRuleSet)
}

export function decodeBillingLibrary(input: unknown): DecodedBillingLibrary {
  if (!isRecord(input) || input.resourceType !== 'Library') throw new BillingInputError('Billing carrier must be a Library.')
  const resource = freeze(structuredClone(input)) as BillingLibraryResource
  if (resource.modifierExtension !== undefined) {
    throw new BillingInputError('Billing Library schema version does not support modifierExtension.', { cause: 'modifier-extension' })
  }
  if (resource.implicitRules !== undefined) {
    throw new BillingInputError('Billing Library schema version does not support implicitRules.', { cause: 'implicit-rules' })
  }
  const kinds = relevantIdentifiers(resource, BILLING_ARTIFACT_KIND_SYSTEM)
  if (kinds.length !== 1 || (kinds[0] !== 'catalog-edition' && kinds[0] !== 'configured-rule' && kinds[0] !== 'rule-set')) {
    throw new BillingInputError('Billing Library artifact-kind must occur exactly once and be supported.')
  }
  const kind = kinds[0]
  const id = requireText(resource.id, 'Billing Library id')
  const url = requireText(resource.url, 'Billing Library url')
  const version = requireText(resource.version, 'Billing Library version')
  const status = requirePublicationStatus(resource.status)
  const effectivePeriod = resource.effectivePeriod === undefined ? undefined : validatePeriod(resource.effectivePeriod, 'Billing Library effectivePeriod')
  const links = decodeLinks(resource)
  if (kind === 'catalog-edition') {
    if (libraryType(resource) !== 'asset-collection') throw new BillingInputError('Catalog edition Library type must be asset-collection.')
    if (!links.some((link) => link.type === 'composed-of')) throw new BillingInputError('Catalog edition links must be non-empty composed-of canonical versions.')
    const members = memberLinks(links)
    const payload = validateManifest(decodeContent(resource, BILLING_CATALOG_EDITION_MIME))
    requireEditionContractLinks(links, payload)
    const { contracts } = payload
    requireEntryCodings(members, contracts !== undefined)
    const ruleCompleteness = ruleCompletenessOf(resource)
    if (ruleCompleteness === undefined) requireNoMembersDigest(members, 'Catalog edition without a rule completeness declaration')
    const sourceDigest = oneIdentifier(resource, BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM, 'Catalog source-set digest')
    const manifest = payload
    const { sources } = manifest
    if (sourceDigest !== billingCatalogSourceSetDigest(sources)) {
      throw new BillingInputError('Source-set digest does not match the manifest.', { cause: 'digest-mismatch' })
    }
    const digest = oneIdentifier(resource, BILLING_MEMBER_SET_DIGEST_SYSTEM, 'Catalog member-set digest')
    if (digest !== billingCatalogEditionDigest(members, contracts)) {
      // An edition produced before member-set digest scheme 2 is refused as such: it must be re-imported
      // with its definition digests and re-admitted (cognovis/fhir-billing-core#165).
      if (digest === billingCatalogMemberSetDigest(members.map((link) => link.resource))) {
        throw new BillingInputError('Catalog edition carries a scheme-1 member-set digest; re-import and re-admit it.', { cause: 'digest-scheme-v1' })
      }
      throw new BillingInputError('Catalog member-set digest does not match membership.', { cause: 'digest-mismatch' })
    }
    return freeze({
      kind,
      id,
      url,
      version,
      status,
      ...(effectivePeriod ? { effectivePeriod } : {}),
      publisher: requireText(resource.publisher, 'Catalog edition publisher'),
      payload,
      relatedArtifacts: members,
      ...(ruleCompleteness === undefined ? {} : { ruleCompleteness }),
      digest,
      resource,
    })
  }
  if (kind === 'configured-rule') {
    if (libraryType(resource) !== 'logic-library') throw new BillingInputError('Configured-rule Library type must be logic-library.')
    requireNoEntryDigests(links, 'Configured-rule Library')
    const dependency = configuredRuleLinks(links)
    if (dependency.some((link, index) => index > 0 && dependency[index - 1]!.resource > link.resource)) throw new BillingInputError('Configured-rule Library depends-on links must be sorted.')
    const payload = validateConfiguredRule(decodeContent(resource, BILLING_CONFIGURED_RULE_MIME))
    const digest = oneIdentifier(resource, BILLING_RULE_DIGEST_SYSTEM, 'Configured-rule digest')
    if (digest !== sha256(payload)) throw new BillingInputError('Configured-rule digest does not match the payload.', { cause: 'digest-mismatch' })
    return freeze({ kind, id, url, version, status, ...(effectivePeriod ? { effectivePeriod } : {}), payload, relatedArtifacts: dependency as unknown as BillingConfiguredRuleLibraryInput['relatedArtifacts'], digest, resource })
  }
  if (libraryType(resource) !== 'logic-library') throw new BillingInputError('Rule-set Library type must be logic-library.')
  requireNoEntryDigests(links, 'Rule-set Library')
  const payload = decodeBillingRuleSet(decodeContent(resource, BILLING_RULE_SET_MIME))
  const bindings = bindingLinks(links, payload)
  const digest = oneIdentifier(resource, BILLING_RULE_SET_DIGEST_SYSTEM, 'Rule-set digest')
  if (digest !== billingRuleSetDigest(payload)) throw new BillingInputError('Rule-set digest does not match the payload.', { cause: 'digest-mismatch' })
  // A rule-set Library published before 0.17.0 names no publisher; it still decodes and evaluates.
  const publisher = resource.publisher === undefined ? undefined : requireText(resource.publisher, 'Rule-set publisher')
  const contact = resource.contact === undefined ? undefined : validateContacts(resource.contact)
  return freeze({
    kind,
    id,
    url,
    version,
    status,
    ...(effectivePeriod ? { effectivePeriod } : {}),
    ...(publisher === undefined ? {} : { publisher }),
    ...(contact === undefined ? {} : { contact }),
    payload,
    relatedArtifacts: bindings,
    digest,
    resource,
  })
}

export function buildBillingLibrary(input: BuildBillingLibraryInput): BillingLibraryResource {
  const common = {
    resourceType: 'Library' as const,
    id: requireText(input.id, 'Billing Library id'),
    url: requireText(input.url, 'Billing Library url'),
    version: requireText(input.version, 'Billing Library version'),
    status: requirePublicationStatus(input.status),
    ...(input.effectivePeriod === undefined ? {} : { effectivePeriod: validatePeriod(input.effectivePeriod, 'Billing Library effectivePeriod') }),
  }
  let resource: BillingLibraryResource
  if (input.kind === 'catalog-edition') {
    const payload = validateManifest(input.payload)
    // A contract-bound edition's depends-on links are written from its manifest, never given.
    if (input.relatedArtifacts.length === 0 || input.relatedArtifacts.some((link) => link.type !== 'composed-of')) throw new BillingInputError('Catalog edition links must be non-empty composed-of canonical versions.')
    const plain = input.relatedArtifacts.map((link, index) => ({ type: link.type, resource: canonicalVersion(link.resource, `Catalog edition link ${index}`) }))
    const contractLinks = editionContractLinks(payload)
    const { contracts } = payload
    // A contract-bound edition names its rule-set and configured-rule Libraries for its inventory.
    if (input.ruleCompleteness === undefined && (input.definitions !== undefined || (contracts === undefined && (input.configuredRules !== undefined || input.ruleSet !== undefined)))) {
      throw new BillingInputError('Catalog edition configuredRules, definitions and ruleSet belong to a rule completeness declaration.')
    }
    if (input.ruleCompleteness !== undefined && (!Array.isArray(input.configuredRules) || !Array.isArray(input.definitions))) {
      throw new BillingInputError('A rule completeness declaration requires the configuredRules and definitions it binds.')
    }
    const memberSet = new Set(plain.map((link) => link.resource))
    const digests = input.ruleCompleteness === undefined ? new Map<string, string>() : configuredRuleMembersDigests(input.configuredRules!, input.definitions!, input.ruleSet, memberSet)
    const definitionDigests = catalogDefinitionDigests(input.catalogDefinitions, memberSet)
    // A contract-bound edition names each definition's coding on its entry (cognovis/fhir-billing-core#127).
    const definitionCodings = new Map<string, string>(contracts === undefined ? [] : (input.catalogDefinitions as Record<string, unknown>[]).map((definition, index) => (
      [`${String(definition.url)}|${String(definition.version)}`, definitionCodingKey(definition, `Catalog definition ${index}`)] as const
    )))
    // A declaring edition names its whole definition inventory: each must come with its content.
    if (contracts !== undefined) requireBoundInventory(plain.map((link) => link.resource), definitionDigests, input.ruleSet, input.configuredRules)
    const unpriced = (input.definitions ?? []).find((definition) => !definitionDigests.has(definition.canonical))
    if (unpriced !== undefined) throw new BillingInputError(`Catalog definition ${unpriced.canonical} is in definitions but missing from catalogDefinitions.`)
    const members: BillingCatalogEditionMemberLink[] = plain.map((link) => {
      const catalogDefinitionDigest = definitionDigests.get(link.resource)
      const configuredRuleMembersDigest = digests.get(link.resource)
      const catalogDefinitionCoding = definitionCodings.get(link.resource)
      return {
        type: 'composed-of',
        resource: link.resource,
        ...(catalogDefinitionDigest === undefined ? {} : { catalogDefinitionDigest }),
        ...(configuredRuleMembersDigest === undefined ? {} : { configuredRuleMembersDigest }),
        ...(catalogDefinitionCoding === undefined ? {} : { catalogDefinitionCoding }),
      }
    })
    const links = members.map((member) => {
      const extension = [
        ...(member.catalogDefinitionDigest === undefined ? [] : [{ url: BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION, valueString: member.catalogDefinitionDigest }]),
        ...(member.configuredRuleMembersDigest === undefined ? [] : [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: member.configuredRuleMembersDigest }]),
        ...(member.catalogDefinitionCoding === undefined ? [] : [{ url: BILLING_CATALOG_DEFINITION_CODING_EXTENSION, valueString: member.catalogDefinitionCoding }]),
      ]
      return extension.length === 0 ? { type: member.type, resource: member.resource } : { type: member.type, resource: member.resource, extension }
    })
    const manifest = payload
    const { sources } = manifest
    const sourceSetDigest = billingCatalogSourceSetDigest(sources)
    const manifestData = Buffer.from(canonicalizeJson(payload), 'utf8').toString('base64')
    resource = {
      ...common,
      publisher: requireText(input.publisher, 'Catalog edition publisher'),
      type: { coding: [{ system: LIBRARY_TYPE_SYSTEM, code: 'asset-collection' }] },
      identifier: [
        { system: BILLING_ARTIFACT_KIND_SYSTEM, value: input.kind },
        { system: BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM, value: sourceSetDigest },
        { system: BILLING_MEMBER_SET_DIGEST_SYSTEM, value: billingCatalogEditionDigest(members, contracts) },
        ...(input.ruleCompleteness === undefined ? [] : [{ system: BILLING_RULE_COMPLETENESS_SYSTEM, value: requireRuleCompleteness(input.ruleCompleteness) }]),
      ],
      relatedArtifact: [...links, ...contractLinks],
      content: [{ contentType: BILLING_CATALOG_EDITION_MIME, data: manifestData }],
    }
  } else if (input.kind === 'configured-rule') {
    const payload = validateConfiguredRule(input.payload)
    const links = configuredRuleLinks(input.relatedArtifacts).sort((left, right) => left.resource < right.resource ? -1 : left.resource > right.resource ? 1 : 0)
    resource = {
      ...common,
      type: { coding: [{ system: LIBRARY_TYPE_SYSTEM, code: 'logic-library' }] },
      identifier: [{ system: BILLING_ARTIFACT_KIND_SYSTEM, value: input.kind }, { system: BILLING_RULE_DIGEST_SYSTEM, value: sha256(payload) }],
      relatedArtifact: links,
      content: [{ contentType: BILLING_CONFIGURED_RULE_MIME, data: Buffer.from(canonicalizeJson(payload), 'utf8').toString('base64') }],
    }
  } else {
    const payload = defineBillingRuleSet(input.payload)
    const links: BillingLibraryRelatedArtifact[] = (input.relatedArtifacts as readonly BillingLibraryRelatedArtifact[]).map((link) => ({ type: link.type, resource: requireText(link.resource, 'Rule-set binding link') }))
    const bindings = bindingLinks(links, payload)
    resource = {
      ...common,
      publisher: requireText(input.publisher, 'Rule-set publisher'),
      ...(input.contact === undefined ? {} : { contact: validateContacts(input.contact) }),
      type: { coding: [{ system: LIBRARY_TYPE_SYSTEM, code: 'logic-library' }] },
      identifier: [{ system: BILLING_ARTIFACT_KIND_SYSTEM, value: input.kind }, { system: BILLING_RULE_SET_DIGEST_SYSTEM, value: billingRuleSetDigest(payload) }],
      ...(bindings.length === 0 ? {} : { relatedArtifact: bindings }),
      content: [{ contentType: BILLING_RULE_SET_MIME, data: Buffer.from(canonicalizeJson(payload), 'utf8').toString('base64') }],
    }
  }
  return decodeBillingLibrary(resource).resource
}
