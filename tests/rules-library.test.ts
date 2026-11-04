import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  canonicalizeJson,
  billingCatalogEditionDigest,
  billingCatalogMemberSetDigest,
  billingCatalogSourceSetDigest,
  billingConfiguredRuleMembersDigest,
  billingRuleNamedCodes,
  buildBillingLibrary,
  decodeBillingLibrary,
} from '@cognovis/fhir-billing-rules'
import {
  BILLING_ARTIFACT_KIND_SYSTEM,
  BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION,
  BILLING_RULE_COMPLETENESS_SYSTEM,
  type BillingCatalogEditionManifestV1,
  type BillingConfiguredRulePayloadV2,
  type BillingRule,
  type BillingRuleSet,
} from '@cognovis/fhir-billing-types'

const JSON_CONTENT_TYPE = 'application/json'
const MEMBER_SET_DIGEST = 'sha256:0f3ae7b6df0e75b8ce92c6eeab0201708bbb3375711a329c2bccf9044ca69375'
// The scheme-2 member-set digest of the same two members without entry digests (cognovis/fhir-billing-core#165).
const EDITION_DIGEST = 'sha256:05e5e317044df08438a0f2eec03928a9a341a09fe72ee5d99dd0956a52c71818'
const SOURCE_SET_DIGEST = 'sha256:457ba7ac9dda0b013975af9dcf9aba1e91ae4b89c2b4e54a3f09c56f7ed70e49'
const CONFIGURED_RULE_DIGEST = 'sha256:fb56dfa9805b1a2d299793695bd83e6a4b2a0b1eaee54c93b10cd161e7444ea3'
const RULE_SET_DIGEST = 'sha256:aa08aa2c5d268b3aa7143656ec1069caab64debe2d3910f5a2a4875bef858ee2'
const CONFIGURED_RULE_CANONICAL_JSON = '{"rule":{"class":"quantity-limit","effect":"reject","id":"configured-limit","mustUnderstand":true,"parameters":{"maximum":2,"selector":{"codes":["SYN-1"],"system":"https://example.invalid/synthetic"}},"priority":1},"schemaVersion":2,"semanticMajor":4}'

const catalogManifest: BillingCatalogEditionManifestV1 = {
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

const configuredRulePayload: BillingConfiguredRulePayloadV2 = {
  schemaVersion: 2,
  semanticMajor: 4,
  rule: {
    id: 'configured-limit',
    class: 'quantity-limit',
    mustUnderstand: true,
    effect: 'reject',
    priority: 1,
    parameters: {
      selector: { system: 'https://example.invalid/synthetic', codes: ['SYN-1'] },
      maximum: 2,
    },
  },
}

const ruleSetPayload: BillingRuleSet = {
  schemaVersion: 2,
  semanticMajor: 4,
  id: 'synthetic-rules',
  rules: [configuredRulePayload.rule],
}

const catalogMembers = [
  'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026',
  'https://example.invalid/Library/rules-1|synthetic-rules',
] as const

function identifiers(resource: unknown): readonly Record<string, unknown>[] {
  if (!resource || typeof resource !== 'object' || !('identifier' in resource) || !Array.isArray(resource.identifier)) return []
  return resource.identifier.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
}

/** Minimal ChargeItemDefinitions of a per-code definitions inventory, as a producer passes them beside it. */
function inventoryDefinitions(definitions: readonly { readonly canonical: string; readonly system: string; readonly code: string }[]): Record<string, unknown>[] {
  return definitions.map(({ canonical, system, code }) => {
    const separator = canonical.lastIndexOf('|')
    return { resourceType: 'ChargeItemDefinition', url: canonical.slice(0, separator), version: canonical.slice(separator + 1), status: 'active', code: { coding: [{ system, code }] } }
  })
}

/** The configured-rule members digest extensions of an edition entry; a definition entry also carries its content digest. */
function membersDigestExtensions(entry: Record<string, unknown> | undefined): unknown[] {
  return (Array.isArray(entry?.extension) ? entry.extension : []).filter((extension: { url?: unknown }) => extension.url === BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION)
}

function content(resource: unknown): readonly { contentType?: unknown; data?: unknown }[] {
  if (!resource || typeof resource !== 'object' || !('content' in resource) || !Array.isArray(resource.content)) return []
  return resource.content
}

function mutateResource<T>(resource: T, mutate: (copy: Record<string, unknown>) => void): T {
  const copy = structuredClone(resource) as Record<string, unknown>
  mutate(copy)
  return copy as T
}

function replacePayload<T>(resource: T, payload: unknown): T {
  return mutateResource(resource, (copy) => {
    const attachments = copy.content as Record<string, unknown>[]
    attachments[0] = {
      ...attachments[0],
      data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    }
  })
}

function libraryFixture(kind: 'catalog-edition' | 'configured-rule' | 'rule-set') {
  if (kind === 'catalog-edition') {
    return buildBillingLibrary({
      kind,
      id: 'edition-1',
      url: 'https://example.invalid/Library/catalog-edition',
      version: 'synthetic-2026',
      status: 'active',
      publisher: 'Synthetic Authority',
      payload: catalogManifest,
      relatedArtifacts: catalogMembers.map((resource) => ({ type: 'composed-of' as const, resource })),
      catalogDefinitions: [],
    })
  }
  if (kind === 'configured-rule') {
    return buildBillingLibrary({
      kind,
      id: 'configured-rule-1',
      url: 'https://example.invalid/Library/configured-rule-1',
      version: '1.0.0',
      status: 'active',
      payload: configuredRulePayload,
      relatedArtifacts: [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }],
    })
  }
  return buildBillingLibrary({
    kind,
    id: 'rules-1',
    url: 'https://example.invalid/Library/rules-1',
    version: 'publication-2026.08',
    status: 'active',
    publisher: 'Synthetic Rule Authority',
    payload: ruleSetPayload,
    relatedArtifacts: [],
  })
}

/**
 * Expected shared Library contract from
 * the internal praxis audit of 2026-09-19 (reverse-proof.md)
 * worked_example_pointer: reverse-proof.md#billing-core-eight-profiles-no-demonstrated-indispensable-wrapper
 *
 * The shared attachment content type is independently grounded in the R4
 * Attachment.contentType required MimeType binding:
 * https://hl7.org/fhir/R4/datatypes-definitions.html#Attachment.contentType
 * ig_canonical: http://hl7.org/fhir/StructureDefinition/Attachment
 * element: Attachment.contentType
 * Publisher failure evidence: output/qa.html and the validation OperationOutcome
 * in output/qa.xml report two MimeType errors for each of the three native Libraries.
 */
describe('shared native Billing Library API', () => {
  it('builds and decodes catalog-edition, configured-rule, and rule-set Libraries', () => {
    assert.equal(billingCatalogSourceSetDigest(catalogManifest.sources), SOURCE_SET_DIGEST)
    assert.equal(billingCatalogMemberSetDigest(catalogMembers), MEMBER_SET_DIGEST)

    const catalog = buildBillingLibrary({
      kind: 'catalog-edition',
      id: 'edition-1',
      url: 'https://example.invalid/Library/catalog-edition',
      version: 'synthetic-2026',
      status: 'active',
      publisher: 'Synthetic Authority',
      effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      payload: catalogManifest,
      relatedArtifacts: catalogMembers.map((resource) => ({ type: 'composed-of' as const, resource })),
      catalogDefinitions: [],
    })
    const configuredRule = buildBillingLibrary({
      kind: 'configured-rule',
      id: 'configured-rule-1',
      url: 'https://example.invalid/Library/configured-rule-1',
      version: '1.0.0',
      status: 'active',
      effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      payload: configuredRulePayload,
      relatedArtifacts: [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }],
    })
    const ruleSet = buildBillingLibrary({
      kind: 'rule-set',
      id: 'rules-1',
      url: 'https://example.invalid/Library/rules-1',
      version: 'synthetic-rules',
      status: 'active',
      publisher: 'Synthetic Rule Authority',
      effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      payload: ruleSetPayload,
      relatedArtifacts: [],
    })

    const cases = [
      { kind: 'catalog-edition', resource: catalog, digest: EDITION_DIGEST, payload: catalogManifest },
      { kind: 'configured-rule', resource: configuredRule, digest: CONFIGURED_RULE_DIGEST, payload: configuredRulePayload },
      { kind: 'rule-set', resource: ruleSet, digest: RULE_SET_DIGEST, payload: ruleSetPayload },
    ] as const
    assert.equal(cases.length, 3)
    for (const testCase of cases) {
      assert.equal(testCase.resource.resourceType, 'Library')
      assert.equal(testCase.resource.type.coding?.[0]?.system, 'http://terminology.hl7.org/CodeSystem/library-type')
      assert.equal(testCase.resource.type.coding?.[0]?.code, testCase.kind === 'catalog-edition' ? 'asset-collection' : 'logic-library')
      assert.ok(identifiers(testCase.resource).some((item) => item.system === BILLING_ARTIFACT_KIND_SYSTEM && item.value === testCase.kind))
      assert.equal(content(testCase.resource).length, 1)
      assert.equal(content(testCase.resource)[0]?.contentType, JSON_CONTENT_TYPE)
      assert.equal('meta' in testCase.resource, false)
      assert.equal('extension' in testCase.resource, false)
      const decoded = decodeBillingLibrary(testCase.resource)
      assert.equal(decoded.kind, testCase.kind)
      assert.equal(decoded.digest, testCase.digest)
      assert.deepEqual(decoded.payload, testCase.payload)
      assert.deepEqual(decoded.resource, testCase.resource)
    }
    assert.equal(Buffer.from(content(configuredRule)[0]!.data as string, 'base64').toString('utf8'), CONFIGURED_RULE_CANONICAL_JSON)
    assert.deepEqual(configuredRule.relatedArtifact, [
      { type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' },
    ])
  })

  it('rejects generic JSON and malformed MIME, schema, kind, type, content, or exact-version links', () => {
    const configuredRule = buildBillingLibrary({
      kind: 'configured-rule',
      id: 'configured-rule-1',
      url: 'https://example.invalid/Library/configured-rule-1',
      version: '1.0.0',
      status: 'active',
      payload: configuredRulePayload,
      relatedArtifacts: [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }],
    })
    const catalog = buildBillingLibrary({
      kind: 'catalog-edition',
      id: 'edition-1',
      url: 'https://example.invalid/Library/catalog-edition',
      version: 'synthetic-2026',
      status: 'active',
      publisher: 'Synthetic Authority',
      payload: catalogManifest,
      relatedArtifacts: catalogMembers.map((resource) => ({ type: 'composed-of' as const, resource })),
      catalogDefinitions: [],
    })
    const ruleSet = buildBillingLibrary({
      kind: 'rule-set',
      id: 'rules-1',
      url: 'https://example.invalid/Library/rules-1',
      version: 'synthetic-rules',
      status: 'active',
      publisher: 'Synthetic Rule Authority',
      payload: ruleSetPayload,
      relatedArtifacts: [],
    })
    const unrelatedJsonLibrary = {
      resourceType: 'Library',
      id: 'unrelated-json',
      url: 'https://example.invalid/Library/unrelated-json',
      version: '1',
      status: 'active',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'logic-library' }] },
      content: [{ contentType: JSON_CONTENT_TYPE, data: Buffer.from('{"purpose":"unrelated"}', 'utf8').toString('base64') }],
    }
    const cases = [
      unrelatedJsonLibrary,
      mutateResource(configuredRule, (resource) => {
        const attachments = resource.content as Record<string, unknown>[]
        attachments[0] = { ...attachments[0], contentType: 'text/plain' }
      }),
      replacePayload(configuredRule, { ...configuredRulePayload, schemaVersion: 99 }),
      replacePayload(configuredRule, { semanticMajor: 4, rule: configuredRulePayload.rule }),
      replacePayload(configuredRule, { schemaVersion: 2, rule: configuredRulePayload.rule }),
      replacePayload(configuredRule, { ...configuredRulePayload, semanticMajor: 99 }),
      replacePayload(catalog, { ...catalogManifest, schemaVersion: 99 }),
      replacePayload(catalog, { ...catalogManifest, kind: 'other-catalog' }),
      replacePayload(ruleSet, { ...ruleSetPayload, schemaVersion: 99 }),
      replacePayload(ruleSet, { schemaVersion: 2, id: ruleSetPayload.id, rules: ruleSetPayload.rules }),
      mutateResource(configuredRule, (resource) => {
        const ids = resource.identifier as Record<string, unknown>[]
        resource.identifier = ids.filter((item) => item.system !== BILLING_ARTIFACT_KIND_SYSTEM)
      }),
      mutateResource(configuredRule, (resource) => {
        const ids = resource.identifier as Record<string, unknown>[]
        const kind = ids.find((item) => item.system === BILLING_ARTIFACT_KIND_SYSTEM)
        if (kind) kind.value = 'rule-set'
      }),
      mutateResource(configuredRule, (resource) => {
        const ids = resource.identifier as Record<string, unknown>[]
        ids.push({ system: BILLING_ARTIFACT_KIND_SYSTEM, value: 'rule-set' })
      }),
      mutateResource(configuredRule, (resource) => {
        resource.type = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'asset-collection' }] }
      }),
      mutateResource(configuredRule, (resource) => {
        const links = resource.relatedArtifact as Record<string, unknown>[]
        links.push({ ...links[0] })
      }),
      mutateResource(configuredRule, (resource) => {
        resource.relatedArtifact = [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1' }]
      }),
      mutateResource(configuredRule, (resource) => {
        const attachments = resource.content as Record<string, unknown>[]
        attachments.push({ ...attachments[0] })
      }),
    ]
    assert.equal(cases.length, 17)
    for (const [index, resource] of cases.entries()) {
      assert.throws(() => decodeBillingLibrary(resource), `malformed shared-MIME case ${index + 1}`)
    }
  })

  /**
   * Resource.implicitRules is a must-understand declaration:
   * https://hl7.org/fhir/R4/resource-definitions.html#Resource.implicitRules
   * ig_canonical: http://hl7.org/fhir/StructureDefinition/Resource
   * element: Resource.implicitRules
   * Reviewer evidence:
   * an internal review run (answer.md)
   * worked_example_pointer: answer.md#finding-2
   */
  for (const kind of ['catalog-edition', 'configured-rule', 'rule-set'] as const) {
    it(`supplemental security rejects implicitRules on native ${kind} decoding`, () => {
      const resource = mutateResource(libraryFixture(kind), (copy) => {
        copy.implicitRules = 'https://example.invalid/must-understand-billing-rules'
      })

      assert.throws(() => decodeBillingLibrary(resource), `${kind} implicitRules must be understood or rejected`)
    })
  }

  /**
   * Ordinary Resource.extension content is safe to ignore when it is not a modifier:
   * https://hl7.org/fhir/R4/extensibility.html#modifierExtension
   * ig_canonical: http://hl7.org/fhir/StructureDefinition/DomainResource
   * element: Resource.extension
   */
  it('supplemental security preserves harmless ordinary extensions on native Libraries', () => {
    for (const kind of ['catalog-edition', 'configured-rule', 'rule-set'] as const) {
      const resource = mutateResource(libraryFixture(kind), (copy) => {
        copy.extension = [{ url: 'https://example.invalid/StructureDefinition/display-metadata', valueString: 'safe to ignore' }]
      })

      assert.equal(decodeBillingLibrary(resource).kind, kind)
    }
  })

  /**
   * FHIR publication status includes retired as an explicit historical state:
   * https://hl7.org/fhir/R4/valueset-publication-status.html
   * ig_canonical: http://hl7.org/fhir/ValueSet/publication-status
   * element: Library.status
   */
  it('supplemental security preserves explicit historical decoding of a retired native edition', () => {
    const retired = mutateResource(libraryFixture('catalog-edition'), (resource) => {
      resource.status = 'retired'
    })

    assert.equal(decodeBillingLibrary(retired).status, 'retired')
  })
})

describe('per-code configured-rule carriage (cognovis/fhir-billing-core#53)', () => {
  const dependency = [{ type: 'depends-on' as const, resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }] as const
  const factSources = [{ fact: 'synthetic.enrolled', from: 'coverage', path: "extension('https://example.test/StructureDefinition/enrolled').valueCoding", valueAs: 'code' }] as const

  function edition(ruleCompleteness?: 'configured-rule-per-code') {
    return buildBillingLibrary({
      kind: 'catalog-edition',
      id: 'edition-1',
      url: 'https://example.invalid/Library/catalog-edition',
      version: 'synthetic-2026',
      status: 'active',
      publisher: 'Synthetic Authority',
      payload: catalogManifest,
      relatedArtifacts: catalogMembers.map((resource) => ({ type: 'composed-of' as const, resource })),
      catalogDefinitions: inventoryDefinitions([{ canonical: catalogMembers[0], system: 'https://example.invalid/synthetic', code: 'S1' }]),
      // The members are one catalog definition and the rule-set Library, so the inventory names both.
      ...(ruleCompleteness === undefined ? {} : { ruleCompleteness, configuredRules: [], definitions: [{ canonical: catalogMembers[0], system: 'https://example.invalid/synthetic', code: 'S1' }], ruleSet: mutateResource(libraryFixture('rule-set'), (copy) => { copy.version = 'synthetic-rules' }) }),
    })
  }

  it('emits and decodes the per-code rule completeness declaration as an edition identifier, outside the manifest', () => {
    const declared = edition('configured-rule-per-code')
    assert.equal(BILLING_RULE_COMPLETENESS_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/billing-rule-completeness')
    assert.deepEqual(identifiers(declared).filter((item) => item.system === BILLING_RULE_COMPLETENESS_SYSTEM), [
      { system: BILLING_RULE_COMPLETENESS_SYSTEM, value: 'configured-rule-per-code' },
    ])
    const decoded = decodeBillingLibrary(declared)
    if (decoded.kind !== 'catalog-edition') throw new Error('expected a catalog edition')
    assert.equal(decoded.ruleCompleteness, 'configured-rule-per-code')
    // The manifest and the member-set digest are those of the same edition without the declaration.
    assert.deepEqual(decoded.payload, catalogManifest)
    assert.equal(decoded.digest, (decodeBillingLibrary(edition()) as { digest: string }).digest)
    assert.deepEqual(content(declared), content(edition()))
    const plain = decodeBillingLibrary(edition())
    if (plain.kind !== 'catalog-edition') throw new Error('expected a catalog edition')
    assert.equal('ruleCompleteness' in plain, false)
    assert.equal(identifiers(edition()).some((item) => item.system === BILLING_RULE_COMPLETENESS_SYSTEM), false)
  })

  it('refuses an unknown or repeated rule completeness declaration', () => {
    const declared = edition('configured-rule-per-code')
    const unknown = mutateResource(declared, (resource) => {
      resource.identifier = (resource.identifier as Record<string, unknown>[]).map((item) => item.system === BILLING_RULE_COMPLETENESS_SYSTEM ? { ...item, value: 'rule-set' } : item)
    })
    const repeated = mutateResource(declared, (resource) => {
      resource.identifier = [...(resource.identifier as Record<string, unknown>[]), { system: BILLING_RULE_COMPLETENESS_SYSTEM, value: 'configured-rule-per-code' }]
    })
    for (const resource of [unknown, repeated]) assert.throws(() => decodeBillingLibrary(resource), /rule completeness/)
    assert.throws(() => edition('other' as never), /rule completeness/)
  })

  it('carries a configured rule\'s factSources under its rule digest and keeps the digest of a payload without them', () => {
    const withSources: BillingConfiguredRulePayloadV2 = { ...configuredRulePayload, factSources }
    const resource = buildBillingLibrary({ kind: 'configured-rule', id: 'configured-rule-1', url: 'https://example.invalid/Library/configured-rule-1', version: '1.0.0', status: 'active', payload: withSources, relatedArtifacts: dependency })
    const decoded = decodeBillingLibrary(resource)
    if (decoded.kind !== 'configured-rule') throw new Error('expected a configured rule')
    assert.deepEqual(decoded.payload, withSources)
    assert.notEqual(decoded.digest, CONFIGURED_RULE_DIGEST)
    assert.equal(decoded.digest, `sha256:${createHash('sha256').update(canonicalizeJson(withSources)).digest('hex')}`)
    // Without factSources the digest is the one published before the member existed.
    assert.equal(decodeBillingLibrary(libraryFixture('configured-rule')).digest, CONFIGURED_RULE_DIGEST)
    // The digest covers the declarations: changing one without the digest is refused.
    const tampered = replacePayload(resource, { ...withSources, factSources: [{ ...factSources[0], from: 'patient' }] })
    assert.throws(() => decodeBillingLibrary(tampered), /digest/)
  })

  it('validates a configured rule\'s factSources like a rule set\'s', () => {
    const build = (payload: unknown) => buildBillingLibrary({ kind: 'configured-rule', id: 'configured-rule-1', url: 'https://example.invalid/Library/configured-rule-1', version: '1.0.0', status: 'active', payload: payload as BillingConfiguredRulePayloadV2, relatedArtifacts: dependency })
    assert.throws(() => build({ ...configuredRulePayload, factSources: [] }), /factSources/)
    assert.throws(() => build({ ...configuredRulePayload, factSources: [{ ...factSources[0], from: 'nowhere' }] }), /from/)
    assert.throws(() => build({ ...configuredRulePayload, factSources: [factSources[0], factSources[0]] }), /more than once/)
    assert.throws(() => build({ ...configuredRulePayload, factSources: [{ ...factSources[0], fact: 'patient.gender' }] }), /native fact/)
    assert.throws(() => build({ ...configuredRulePayload, extra: true }), /Configured-rule payload/)
  })
})

describe('one configured-rule Library per rule (cognovis/fhir-billing-core#53 review repair)', () => {
  const SYN = 'https://example.invalid/synthetic'
  function generic(ruleClass: string, parameters: Record<string, unknown>): BillingRule {
    return { id: `rule-${ruleClass}`, class: ruleClass, mustUnderstand: true, effect: 'reject', priority: 1, parameters }
  }

  it('names the codes a rule names in every role, unique and sorted', () => {
    assert.deepEqual(billingRuleNamedCodes(generic('quantity-limit', { selector: { system: SYN, codes: ['S2', 'S1', 'S2'] }, maximum: 1 })), [
      { system: SYN, code: 'S1' },
      { system: SYN, code: 'S2' },
    ])
    assert.deepEqual(billingRuleNamedCodes(generic('mutual-exclusion', { selector: { system: SYN, codes: ['S1'] }, excluded: { codes: ['X1'] } })), [
      // A code without a system orders before every code with one.
      { code: 'X1' },
      { system: SYN, code: 'S1' },
    ])
    assert.deepEqual(billingRuleNamedCodes(generic('companion-required', { selector: { system: SYN, codes: ['S1'] }, required: { system: SYN, codes: ['R1', 'S1'] } })), [
      { system: SYN, code: 'R1' },
      { system: SYN, code: 'S1' },
    ])
  })

  it('names no codes for a wildcard or code-less selector, or a class whose code parameters Core does not know', () => {
    assert.equal(billingRuleNamedCodes(generic('quantity-limit', { selector: { system: SYN, codes: ['*'] }, maximum: 1 })), undefined)
    assert.equal(billingRuleNamedCodes(generic('quantity-limit', { selector: { system: SYN, codes: [] }, maximum: 1 })), undefined)
    assert.equal(billingRuleNamedCodes(generic('quantity-limit', { maximum: 1 })), undefined)
    assert.equal(billingRuleNamedCodes(generic('unsupported-source-rule', { selector: { system: SYN, codes: ['S1'] } })), undefined)
  })

  it('carries a configured rule with one depends-on link per named definition, unique and sorted, and keeps single-link Libraries and their digests', () => {
    const cid = (n: number) => `https://example.invalid/ChargeItemDefinition/cid-${n}|synthetic-2026`
    const build = (links: readonly string[]) => buildBillingLibrary({
      kind: 'configured-rule',
      id: 'configured-rule-1',
      url: 'https://example.invalid/Library/configured-rule-1',
      version: '1.0.0',
      status: 'active',
      payload: configuredRulePayload,
      relatedArtifacts: links.map((resource) => ({ type: 'depends-on' as const, resource })),
    })
    const several = build([cid(2), cid(1)])
    assert.deepEqual(several.relatedArtifact, [{ type: 'depends-on', resource: cid(1) }, { type: 'depends-on', resource: cid(2) }])
    const decoded = decodeBillingLibrary(several)
    if (decoded.kind !== 'configured-rule') throw new Error('expected a configured rule')
    assert.deepEqual(decoded.relatedArtifacts.map((link) => link.resource), [cid(1), cid(2)])
    // The links are outside the payload: the digest is the one of the single-link Library.
    assert.equal(decoded.digest, CONFIGURED_RULE_DIGEST)
    assert.equal(decodeBillingLibrary(libraryFixture('configured-rule')).digest, CONFIGURED_RULE_DIGEST)
    assert.throws(() => build([]), /depends-on/)
    assert.throws(() => build([cid(1), cid(1)]), /depends-on/)
    const unsorted = mutateResource(several, (resource) => {
      resource.relatedArtifact = [...(resource.relatedArtifact as unknown[])].reverse()
    })
    assert.throws(() => decodeBillingLibrary(unsorted), /depends-on/)
  })

  describe('a declaring edition binds the configured-rule members of each definition', () => {
    const cid = (n: number) => `https://example.invalid/ChargeItemDefinition/cid-${n}|synthetic-2026`
    const definitions = [
      { canonical: cid(1), system: SYN, code: 'S1' },
      { canonical: cid(2), system: SYN, code: 'X1' },
      { canonical: cid(3), system: SYN, code: 'S3' },
    ]
    const EXCLUDES = { ...generic('mutual-exclusion', { selector: { system: SYN, codes: ['S1'] }, excluded: { system: SYN, codes: ['X1'] } }), id: 'excludes-x1' }
    const LIMIT = { ...generic('quantity-limit', { selector: { system: SYN, codes: ['S1'] }, maximum: 1 }), id: 'limit-s1' }

    function configured(rule: BillingRule, links: readonly string[], id = rule.id) {
      return buildBillingLibrary({
        kind: 'configured-rule',
        id: `configured-${id}`,
        url: `https://example.invalid/Library/configured-${id}`,
        version: '1',
        status: 'active',
        payload: { schemaVersion: 2, semanticMajor: 4, rule },
        relatedArtifacts: links.map((resource) => ({ type: 'depends-on' as const, resource })),
      })
    }

    const RULES = [configured(EXCLUDES, [cid(1), cid(2)]), configured(LIMIT, [cid(1)])]

    function declaring(configuredRules: readonly Record<string, unknown>[], members: readonly string[] = [...definitions.map((item) => item.canonical), ...configuredRules.map((item) => `${String(item.url)}|${String(item.version)}`)], editionDefinitions: readonly { canonical: string; system: string; code: string }[] = definitions) {
      return buildBillingLibrary({
        kind: 'catalog-edition',
        id: 'edition-1',
        url: 'https://example.invalid/Library/catalog-edition',
        version: 'synthetic-2026',
        status: 'active',
        publisher: 'Synthetic Authority',
        payload: catalogManifest,
        relatedArtifacts: members.map((resource) => ({ type: 'composed-of' as const, resource })),
        catalogDefinitions: inventoryDefinitions(editionDefinitions),
        ruleCompleteness: 'configured-rule-per-code',
        configuredRules,
        definitions: editionDefinitions,
      })
    }

    function listDigest(members: readonly string[]): string {
      return `sha256:${createHash('sha256').update(JSON.stringify([...members].sort())).digest('hex')}`
    }

    it('carries the digest of the configured-rule members of each definition on its composed-of entry, and none for a definition without rules', () => {
      const edition = declaring(RULES)
      const links = edition.relatedArtifact as unknown as readonly Record<string, unknown>[]
      const entry = (canonical: string) => links.find((link) => link.resource === canonical)
      const excludes = 'https://example.invalid/Library/configured-excludes-x1|1'
      const limit = 'https://example.invalid/Library/configured-limit-s1|1'
      assert.deepEqual(membersDigestExtensions(entry(cid(1))), [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: listDigest([limit, excludes]) }])
      assert.deepEqual(membersDigestExtensions(entry(cid(2))), [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: listDigest([excludes]) }])
      assert.deepEqual(membersDigestExtensions(entry(cid(3))), [])
      assert.equal(entry(excludes)!.extension, undefined)
      assert.equal(billingConfiguredRuleMembersDigest([limit, excludes]), listDigest([excludes, limit]))
      const decoded = decodeBillingLibrary(edition)
      if (decoded.kind !== 'catalog-edition') throw new Error('expected a catalog edition')
      const decodedEntry = (canonical: string) => decoded.relatedArtifacts.find((link) => link.resource === canonical)!
      assert.equal(decodedEntry(cid(1)).configuredRuleMembersDigest, listDigest([excludes, limit]))
      assert.equal(decodedEntry(cid(3)).configuredRuleMembersDigest, undefined)
      // Every definition entry also carries its content digest (cognovis/fhir-billing-core#165).
      assert.match(decodedEntry(cid(3)).catalogDefinitionDigest ?? '', /^sha256:[0-9a-f]{64}$/)
      // The member-set digest (scheme 2, cognovis/fhir-billing-core#165) covers the extensions, so an
      // admission of the edition binds each definition's configured rules.
      assert.equal(decoded.digest, billingCatalogEditionDigest(decoded.relatedArtifacts))
      assert.notEqual(decoded.digest, billingCatalogEditionDigest(decoded.relatedArtifacts.map(({ type, resource }) => ({ type, resource }))))
    })

    it('refuses the declaration for a rule without explicit codes, uncovered or extra definitions, a non-member and a duplicate rule id', () => {
      const wildcard = { ...LIMIT, id: 'wildcard', parameters: { selector: { system: SYN, codes: ['*'] }, maximum: 1 } }
      assert.throws(() => declaring([configured(wildcard, [cid(1)])]), /names no explicit codes/)
      assert.throws(() => declaring([configured(EXCLUDES, [cid(1)])]), /depends-on/)
      assert.throws(() => declaring([configured(LIMIT, [cid(1), cid(3)])]), /depends-on/)
      // A rule naming only a code the edition carries no definition for is reached through none, so any link is extra.
      const uncovered = { ...LIMIT, id: 'uncovered', parameters: { selector: { system: SYN, codes: ['S9'] }, maximum: 1 } }
      assert.throws(() => declaring([configured(uncovered, [cid(1)])]), /depends-on links must name exactly/)
      assert.throws(() => declaring(RULES, definitions.map((item) => item.canonical)), /not a member/)
      assert.throws(() => declaring([...RULES, configured(LIMIT, [cid(1)], 'limit-copy')]), /limit-s1/)
      // The declaration needs the configured rules and definitions to bind; without the declaration they are refused.
      assert.throws(() => buildBillingLibrary({ kind: 'catalog-edition', id: 'e', url: 'https://example.invalid/Library/e', version: '1', status: 'active', publisher: 'P', payload: catalogManifest, relatedArtifacts: [{ type: 'composed-of', resource: cid(1) }], ruleCompleteness: 'configured-rule-per-code' }), /configuredRules/)
      assert.throws(() => buildBillingLibrary({ kind: 'catalog-edition', id: 'e', url: 'https://example.invalid/Library/e', version: '1', status: 'active', publisher: 'P', payload: catalogManifest, relatedArtifacts: [{ type: 'composed-of', resource: cid(1) }], configuredRules: [], definitions: [] }), /configuredRules/)
    })

    describe('a named code without a definition in the edition', () => {
      const FEES = 'https://example.test/fee-codes'
      const OTHER = 'https://example.test/other-codes'
      const def = (n: number) => `https://example.test/ChargeItemDefinition/def-${n}|synthetic-2026`
      // A and A2 have a definition in FEES, B only in OTHER, and X has none in any system.
      const present = [
        { canonical: def(1), system: FEES, code: 'A' },
        { canonical: def(2), system: FEES, code: 'A2' },
        { canonical: def(3), system: OTHER, code: 'B' },
      ]
      const declare = (rules: readonly Record<string, unknown>[]) => declaring(rules, [...present.map((item) => item.canonical), ...rules.map((item) => `${String(item.url)}|${String(item.version)}`)], present)
      const exclusion = (system: string | undefined, excluded: readonly string[], id: string) => {
        const scope = system === undefined ? {} : { system }
        return { ...generic('mutual-exclusion', { selector: { ...scope, codes: ['A'] }, excluded: { ...scope, codes: excluded } }), id }
      }

      it('needs no depends-on link, and the builder and decoder accept the declaration', () => {
        const edition = declare([configured(exclusion(FEES, ['A2', 'X'], 'excludes-a2-x'), [def(1), def(2)])])
        const key = 'https://example.invalid/Library/configured-excludes-a2-x|1'
        const decoded = decodeBillingLibrary(edition)
        if (decoded.kind !== 'catalog-edition') throw new Error('expected a catalog edition')
        assert.equal(decoded.ruleCompleteness, 'configured-rule-per-code')
        const digestOf = (canonical: string) => decoded.relatedArtifacts.find((link) => link.resource === canonical)!.configuredRuleMembersDigest
        assert.equal(digestOf(def(1)), listDigest([key]))
        assert.equal(digestOf(def(2)), listDigest([key]))
        assert.equal(digestOf(def(3)), undefined)
        // A code named without a system is absent only when no definition in any system carries it.
        assert.equal(decodeBillingLibrary(declare([configured(exclusion(undefined, ['X'], 'systemless-x'), [def(1)])])).kind, 'catalog-edition')
      })

      it('still refuses a missed definition the rule names, a link to one it does not name, and a system-less code carried in another system', () => {
        assert.throws(() => declare([configured(exclusion(FEES, ['A2', 'X'], 'misses-a2'), [def(1)])]), /depends-on links must name exactly/)
        assert.throws(() => declare([configured(exclusion(FEES, ['A2', 'X'], 'extra-b'), [def(1), def(2), def(3)])]), /depends-on links must name exactly/)
        // B under FEES has no definition (it exists only in OTHER), so def(3) is a link the rule does not name.
        assert.throws(() => declare([configured(exclusion(FEES, ['B'], 'fees-b'), [def(1), def(3)])]), /depends-on links must name exactly/)
        assert.throws(() => declare([configured(exclusion(undefined, ['B', 'X'], 'systemless-b'), [def(1)])]), /depends-on links must name exactly/)
        assert.doesNotThrow(() => declare([configured(exclusion(undefined, ['B', 'X'], 'systemless-b'), [def(1), def(3)])]))
      })
    })

    describe('the definitions inventory: every catalog definition of the edition (cognovis/fhir-billing-core#95)', () => {
      const RULE_SET = 'https://example.invalid/Library/rules-1|synthetic-rules'
      // The rule-set Library fixture at the edition's rule-set member canonical.
      const RULE_SET_LIBRARY = mutateResource(libraryFixture('rule-set'), (copy) => {
        copy.version = 'synthetic-rules'
      })
      const members = (rules: readonly Record<string, unknown>[], extra: readonly string[] = []) => [...definitions.map((item) => item.canonical), ...rules.map((item) => `${String(item.url)}|${String(item.version)}`), ...extra]
      const withInventory = (rules: readonly Record<string, unknown>[], memberList: readonly string[], inventory: readonly { canonical: string; system: string; code: string }[], ruleSet?: unknown) => buildBillingLibrary({
        kind: 'catalog-edition',
        id: 'edition-1',
        url: 'https://example.invalid/Library/catalog-edition',
        version: 'synthetic-2026',
        status: 'active',
        publisher: 'Synthetic Authority',
        payload: catalogManifest,
        relatedArtifacts: memberList.map((resource) => ({ type: 'composed-of' as const, resource })),
        catalogDefinitions: inventoryDefinitions(inventory),
        ruleCompleteness: 'configured-rule-per-code',
        configuredRules: rules,
        definitions: inventory,
        ...(ruleSet === undefined ? {} : { ruleSet }),
      })
      /** The rule-set Library fixture moved to another canonical. */
      const ruleSetAt = (url: string, version: string) => mutateResource(RULE_SET_LIBRARY, (copy) => {
        copy.url = url
        copy.version = version
      })
      // Members define A and B; the rule names both but links A only, and definitions omits B.
      const a = { canonical: cid(1), system: SYN, code: 'A' }
      const capAB = configured({ ...generic('quantity-limit', { selector: { system: SYN, codes: ['A', 'B'] }, maximum: 0 }), id: 'cap-ab' }, [cid(1)])
      const capMembers = [cid(1), cid(2), 'https://example.invalid/Library/configured-cap-ab|1']

      it('refuses a member definition left out of definitions, so its named code cannot pass as absent', () => {
        assert.throws(() => withInventory([capAB], capMembers, [a]), new RegExp(`${cid(2).replace(/[|.]/g, '\\$&')} is neither a given catalog definition`))
        // Also when no rule names the omitted definition.
        assert.throws(() => withInventory(RULES, members(RULES), definitions.slice(0, 2)), /neither a given catalog definition/)
      })

      it('refuses the omitted definition classified as the rule-set member', () => {
        // Its canonical, a ChargeItemDefinition and a configured-rule Library are no rule-set Library.
        assert.throws(() => withInventory([capAB], capMembers, [a], cid(2)), /rule-set Library/)
        const definitionResource = { resourceType: 'ChargeItemDefinition', url: 'https://example.invalid/ChargeItemDefinition/cid-2', version: 'synthetic-2026', status: 'active' }
        assert.throws(() => withInventory([capAB], capMembers, [a], definitionResource), /rule-set Library/)
        assert.throws(() => withInventory([capAB], capMembers, [a], capAB), /rule-set Library/)
      })

      it('refuses a given definition that is no member, and one canonical given twice', () => {
        assert.throws(() => withInventory(RULES, members(RULES), [...definitions, { canonical: cid(4), system: SYN, code: 'S4' }]), /Catalog definition .*cid-4.* is not a member/)
        assert.throws(() => withInventory(RULES, members(RULES), [...definitions, { ...definitions[2]!, code: 'S3b' }]), /given more than once/)
      })

      it('accepts at most one rule-set Library member beside the definitions and configured rules', () => {
        assert.throws(() => withInventory(RULES, members(RULES, [RULE_SET]), definitions), /neither a given catalog definition/)
        assert.throws(() => withInventory(RULES, members(RULES, [RULE_SET, 'https://example.invalid/Library/other|1']), definitions, RULE_SET_LIBRARY), /other\|1 is neither a given catalog definition/)
        assert.throws(() => withInventory(RULES, members(RULES), definitions, RULE_SET_LIBRARY), /rule-set Library .* is not a member/)
        assert.throws(() => withInventory(RULES, members(RULES), definitions, ruleSetAt('https://example.invalid/ChargeItemDefinition/cid-3', 'synthetic-2026')), /rule-set Library .* is also/)
        assert.throws(() => withInventory(RULES, members(RULES), definitions, ruleSetAt(String(RULES[1]!.url), '1')), /rule-set Library .* is also/)
        const edition = withInventory(RULES, members(RULES, [RULE_SET]), definitions, RULE_SET_LIBRARY)
        assert.equal(decodeBillingLibrary(edition).kind, 'catalog-edition')
        // The rule-set Library is build input only: its member entry carries no extension.
        const links = edition.relatedArtifact as unknown as readonly Record<string, unknown>[]
        assert.equal(links.find((link) => link.resource === RULE_SET)!.extension, undefined)
        // Without the declaration a rule-set Library input is refused, as configuredRules and definitions are.
        assert.throws(() => buildBillingLibrary({
          kind: 'catalog-edition',
          id: 'e',
          url: 'https://example.invalid/Library/e',
          version: '1',
          status: 'active',
          publisher: 'P',
          payload: catalogManifest,
          relatedArtifacts: [{ type: 'composed-of', resource: RULE_SET }],
          ruleSet: RULE_SET_LIBRARY,
        }), /belong to a rule completeness declaration/)
      })
    })

    it('lets the publisher name the definitions of a rule whose class Core does not know', () => {
      const own = { ...generic('unsupported-source-rule', { source: 'synthetic' }), id: 'own-rule' }
      const edition = declaring([configured(own, [cid(3)])])
      const entry = (edition.relatedArtifact as unknown as readonly Record<string, unknown>[]).find((link) => link.resource === cid(3))
      assert.deepEqual(membersDigestExtensions(entry), [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: listDigest(['https://example.invalid/Library/configured-own-rule|1']) }])
    })

    it('decodes only a well-formed digest extension, on a composed-of entry of a declaring edition', () => {
      const edition = declaring(RULES)
      const withEntry = (mutate: (entry: Record<string, unknown>) => void, resource = edition) => mutateResource(resource, (copy) => {
        mutate((copy.relatedArtifact as Record<string, unknown>[]).find((link) => link.resource === cid(1))!)
      })
      const undeclared = mutateResource(edition, (copy) => {
        copy.identifier = (copy.identifier as Record<string, unknown>[]).filter((item) => item.system !== BILLING_RULE_COMPLETENESS_SYSTEM)
      })
      const cases = [
        undeclared,
        withEntry((entry) => { entry.extension = [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: 'sha256:short' }] }),
        withEntry((entry) => { entry.extension = [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueCode: listDigest(['a|1']) }] }),
        withEntry((entry) => { entry.extension = [...(entry.extension as unknown[]), ...(entry.extension as unknown[])] }),
        withEntry((entry) => { entry.extension = [{ url: 'https://example.invalid/other', valueString: listDigest(['a|1']) }] }),
        withEntry((entry) => { entry.extension = [] }),
      ]
      for (const [index, resource] of cases.entries()) assert.throws(() => decodeBillingLibrary(resource), `case ${index + 1}`)
      const ruleWithExtension = mutateResource(RULES[1]!, (copy) => {
        (copy.relatedArtifact as Record<string, unknown>[])[0]!.extension = [{ url: BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION, valueString: listDigest(['a|1']) }]
      })
      assert.throws(() => decodeBillingLibrary(ruleWithExtension))
    })
  })
})
