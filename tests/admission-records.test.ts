import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  BillingInputError,
  billingAdmittedConfiguredRulesDigest,
  billingAdmittedConfiguredRulesUnion,
  decodeBillingAdmission,
  type DecodedBillingAdmittedConfiguredRules,
  encodeBillingAdmission,
} from '@cognovis/fhir-billing-rules'
import {
  BILLING_ADMISSION_PROFILE,
  BILLING_ADMISSION_TENANT_EXTENSION,
  BILLING_ADMITTED_ARTIFACT_EXTENSION,
  BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM,
  BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION,
  BILLING_ADMITTED_CONFIGURED_RULES_PROFILE,
  BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE,
  BILLING_ADMITTED_DIGEST_EXTENSION,
} from '@cognovis/fhir-billing-types'

const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`
const DIGEST_C = `sha256:${'c'.repeat(64)}`
const DIGEST_D = `sha256:${'d'.repeat(64)}`

const EDITION = { kind: 'catalog-edition' as const, canonical: 'https://example.invalid/Library/edition', version: '2026', digest: DIGEST_A, sourceSetDigest: DIGEST_B }
const RULE_SET = { kind: 'rule-set' as const, canonical: 'https://example.invalid/Library/rules', version: '2026', digest: DIGEST_C, publisher: 'Synthetic Rule Authority' }

function admissionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'admission-1',
    configuredRulesId: 'admitted-rules-1',
    tenant: 'tenant-a',
    target: 'edition-1',
    recorded: '2026-10-10T08:00:00Z',
    producer: { display: 'Synthetic producer' },
    artifacts: [EDITION],
    configuredRules: [
      { key: 'https://example.invalid/Library/rule-b|2026', digest: DIGEST_D },
      { key: 'https://example.invalid/Library/rule-a|2026', digest: DIGEST_C },
    ],
    ...overrides,
  }
}

/** The configured-rules digest as the contract states it, computed independently of the rules package. */
function expectedConfiguredRulesDigest(pairs: readonly (readonly [string, string])[]): string {
  const sorted = [...pairs].sort((left, right) => (left[0] < right[0] ? -1 : 1))
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted)).digest('hex')}`
}

/** `count` admitted configured rules with canonicals of about 150 characters, in key order. */
function longRules(count: number): { key: string; digest: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `https://fhir.example.invalid/praxis/Library/ebm-federal-configured-rule-${'x'.repeat(60)}-${String(index).padStart(6, '0')}|2026-q4`,
    digest: `sha256:${index.toString(16).padStart(64, '0')}`,
  }))
}

describe('Billing admission records (cognovis/fhir-billing-core#124)', () => {
  it('shards 12,000 admitted configured rules into consecutive shards of at most 5,000, each bound by its own digest in shard order', () => {
    assert.equal(BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE, 5000)
    const rules = longRules(12_000)
    const { admission, configuredRules: shards } = encodeBillingAdmission(admissionInput({ configuredRules: [...rules].reverse() }))
    assert.deepEqual(shards!.map((shard) => shard.id), ['admitted-rules-1-1', 'admitted-rules-1-2', 'admitted-rules-1-3'])
    assert.deepEqual(shards!.map((shard) => (shard.entity as unknown[]).length), [5000, 5000, 2000])
    const decoded = decodeBillingAdmission(admission)
    assert.ok(decoded.kind === 'admission')
    assert.deepEqual(decoded.configuredRules, shards!.map((shard, index) => ({
      reference: `Provenance/${String(shard.id)}`,
      digest: billingAdmittedConfiguredRulesDigest(rules.slice(index * 5000, (index + 1) * 5000)),
    })))
    for (const shard of shards!) {
      assert.deepEqual(shard.meta, { profile: [BILLING_ADMITTED_CONFIGURED_RULES_PROFILE] })
      assert.deepEqual(shard.target, [{ reference: 'Library/edition-1' }])
    }
    // A full shard of 150-character canonicals stays well under 4 MB serialized.
    const full = JSON.stringify(shards![0])
    assert.ok(full.length < 4_000_000 / 1.5, String(full.length))
    // The union of the shards in binding order is every admitted rule.
    const union = billingAdmittedConfiguredRulesUnion(shards!.map((shard) => decodeBillingAdmission(shard) as DecodedBillingAdmittedConfiguredRules))
    assert.deepEqual([...union.entries()], rules.map((rule) => [rule.key, rule.digest]))
    // At most 5,000 rules are one shard.
    assert.equal(encodeBillingAdmission(admissionInput({ configuredRules: rules.slice(0, 5000) })).configuredRules!.length, 1)
    assert.equal(encodeBillingAdmission(admissionInput({ configuredRules: rules.slice(0, 5001) })).configuredRules!.length, 2)
    assert.deepEqual(encodeBillingAdmission(admissionInput({ configuredRules: [] })).configuredRules, [])
  })

  it('refuses a union of shards that overlap or are out of order', () => {
    const rules = longRules(30)
    const shard = (id: string, entries: readonly { key: string; digest: string }[]) => decodeBillingAdmission(encodeBillingAdmission(admissionInput({ configuredRulesId: id, configuredRules: entries })).configuredRules![0]) as DecodedBillingAdmittedConfiguredRules
    const first = shard('a', rules.slice(0, 10))
    const second = shard('b', rules.slice(10, 20))
    const overlapping = shard('c', rules.slice(9, 20))
    assert.equal(billingAdmittedConfiguredRulesUnion([first, second]).size, 20)
    assert.throws(() => billingAdmittedConfiguredRulesUnion([first, overlapping]), BillingInputError)
    assert.throws(() => billingAdmittedConfiguredRulesUnion([second, first]), BillingInputError)
  })

  it('encodes record 1 and record 2 with the contract profiles, extensions and a bound configured-rules digest', () => {
    const { admission, configuredRules: shards } = encodeBillingAdmission(admissionInput())
    assert.equal(shards?.length, 1)
    const configuredRules = shards![0]!
    const digest = expectedConfiguredRulesDigest([
      ['https://example.invalid/Library/rule-a|2026', DIGEST_C],
      ['https://example.invalid/Library/rule-b|2026', DIGEST_D],
    ])
    assert.equal(admission.resourceType, 'Provenance')
    assert.deepEqual(admission.meta, { profile: [BILLING_ADMISSION_PROFILE] })
    assert.deepEqual(admission.target, [{ reference: 'Library/edition-1' }])
    const extensions = admission.extension as { url: string; valueString?: string; extension?: { url: string }[] }[]
    assert.equal(extensions.find((item) => item.url === BILLING_ADMISSION_TENANT_EXTENSION)?.valueString, 'tenant-a')
    assert.equal(extensions.filter((item) => item.url === BILLING_ADMITTED_ARTIFACT_EXTENSION).length, 1)
    const bound = extensions.find((item) => item.url === BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION)
    assert.deepEqual(bound?.extension, [
      { url: 'reference', valueReference: { reference: 'Provenance/admitted-rules-1-1' } },
      { url: 'digest', valueString: digest },
    ])
    assert.equal(configuredRules.id, 'admitted-rules-1-1')
    assert.deepEqual(configuredRules.meta, { profile: [BILLING_ADMITTED_CONFIGURED_RULES_PROFILE] })
    assert.deepEqual(configuredRules.target, [{ reference: 'Library/edition-1' }])
    assert.deepEqual(configuredRules.entity, [
      { role: 'source', what: { identifier: { system: BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM, value: 'https://example.invalid/Library/rule-a|2026' } }, extension: [{ url: BILLING_ADMITTED_DIGEST_EXTENSION, valueString: DIGEST_C }] },
      { role: 'source', what: { identifier: { system: BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM, value: 'https://example.invalid/Library/rule-b|2026' } }, extension: [{ url: BILLING_ADMITTED_DIGEST_EXTENSION, valueString: DIGEST_D }] },
    ])
    assert.equal(billingAdmittedConfiguredRulesDigest([{ key: 'https://example.invalid/Library/rule-b|2026', digest: DIGEST_D }, { key: 'https://example.invalid/Library/rule-a|2026', digest: DIGEST_C }]), digest)
  })

  it('decodes both records strictly back into what the producer admitted', () => {
    const { admission, configuredRules: shards } = encodeBillingAdmission(admissionInput({ artifacts: [EDITION, RULE_SET] }))
    const configuredRules = shards![0]!
    const decoded = decodeBillingAdmission({ ...admission, meta: { ...admission.meta as object, versionId: '7', lastUpdated: '2026-10-10T08:00:01Z' } })
    assert.equal(decoded.kind, 'admission')
    if (decoded.kind !== 'admission') return
    assert.equal(decoded.tenant, 'tenant-a')
    assert.equal(decoded.target, 'edition-1')
    assert.deepEqual(decoded.artifacts, [EDITION, RULE_SET])
    assert.equal(decoded.producer, 'Synthetic producer')
    assert.deepEqual(decoded.configuredRules, [{ reference: 'Provenance/admitted-rules-1-1', digest: expectedConfiguredRulesDigest([['https://example.invalid/Library/rule-a|2026', DIGEST_C], ['https://example.invalid/Library/rule-b|2026', DIGEST_D]]) }])
    const rules = decodeBillingAdmission(configuredRules)
    assert.equal(rules.kind, 'admitted-configured-rules')
    if (rules.kind !== 'admitted-configured-rules') return
    assert.equal(rules.target, 'edition-1')
    assert.equal(rules.digest, decoded.configuredRules?.[0]?.digest)
    assert.deepEqual([...rules.rules.entries()], [['https://example.invalid/Library/rule-a|2026', DIGEST_C], ['https://example.invalid/Library/rule-b|2026', DIGEST_D]])
  })

  it('refuses records that do not have exactly the contract shape', () => {
    const { admission, configuredRules: shards } = encodeBillingAdmission(admissionInput())
    const configuredRules = shards![0]!
    const extensions = admission.extension as Record<string, unknown>[]
    const binding = extensions.find((item) => item.url === BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION)!
    const refused: [string, unknown][] = [
      ['another resource type', { ...admission, resourceType: 'AuditEvent' }],
      ['no admission profile', { ...admission, meta: {} }],
      ['two targets', { ...admission, target: [{ reference: 'Library/edition-1' }, { reference: 'Library/edition-2' }] }],
      ['a target that is no Library', { ...admission, target: [{ reference: 'Account/edition-1' }] }],
      ['no tenant', { ...admission, extension: extensions.filter((item) => item.url !== BILLING_ADMISSION_TENANT_EXTENSION) }],
      ['two tenants', { ...admission, extension: [...extensions, { url: BILLING_ADMISSION_TENANT_EXTENSION, valueString: 'tenant-b' }] }],
      ['an unknown Billing Core extension', { ...admission, extension: [...extensions, { url: 'https://fhir.cognovis.de/billing-core/extension/billing-admission-anything', valueString: 'x' }] }],
      ['a modifier extension', { ...admission, modifierExtension: [{ url: 'https://example.invalid/modifier', valueBoolean: true }] }],
      ['a malformed digest', { ...admission, extension: extensions.map((item) => item.url === BILLING_ADMITTED_ARTIFACT_EXTENSION ? { ...item, extension: (item.extension as { url: string }[]).map((part) => part.url === 'digest' ? { url: 'digest', valueString: 'sha256:XYZ' } : part) } : item) }],
      ['a catalog edition without source-set digest', { ...admission, extension: extensions.map((item) => item.url === BILLING_ADMITTED_ARTIFACT_EXTENSION ? { ...item, extension: (item.extension as { url: string }[]).filter((part) => part.url !== 'sourceSetDigest') } : item) }],
      ['unsorted admitted configured rules', { ...configuredRules, entity: [...(configuredRules!.entity as unknown[])].reverse() }],
      ['a shard without rules', { ...configuredRules, entity: [] }],
      ['one shard bound twice', { ...admission, extension: [...extensions, binding] }],
      ['an admitted configured rule without digest', { ...configuredRules, entity: (configuredRules!.entity as Record<string, unknown>[]).map((entity) => ({ ...entity, extension: [] })) }],
    ]
    for (const [label, resource] of refused) {
      assert.throws(() => decodeBillingAdmission(resource), BillingInputError, label)
    }
  })

  it('refuses to encode an admission without tenant, target or a catalog-edition binding for configured rules', () => {
    assert.throws(() => encodeBillingAdmission(admissionInput({ tenant: '' })), BillingInputError)
    // A shard id `<configuredRulesId>-<n>` must stay a FHIR id of at most 64 characters.
    assert.throws(() => encodeBillingAdmission(admissionInput({ configuredRulesId: 'r'.repeat(63) })), BillingInputError)
    assert.throws(() => encodeBillingAdmission(admissionInput({ target: 'Library/edition-1' })), BillingInputError)
    assert.throws(() => encodeBillingAdmission(admissionInput({ artifacts: [RULE_SET] })), BillingInputError)
    assert.throws(() => encodeBillingAdmission(admissionInput({ configuredRules: [{ key: 'https://example.invalid/Library/rule-a|2026', digest: DIGEST_C }, { key: 'https://example.invalid/Library/rule-a|2026', digest: DIGEST_D }] })), BillingInputError)
  })
})
