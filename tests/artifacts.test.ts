import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  BILLING_ARTIFACT_KIND_SYSTEM,
  BILLING_CATALOG_DIGEST_SYSTEM,
  BILLING_CATALOG_EDITION_MIME,
  BILLING_CONFIGURED_RULE_MIME,
  BILLING_MEMBER_SET_DIGEST_SYSTEM,
  BILLING_RULE_DIGEST_SYSTEM,
  BILLING_RULE_SET_DIGEST_SYSTEM,
  BILLING_RULE_SET_MIME,
  BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM,
  type BillingCatalogEditionManifestV1,
  type BillingConfiguredRulePayloadV2,
} from '@cognovis/fhir-billing-types'

// Read from VERSION so a release bump does not require editing assertions.
const packageVersion = readFileSync('VERSION', 'utf8').trim()
const generatedResourceDirectory = 'fsh-generated/resources'
const hasGeneratedResources = existsSync(generatedResourceDirectory)

describe('release contracts', () => {
  it('keeps the versioned public API snapshot', async () => {
    const publicTypes = await import('@cognovis/fhir-billing-types')
    assert.equal('CORE_PROFILE_URLS' in publicTypes, false)
    assert.deepEqual(Object.keys(publicTypes).sort(), [
      'BILLING_ADMISSION_PROFILE', 'BILLING_ADMISSION_TENANT_EXTENSION', 'BILLING_ADMITTED_ARTIFACT_EXTENSION', 'BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION',
      'BILLING_ADMITTED_CONFIGURED_RULES_PROFILE', 'BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE', 'BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM', 'BILLING_ADMITTED_DIGEST_EXTENSION',
      'BILLING_ARTIFACT_KIND_SYSTEM', 'BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION', 'BILLING_CATALOG_DIGEST_SYSTEM', 'BILLING_CATALOG_EDITION_MIME',
      'BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION', 'BILLING_CONFIGURED_RULE_MIME', 'BILLING_CONFORMANCE_FORMAT', 'BILLING_CONFORMANCE_INPUT_INVALID', 'BILLING_CORE_VERSION', 'BILLING_FACT_SOURCE_ORIGINS', 'BILLING_FACT_UNAVAILABLE_CAUSES', 'BILLING_MEMBER_SET_DIGEST_SYSTEM',
      'BILLING_NATIVE_FACT_NAMES', 'BILLING_REASON_CODES', 'BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE', 'BILLING_RULE_COMPLETENESS_SYSTEM', 'BILLING_RULE_DIGEST_SYSTEM', 'BILLING_RULE_PAYLOAD_SCHEMA_VERSION',
      'BILLING_RULE_SEMANTIC_MAJOR', 'BILLING_RULE_SET_DIGEST_SYSTEM', 'BILLING_RULE_SET_MIME',
      'BILLING_RULE_SOURCE_KINDS', 'BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM',
    ])
    assert.deepEqual(Object.keys(await import('@cognovis/fhir-billing-rules')).sort(), [
      'BILLING_INTERPRETABLE_UNITS', 'BILLING_RULE_CLASS_DEFINITIONS', 'BILLING_RULE_CLASS_SYSTEM', 'BILLING_RULE_PAYLOAD_SCHEMA_URI',
      'BILLING_RULE_REASON_SYSTEM', 'BILLING_RULE_SET_ID_SYSTEM', 'BillingInputError', 'CORE_CANONICAL',
      'admitBillingRuleSet', 'billingAdmittedConfiguredRulesDigest', 'billingAdmittedConfiguredRulesUnion', 'billingCatalogDefinitionDigest', 'billingCatalogEditionDigest', 'billingCatalogMemberSetDigest', 'billingCatalogSourceSetDigest', 'billingConfiguredRuleMembersDigest', 'billingRuleNamedCodes', 'billingRulePayloadDigest', 'billingRuleSetDigest',
      'buildBillingLibrary', 'canonicalizeJson', 'compareUnitBearingValues', 'decodeBillingAdmission', 'decodeBillingLibrary', 'decodeBillingRuleSet', 'defineBillingRuleSet', 'encodeBillingAdmission', 'isGenericRuleClass', 'parseBillingFactSourcePath', 'sortRules',
    ])
    assert.deepEqual(Object.keys(await import('@cognovis/fhir-billing-engine')).sort(), [
      'BILLING_CONFORMANCE_FORMAT', 'BILLING_CONFORMANCE_INPUT_INVALID', 'BILLING_ENGINE_CAPABILITY', 'BILLING_ENGINE_VERSION', 'BillingInputError',
      'compareConformanceRecords', 'compileRuleSet', 'evaluateBillingCase', 'evaluateBillingCaseFindings', 'evaluateConformanceCases', 'resolveCatalogUnitPrices', 'toOracleParameters',
    ])
  })

  it('authors the neutral R4 contract and release guards', () => {
    assert.ok(existsSync('input/fsh/examples.fsh'))
    assert.ok(existsSync('input/fsh/terminology.fsh'))
    assert.ok(existsSync('scripts/generate-types.mjs'))
    assert.ok(existsSync('scripts/verify-release.mjs'))
    assert.ok(existsSync('scripts/verify-packed-portability.mjs'))
    assert.ok(readFileSync('fhirscripts.config.yaml', 'utf8').includes('- shell: bun scripts/fsh-source-fingerprint.mjs record'))
    for (const consumer of ['scripts/generate-types.mjs', 'scripts/verify-release.mjs']) {
      assert.ok(readFileSync(consumer, 'utf8').includes('assertFshGeneratedFresh()'), `${consumer} must refuse a stale fsh-generated/`)
    }
    for (const directory of ['types', 'rules', 'engine']) {
      const manifest = JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')) as { version?: string; engines?: { node?: string }; publishConfig?: { registry?: string; access?: string; tag?: string } }
      assert.equal(manifest.version, packageVersion)
      assert.equal(manifest.engines?.node, '>=22')
      // The release workflow requires one explicit per-version npm tag, shared by all three units.
      const { tag, ...publication } = manifest.publishConfig ?? {}
      assert.deepEqual(publication, { registry: 'https://npm.cognovis.de', access: 'public' })
      assert.match(tag ?? '', new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*-${packageVersion.replaceAll('.', '-')}$`))
      assert.equal(tag, JSON.parse(readFileSync('packages/engine/package.json', 'utf8')).publishConfig.tag)
    }
  })

  it('records one-step public migrations', () => {
    const migration = JSON.parse(readFileSync('migration/canonical-map.json', 'utf8')) as { mappings: unknown[] }
    const reasons = JSON.parse(readFileSync('migration/reason-map.json', 'utf8')) as { mappings: unknown[] }
    const versions = JSON.parse(readFileSync('migration/version-map.json', 'utf8')) as Record<string, unknown>
    assert.ok(migration.mappings.length > 0)
    assert.ok(reasons.mappings.length > 0)
    assert.deepEqual(versions, {
      from: '0.4.x',
      to: packageVersion,
      payloadSchema: 2,
      semanticMajor: { from: 3, to: 4 },
      digestCompatibility: 'payload-v2-unchanged',
      addedRuleClasses: ['minimum-evidence-count'],
      predicateMigrations: [],
      minimumEvidence: 'minimum-evidence-count requires positive safe-integer minimum and source credits; each unique source fact contributes min(rawCount * credit, maximumCredit ?? rawCount * credit), while unavailable facts yield needs-review and malformed or overflowing counts are typed input errors',
    })
  })

  /**
   * Expected representation from
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
  it('publishes native R4 carrier conventions and payload types without custom profile identities', () => {
    assert.equal(BILLING_ARTIFACT_KIND_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/artifact-kind')
    assert.equal(BILLING_CATALOG_DIGEST_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/catalog-digest')
    assert.equal(BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/source-publication-digest')
    assert.equal(BILLING_MEMBER_SET_DIGEST_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/member-set-digest')
    assert.equal(BILLING_RULE_DIGEST_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/billing-rule-digest')
    assert.equal(BILLING_RULE_SET_DIGEST_SYSTEM, 'https://fhir.cognovis.de/billing-core/sid/billing-rule-set-digest')
    assert.equal(BILLING_CATALOG_EDITION_MIME, 'application/json')
    assert.equal(BILLING_CONFIGURED_RULE_MIME, 'application/json')
    assert.equal(BILLING_RULE_SET_MIME, 'application/json')

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
    const payload: BillingConfiguredRulePayloadV2 = {
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
    const configuredRule = {
      resourceType: 'Library',
      id: 'configured-rule-1',
      url: 'https://example.invalid/Library/configured-rule-1',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'logic-library' }] },
      effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
      identifier: [
        { system: BILLING_ARTIFACT_KIND_SYSTEM, value: 'configured-rule' },
        { system: BILLING_RULE_DIGEST_SYSTEM, value: 'sha256:fb56dfa9805b1a2d299793695bd83e6a4b2a0b1eaee54c93b10cd161e7444ea3' },
      ],
      relatedArtifact: [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }],
      content: [{ contentType: BILLING_CONFIGURED_RULE_MIME, data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') }],
    } as const
    assert.equal(configuredRule.identifier[0].value, 'configured-rule')
    assert.deepEqual(configuredRule.type, { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'logic-library' }] })
    assert.deepEqual(configuredRule.relatedArtifact, [{ type: 'depends-on', resource: 'https://example.invalid/ChargeItemDefinition/cid-1|synthetic-2026' }])
    assert.equal(configuredRule.content[0].contentType, BILLING_CONFIGURED_RULE_MIME)
    assert.deepEqual(JSON.parse(Buffer.from(configuredRule.content[0].data, 'base64').toString('utf8')), payload)
    assert.equal('meta' in configuredRule, false)
    assert.equal('extension' in configuredRule, false)
    assert.equal(manifest.sources.length, 1)

    const fshSources = readdirSync('input/fsh')
      .filter((file) => file.endsWith('.fsh'))
      .map((file) => readFileSync(`input/fsh/${file}`, 'utf8'))
      .join('\n')
    assert.doesNotMatch(fshSources, /^Profile:/m)
    const examples = readFileSync('input/fsh/examples.fsh', 'utf8')
    assert.match(examples, /^InstanceOf: Library$/m)
    assert.match(examples, /^InstanceOf: ChargeItemDefinition$/m)
    assert.match(examples, /^InstanceOf: Provenance$/m)
    assert.match(examples, /configured-rule/)
    assert.equal(examples.match(/content\.contentType = #application\/json/g)?.length, 3)
  })

  /**
   * MIME constants are application/json, not versioned MIME types.
   * packages/types/src/index.ts
   * profile_path: packages/types/src/index.ts
   * selector: BILLING_RULE_SET_MIME
   * Shared attachment content type is independently grounded in the R4
   * Attachment.contentType required MimeType binding:
   * https://hl7.org/fhir/R4/datatypes-definitions.html#Attachment.contentType
   * ig_canonical: http://hl7.org/fhir/StructureDefinition/Attachment
   * element: Attachment.contentType
   */
  it('documents application/json Library attachments and versioned JSON payloads', () => {
    assert.equal(BILLING_CATALOG_EDITION_MIME, 'application/json')
    assert.equal(BILLING_CONFIGURED_RULE_MIME, 'application/json')
    assert.equal(BILLING_RULE_SET_MIME, 'application/json')
    const documents = [
      ['README.md', readFileSync('README.md', 'utf8')],
      ['docs/adr/ADR-001-jurisdiction-neutral-rule-contract.md', readFileSync('docs/adr/ADR-001-jurisdiction-neutral-rule-contract.md', 'utf8')],
      ['GLOSSARY.md', readFileSync('GLOSSARY.md', 'utf8')],
      ['input/pagecontent/index.md', readFileSync('input/pagecontent/index.md', 'utf8')],
    ] as const
    for (const [path, text] of documents) {
      assert.doesNotMatch(text, /versioned MIME types/, path)
      assert.doesNotMatch(text, /strict MIME types/, path)
      assert.match(text, /application\/json/, path)
      assert.match(text, /versioned JSON payloads/, path)
    }
  })

  /**
   * Retired Billing Core extension identities from git 3a4715f input/fsh/extensions.fsh
   * must appear as mappings[].from rows so README's claim that the map records
   * each removed identity holds.
   * source: 3a4715f:input/fsh/extensions.fsh
   * worked_example_pointer: 3a4715f:input/fsh/extensions.fsh#Extension.url
   */
  it('records each retired Billing Core extension identity in the canonical map', () => {
    const migration = JSON.parse(readFileSync('migration/canonical-map.json', 'utf8')) as {
      mappings: Array<{ from?: unknown }>
    }
    const froms = new Set(migration.mappings.map((mapping) => mapping.from))
    const retiredExtensionUrls = [
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-rule-payload',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-admission-state',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-compatibility',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-ordering',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-precision',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-catalog-scope',
      'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-publication-period',
    ]
    for (const url of retiredExtensionUrls) {
      assert.equal(froms.has(url), true, url)
    }
  })

  it('records generated-type closure as base R4 plus Core only', () => {
    const closure = JSON.parse(readFileSync('packages/types/generation-closure.json', 'utf8')) as { packages: string[]; inputProfiles: string[]; baseDefinitions: string[] }
    assert.deepEqual(closure.packages, ['hl7.fhir.r4.core#4.0.1'])
    assert.deepEqual(closure.inputProfiles, [])
    assert.ok(closure.baseDefinitions.every((url) => url.startsWith('http://hl7.org/fhir/StructureDefinition/')))
    assert.equal(JSON.stringify(closure).match(/(?:country|national|praxis)/i), null)
  })

  it('keeps the current IG date aligned in source and generated artifacts', () => {
    const configuredDate = /^date: (\d{4}-\d{2}-\d{2})$/m.exec(readFileSync('sushi-config.yaml', 'utf8'))?.[1]
    assert.ok(configuredDate)
    if (!hasGeneratedResources) return
    const generated = JSON.parse(readFileSync(`${generatedResourceDirectory}/ImplementationGuide-de.cognovis.fhir.billing.core.json`, 'utf8')) as { date?: unknown }
    assert.equal(generated.date, configuredDate)
  })
})
