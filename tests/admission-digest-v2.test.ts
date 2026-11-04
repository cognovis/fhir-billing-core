import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BillingInputError,
  billingCatalogDefinitionDigest,
  billingCatalogEditionDigest,
  billingCatalogMemberSetDigest,
  buildBillingLibrary,
  type BillingCatalogEditionMemberLink,
  decodeBillingLibrary,
} from '@cognovis/fhir-billing-rules'
import {
  BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION,
  BILLING_MEMBER_SET_DIGEST_SYSTEM,
  type BillingCatalogEditionManifestV1,
} from '@cognovis/fhir-billing-types'

// Member-set digest v2 (cognovis/fhir-billing-core#165, F1/F2): the digest an admission record binds for a
// native catalog edition covers each catalog definition's content (its prices) and each definition's
// configured-rule members digest, not only the member `url|version` strings. The admission of an edition
// through the SDK is tested with the SDK in cognovis/chp (fhir-foundation/packages/fhir-billing-sdk).

const manifest: BillingCatalogEditionManifestV1 = {
  schemaVersion: 1,
  kind: 'billing-catalog-edition',
  catalogScope: 'synthetic-catalog',
  publicationPeriod: { start: '2026-01-01', end: '2026-12-31' },
  sources: [{
    sourceUri: 'https://example.invalid/source/synthetic-catalog',
    sourceVersion: '2026',
    sourceDigest: `sha256:${'1'.repeat(64)}`,
    retrievedAt: '2026-01-02T00:00:00Z',
    producerVersion: 'synthetic-mapper-1',
    completeness: 'complete',
  }],
}

function definition(amount: number): Record<string, unknown> {
  return {
    resourceType: 'ChargeItemDefinition',
    id: 'cid-1',
    url: 'https://example.invalid/ChargeItemDefinition/cid-1',
    version: 'synthetic-2026',
    status: 'active',
    code: { coding: [{ system: 'https://example.invalid/synthetic', code: 'SYN-1' }] },
    propertyGroup: [{ priceComponent: [{ type: 'base', amount: { value: amount, currency: 'EUR' } }] }],
  }
}

const DEFINITION = 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026'
const RULE_SET = 'https://example.invalid/Library/rules-1|synthetic-rules'

const EDITION_INPUT = {
  kind: 'catalog-edition',
  id: 'edition-1',
  url: 'https://example.invalid/Library/edition-1',
  version: '2026',
  status: 'active',
  publisher: 'Synthetic Catalog Authority',
  payload: manifest,
  relatedArtifacts: [{ type: 'composed-of', resource: DEFINITION }, { type: 'composed-of', resource: RULE_SET }],
} as const

function edition(catalogDefinitions: readonly Record<string, unknown>[] = [definition(10)]): Record<string, unknown> {
  return buildBillingLibrary({ ...EDITION_INPUT, catalogDefinitions }) as unknown as Record<string, unknown>
}

function memberSetDigest(resource: Record<string, unknown>): unknown {
  return (resource.identifier as { system: string; value: string }[]).find((entry) => entry.system === BILLING_MEMBER_SET_DIGEST_SYSTEM)?.value
}

function links(resource: Record<string, unknown>): Record<string, unknown>[] {
  return resource.relatedArtifact as Record<string, unknown>[]
}

function causeOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof BillingInputError, String(error))
    return (error as { cause?: unknown }).cause
  }
  assert.fail('expected a BillingInputError')
}

describe('member-set digest v2 (cognovis/fhir-billing-core#165)', () => {
  it('the definition digest covers the prices and nothing outside the definition content', () => {
    assert.match(billingCatalogDefinitionDigest(definition(10)), /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(billingCatalogDefinitionDigest(definition(10)), billingCatalogDefinitionDigest(definition(11)))
    assert.equal(billingCatalogDefinitionDigest({ ...definition(10), id: 'other', meta: { versionId: '9' } }), billingCatalogDefinitionDigest(definition(10)))
  })

  it('an edition carries each definition digest on its entry, and its member-set digest covers it', () => {
    const built = edition()
    assert.deepEqual(links(built)[0], {
      type: 'composed-of',
      resource: DEFINITION,
      extension: [{ url: BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION, valueString: billingCatalogDefinitionDigest(definition(10)) }],
    })
    assert.deepEqual(links(built)[1], { type: 'composed-of', resource: RULE_SET })
    const decoded = decodeBillingLibrary(built)
    assert.equal(decoded.kind, 'catalog-edition')
    const members = decoded.relatedArtifacts as readonly BillingCatalogEditionMemberLink[]
    assert.equal(members[0]!.catalogDefinitionDigest, billingCatalogDefinitionDigest(definition(10)))
    assert.equal(memberSetDigest(built), billingCatalogEditionDigest(members))
    assert.notEqual(memberSetDigest(built), billingCatalogMemberSetDigest([DEFINITION, RULE_SET]))
    // Another price is another edition digest: an admission of one never admits the other.
    assert.notEqual(memberSetDigest(edition([definition(11)])), memberSetDigest(built))
  })

  it('refuses an edition whose definition digest was changed without its member-set digest', () => {
    const tampered = structuredClone(edition())
    ;(links(tampered)[0]!.extension as { valueString: string }[])[0]!.valueString = billingCatalogDefinitionDigest(definition(99))
    assert.equal(causeOf(() => decodeBillingLibrary(tampered)), 'digest-mismatch')
  })

  it('refuses an edition still carrying a v1 member-set digest as one to re-import and re-admit', () => {
    const v1 = structuredClone(edition())
    for (const link of links(v1)) delete link.extension
    ;(v1.identifier as { system: string; value: string }[]).find((entry) => entry.system === BILLING_MEMBER_SET_DIGEST_SYSTEM)!.value = billingCatalogMemberSetDigest([DEFINITION, RULE_SET])
    assert.equal(causeOf(() => decodeBillingLibrary(v1)), 'digest-scheme-v1')
  })

  it('requires the catalog definitions to build an edition, each a member and given once', () => {
    assert.throws(() => buildBillingLibrary(EDITION_INPUT as never), /catalogDefinitions/)
    assert.throws(() => edition([{ ...definition(10), url: 'https://example.invalid/ChargeItemDefinition/other' }]), /not a member/)
    assert.equal(causeOf(() => edition([definition(10), definition(10)])), 'duplicate')
  })

  it('refuses a per-code edition whose definitions inventory names a definition missing from catalogDefinitions', () => {
    const perCode = (catalogDefinitions: readonly Record<string, unknown>[]) => buildBillingLibrary({
      ...EDITION_INPUT,
      relatedArtifacts: [{ type: 'composed-of', resource: DEFINITION }],
      ruleCompleteness: 'configured-rule-per-code',
      configuredRules: [],
      definitions: [{ canonical: DEFINITION, system: 'https://example.invalid/synthetic', code: 'SYN-1' }],
      catalogDefinitions,
    })
    assert.ok(perCode([definition(10)]))
    assert.throws(() => perCode([]), /catalogDefinitions/)
  })
})
