/**
 * The carrier of contract-bound catalog editions (cognovis/fhir-billing-core#127, ADR-005): an edition
 * bound to Contract canonicals by `depends-on` related artifacts and the same Contracts in its
 * digest-covered manifest. Selecting such an edition for a case is the Billing SDK's task (cognovis/chp).
 * Every Contract, code system, price and rule is synthetic.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { BILLING_CATALOG_DEFINITION_CODING_EXTENSION, BILLING_MEMBER_SET_DIGEST_SYSTEM, type BillingCatalogEditionManifestV1, type BillingRuleSet } from '@cognovis/fhir-billing-types'
import { billingCatalogEditionDigest, buildBillingLibrary, canonicalizeJson, decodeBillingLibrary, type BillingCatalogEditionLibraryInput } from '@cognovis/fhir-billing-rules'

const SYNTHETIC_YEAR = { start: '2026-01-01', end: '2026-12-31' } as const
const SELECTIVE = 'https://example.invalid/Contract/synthetic-selective-contract'
const OTHER = 'https://example.invalid/Contract/synthetic-other-contract'
const HZV_SYSTEM = 'https://example.invalid/CodeSystem/synthetic-hzv-service'
const RULES_VERSION = '2026.1'

function contentDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value)).digest('hex')}`
}

/** A native catalog member ChargeItemDefinition with its declared catalog digest. */
function nativeCatalogDefinition(input: { id: string; url: string; version: string; system: string; code: string; unitPrice: string }): Record<string, unknown> {
  const code = { coding: [{ system: input.system, code: input.code }] }
  const propertyGroup = [{ priceComponent: [{ type: 'base', amount: { value: Number(input.unitPrice), currency: 'EUR' } }] }]
  return {
    resourceType: 'ChargeItemDefinition',
    id: input.id,
    url: input.url,
    version: input.version,
    status: 'active',
    code,
    effectivePeriod: { ...SYNTHETIC_YEAR },
    identifier: [{
      system: 'https://fhir.cognovis.de/billing-core/sid/catalog-digest',
      value: contentDigest({ resourceType: 'ChargeItemDefinition', url: input.url, version: input.version, code, propertyGroup }),
    }],
    propertyGroup,
  }
}

/** A native rule-set Library carrier for the synthetic year. */
function nativeRuleSetLibrary(input: { id: string; url: string; version: string; payload: BillingRuleSet }): Record<string, unknown> {
  return { ...buildBillingLibrary({ kind: 'rule-set', id: input.id, url: input.url, version: input.version, status: 'active', effectivePeriod: { ...SYNTHETIC_YEAR }, publisher: 'Synthetic Rule Authority', payload: input.payload, relatedArtifacts: [] }) }
}

function manifest(scope: string, contracts?: readonly string[]): BillingCatalogEditionManifestV1 {
  return {
    schemaVersion: 1,
    kind: 'billing-catalog-edition',
    catalogScope: scope,
    publicationPeriod: { ...SYNTHETIC_YEAR },
    sources: [{
      sourceUri: `https://example.invalid/source/${scope}`,
      sourceVersion: '2026',
      sourceDigest: `sha256:${'4'.repeat(64)}`,
      retrievedAt: '2026-01-02T00:00:00Z',
      producerVersion: 'synthetic-producer-1',
      completeness: 'complete',
    }],
    ...(contracts !== undefined ? { contracts } : {}),
  }
}

interface EditionSpec {
  /** Edition key; also the id stem of its definitions and rule set. */
  readonly key: string
  readonly system: string
  /** Code to unit price. */
  readonly prices: Readonly<Record<string, string>>
  /** The Contract canonicals the edition is bound to; absent for an unbound edition. */
  readonly contracts?: readonly string[]
}

function editionUrl(key: string): string {
  return `https://example.invalid/Library/synthetic-${key}-edition`
}

/** An edition's catalog definitions, rule set and edition Library; its rules name its codes without a system. */
function edition(spec: EditionSpec): Record<string, unknown>[] {
  const version = '2026'
  const definitions = Object.entries(spec.prices).map(([code, unitPrice]) => nativeCatalogDefinition({
    id: `synthetic-${spec.key}-${code.toLowerCase()}`,
    url: `https://example.invalid/ChargeItemDefinition/synthetic-${spec.key}-${code.toLowerCase()}`,
    version,
    system: spec.system,
    code,
    unitPrice,
  }))
  const rulesUrl = `https://example.invalid/Library/synthetic-${spec.key}-rules`
  const rules = nativeRuleSetLibrary({
    id: `synthetic-${spec.key}-rules-${version}`,
    url: rulesUrl,
    version: RULES_VERSION,
    payload: {
      schemaVersion: 2,
      semanticMajor: 4,
      id: `synthetic-${spec.key}-rules`,
      rules: [{ id: `${spec.key}-limit`, class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { codes: Object.keys(spec.prices) }, maximum: 3 } }],
    },
  })
  const library = editionLibrary({
    id: `synthetic-${spec.key}-edition-${version}`,
    url: editionUrl(spec.key),
    version,
    payload: manifest(`synthetic-${spec.key}`, spec.contracts),
    members: [...definitions.map((definition) => `${String(definition.url)}|${version}`), `${rulesUrl}|${RULES_VERSION}`],
    definitions,
    ruleSet: rules,
  })
  return [library, ...definitions, rules]
}

interface EditionLibrarySpec {
  readonly id: string
  readonly url: string
  readonly version: string
  readonly payload: BillingCatalogEditionManifestV1
  readonly members: readonly string[]
  readonly definitions: readonly Record<string, unknown>[]
  /** The edition's rule-set Library member, part of a contract-bound edition's inventory. */
  readonly ruleSet?: Record<string, unknown>
  /** A writer's `depends-on` links in place of those the builder wrote. */
  readonly links?: readonly string[]
}

function editionInput(input: EditionLibrarySpec): BillingCatalogEditionLibraryInput {
  return {
    kind: 'catalog-edition',
    id: input.id,
    url: input.url,
    version: input.version,
    status: 'active',
    effectivePeriod: { ...SYNTHETIC_YEAR },
    publisher: 'Synthetic HZV Partner',
    payload: input.payload,
    relatedArtifacts: input.members.map((resource) => ({ type: 'composed-of' as const, resource })),
    catalogDefinitions: input.definitions,
    ...(input.ruleSet !== undefined && input.payload.contracts !== undefined ? { ruleSet: input.ruleSet } : {}),
  }
}

function editionLibrary(input: EditionLibrarySpec): Record<string, unknown> {
  const library = { ...buildBillingLibrary(editionInput(input)) }
  if (input.links === undefined) return library
  const members = (library.relatedArtifact as unknown as { type: string }[]).filter((link) => link.type === 'composed-of')
  return { ...library, relatedArtifact: [...members, ...input.links.map((resource) => ({ type: 'depends-on', resource }))] }
}

/** The selective Contract's own HZV tariff: H-1 at 20.00. */
const SELECTIVE_TARIFF: EditionSpec = { key: 'hzv-selective', system: HZV_SYSTEM, prices: { 'H-1': '20.00' }, contracts: [SELECTIVE] }

describe('contract-bound catalog edition carrier', () => {
  const definition = nativeCatalogDefinition({ id: 'carrier-h-1', url: 'https://example.invalid/ChargeItemDefinition/carrier-h-1', version: '2026', system: HZV_SYSTEM, code: 'H-1', unitPrice: '20.00' })
  const base = { id: 'carrier-edition', url: editionUrl('carrier'), version: '2026', members: ['https://example.invalid/ChargeItemDefinition/carrier-h-1|2026'], definitions: [definition] }
  const dependsOn = (library: Record<string, unknown>) => (library.relatedArtifact as { type: string; resource: string }[]).filter((link) => link.type === 'depends-on').map((link) => link.resource)

  it('writes one depends-on link per manifest Contract and decodes the edition back', () => {
    const library = editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE, OTHER]) })
    assert.deepEqual(dependsOn(library), [OTHER, SELECTIVE].sort())
    assert.deepEqual(dependsOn(editionLibrary({ ...base, payload: manifest('carrier') })), [])

    const decoded = decodeBillingLibrary(library)
    assert.equal(decoded.kind, 'catalog-edition')
    if (decoded.kind !== 'catalog-edition') return
    assert.deepEqual(decoded.payload.contracts, [SELECTIVE, OTHER])
    assert.deepEqual(decoded.relatedArtifacts.map((link) => link.type), ['composed-of'])
    // A decoded edition rebuilds to the same Library.
    assert.deepEqual(buildBillingLibrary({ ...decoded, catalogDefinitions: [definition] }), decoded.resource)
  })

  it('refuses an edition whose depends-on Contracts differ from its manifest', () => {
    assert.throws(() => decodeBillingLibrary(editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE]), links: [OTHER] })), /depends-on .*Contract/i)
    assert.throws(() => decodeBillingLibrary(editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE, OTHER]), links: [SELECTIVE] })), /depends-on .*Contract/i)
    assert.throws(() => decodeBillingLibrary(editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE]), links: [SELECTIVE, SELECTIVE] })), /depends-on .*Contract/i)
  })

  it('refuses an edition that is both bound and unbound', () => {
    // Bound by its links, unbound by its manifest.
    assert.throws(() => decodeBillingLibrary(editionLibrary({ ...base, payload: manifest('carrier'), links: [SELECTIVE] })), /depends-on .*Contract/i)
    // Bound by its manifest, unbound by its links.
    assert.throws(() => decodeBillingLibrary(editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE]), links: [] })), /depends-on .*Contract/i)
    // An empty Contract list binds nothing and unbinds nothing; a Contract is an absolute canonical, named once.
    assert.throws(() => editionLibrary({ ...base, payload: manifest('carrier', []) }), /contracts must be a non-empty/i)
    assert.throws(() => editionLibrary({ ...base, payload: manifest('carrier', ['not-a-canonical']) }), /absolute canonical/i)
    assert.throws(() => editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE, SELECTIVE]) }), /unique/i)
    // A depends-on link is no build input: the builder writes them from the manifest.
    assert.throws(() => buildBillingLibrary({ ...editionInput({ ...base, payload: manifest('carrier', [SELECTIVE]) }), relatedArtifacts: [{ type: 'depends-on', resource: SELECTIVE }] as never }), /composed-of/i)
  })

  it('names each definition coding on a contract-bound edition entry, covered by the member-set digest', () => {
    type Entry = { type: string; resource: string; extension?: { url: string; valueString: string }[] }
    const codingOf = (entry: Entry) => entry.extension?.find((extension) => extension.url === BILLING_CATALOG_DEFINITION_CODING_EXTENSION)?.valueString
    const bound = editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE]) })
    const boundEntries = bound.relatedArtifact as Entry[]
    assert.deepEqual(boundEntries.filter((entry) => entry.type === 'composed-of').map(codingOf), [`${HZV_SYSTEM}|H-1`])
    assert.deepEqual((editionLibrary({ ...base, payload: manifest('carrier') }).relatedArtifact as Entry[]).map(codingOf), [undefined])
    const decoded = decodeBillingLibrary(bound)
    if (decoded.kind !== 'catalog-edition') return assert.fail('expected a catalog edition')
    assert.equal(decoded.relatedArtifacts[0]!.catalogDefinitionCoding, `${HZV_SYSTEM}|H-1`)
    // The coding is in the digest: another coding no longer matches the declared digest.
    const recoded = { ...bound, relatedArtifact: boundEntries.map((entry) => entry.extension === undefined ? entry : { ...entry, extension: entry.extension.map((extension) => extension.url === BILLING_CATALOG_DEFINITION_CODING_EXTENSION ? { ...extension, valueString: `${HZV_SYSTEM}|H-2` } : extension) }) }
    assert.throws(() => decodeBillingLibrary(recoded), /member-set digest/i)
    // A bound edition's definition entry without its coding, or an unbound edition's entry with one, is refused.
    const uncoded = { ...bound, relatedArtifact: boundEntries.map((entry) => entry.extension === undefined ? entry : { ...entry, extension: entry.extension.filter((extension) => extension.url !== BILLING_CATALOG_DEFINITION_CODING_EXTENSION) }) }
    assert.throws(() => decodeBillingLibrary(uncoded), /catalog definition coding/i)
    const unbound = editionLibrary({ ...base, payload: manifest('carrier') })
    const coded = { ...unbound, relatedArtifact: (unbound.relatedArtifact as Entry[]).map((entry) => ({ ...entry, extension: [...(entry.extension ?? []), { url: BILLING_CATALOG_DEFINITION_CODING_EXTENSION, valueString: `${HZV_SYSTEM}|H-1` }] })) }
    assert.throws(() => decodeBillingLibrary(coded), /catalog definition coding/i)
  })

  it('binds the Contract assignment in the member-set digest, and leaves an unbound edition digest unchanged', () => {
    const unbound = editionLibrary({ ...base, payload: manifest('carrier') })
    const selective = editionLibrary({ ...base, payload: manifest('carrier', [SELECTIVE]) })
    const other = editionLibrary({ ...base, payload: manifest('carrier', [OTHER]) })
    const digest = (library: Record<string, unknown>) => (library.identifier as { system: string; value: string }[]).find((identifier) => identifier.system === BILLING_MEMBER_SET_DIGEST_SYSTEM)!.value
    const decoded = decodeBillingLibrary(unbound)
    if (decoded.kind !== 'catalog-edition') return assert.fail('expected a catalog edition')
    const members = decoded.relatedArtifacts
    assert.equal(digest(unbound), billingCatalogEditionDigest(members))
    const boundDecoded = decodeBillingLibrary(selective)
    if (boundDecoded.kind !== 'catalog-edition') return assert.fail('expected a catalog edition')
    assert.equal(digest(selective), billingCatalogEditionDigest(boundDecoded.relatedArtifacts, [SELECTIVE]))
    assert.notEqual(digest(selective), digest(unbound))
    assert.notEqual(digest(selective), digest(other))
    // The Contract order does not change the digest.
    assert.equal(billingCatalogEditionDigest(members, [SELECTIVE, OTHER]), billingCatalogEditionDigest(members, [OTHER, SELECTIVE]))
  })
})

describe('contract-bound catalog edition inventory', () => {
  it('refuses to build a contract-bound edition from an incomplete inventory', () => {
    const [library, ...rest] = edition(SELECTIVE_TARIFF)
    const rules = rest.find((resource) => resource.resourceType === 'Library')!
    const members = (library!.relatedArtifact as { type: string; resource: string }[]).filter((link) => link.type === 'composed-of').map((link) => link.resource)
    const spec = { id: String(library!.id), url: String(library!.url), version: String(library!.version), payload: manifest('synthetic-hzv-selective', [SELECTIVE]), members }
    // The producer lists the H-1 definition as a member but leaves it out of catalogDefinitions.
    assert.throws(() => editionLibrary({ ...spec, definitions: [], ruleSet: rules }), /whole inventory/)
    // Or leaves out the rule-set Library.
    assert.throws(() => editionLibrary({ ...spec, definitions: rest.filter((resource) => resource.resourceType === 'ChargeItemDefinition') }), /whole inventory/)
    // A member it names but cannot classify is refused, and the complete inventory builds.
    assert.ok(editionLibrary({ ...spec, definitions: rest.filter((resource) => resource.resourceType === 'ChargeItemDefinition'), ruleSet: rules }))
  })
})
