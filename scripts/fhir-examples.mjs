import { buildBillingLibrary, decodeBillingLibrary, encodeBillingAdmission } from '@cognovis/fhir-billing-rules'
import { BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM } from '@cognovis/fhir-billing-types'

// Exercise every Library kind, including both catalog-edition emission paths, and the admission records
// (record 1 and its record-2 shards) the rules encoder writes for them. All content is synthetic and may
// also be passed to the official FHIR validator.
export function fhirExamples() {
  const definition = {
    resourceType: 'ChargeItemDefinition', id: 'synthetic-definition',
    url: 'https://example.invalid/ChargeItemDefinition/synthetic-definition', version: '1', status: 'draft',
    code: { coding: [{ system: 'https://example.invalid/synthetic', code: 'SYN-1' }] },
    propertyGroup: [{ priceComponent: [{ type: 'informational', code: { coding: [{ system: 'https://fhir.cognovis.de/billing-core/CodeSystem/price-component', code: 'unvalued' }] } }] }],
  }
  const canonical = `${definition.url}|${definition.version}`
  const rule = {
    id: 'synthetic-limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1,
    parameters: { selector: { system: 'https://example.invalid/synthetic', codes: ['SYN-1'] }, maximum: 2 },
  }
  const common = { version: '1', status: 'draft', publisher: 'Synthetic Authority' }
  const configuredRule = buildBillingLibrary({
    ...common, kind: 'configured-rule', id: 'synthetic-rule', url: 'https://example.invalid/Library/synthetic-rule',
    payload: { schemaVersion: 2, semanticMajor: 4, rule },
    relatedArtifacts: [{ type: 'depends-on', resource: canonical }],
  })
  const ruleSet = buildBillingLibrary({
    ...common, kind: 'rule-set', id: 'synthetic-rule-set', url: 'https://example.invalid/Library/synthetic-rule-set',
    payload: { schemaVersion: 2, semanticMajor: 4, id: 'synthetic-rules', rules: [rule] },
    relatedArtifacts: [],
  })
  const editionInput = {
    ...common, kind: 'catalog-edition', publisher: 'Synthetic Authority', catalogDefinitions: [definition],
    effectivePeriod: { start: '2026-01-01', end: '2026-12-31' },
    payload: {
      schemaVersion: 1, kind: 'billing-catalog-edition', catalogScope: 'synthetic',
      publicationPeriod: { start: '2026-01-01', end: '2026-12-31' },
      sources: [{
        sourceUri: 'https://example.invalid/source/synthetic', sourceVersion: '1', sourceDigest: `sha256:${'1'.repeat(64)}`,
        retrievedAt: '2026-01-02T00:00:00Z', producerVersion: 'synthetic-1', completeness: 'complete',
      }],
    },
    relatedArtifacts: [definition, configuredRule, ruleSet].map((resource) => ({ type: 'composed-of', resource: `${resource.url}|${resource.version}` })),
  }
  const edition = buildBillingLibrary({
    ...editionInput, id: 'synthetic-edition', url: 'https://example.invalid/Library/synthetic-edition',
  })
  const perCodeEdition = buildBillingLibrary({
    ...editionInput, id: 'synthetic-per-code-edition', url: 'https://example.invalid/Library/synthetic-per-code-edition',
    ruleCompleteness: 'configured-rule-per-code', configuredRules: [configuredRule],
    definitions: [{ canonical, system: 'https://example.invalid/synthetic', code: 'SYN-1' }],
    ruleSet,
  })
  const resources = [definition, configuredRule, ruleSet, edition, perCodeEdition]
  return [...resources, ...admissionRecords(perCodeEdition, ruleSet, configuredRule)]
}

function admissionRecords(editionLibrary, ruleSetLibrary, configuredRuleLibrary) {
  const edition = decodeBillingLibrary(editionLibrary)
  const ruleSet = decodeBillingLibrary(ruleSetLibrary)
  const configuredRule = decodeBillingLibrary(configuredRuleLibrary)
  const sourceSetDigest = editionLibrary.identifier.find((identifier) => identifier.system === BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM).value
  const common = { tenant: 'synthetic', recorded: '2000-01-01T00:00:00Z', producer: { display: 'synthetic producer' } }
  const ruleSetArtifact = { kind: 'rule-set', canonical: ruleSet.url, version: ruleSet.version, digest: ruleSet.digest, publisher: ruleSetLibrary.publisher }
  const editionAdmission = encodeBillingAdmission({
    ...common, id: 'synthetic-edition-admission', target: editionLibrary.id, configuredRulesId: 'synthetic-admitted-rules',
    artifacts: [{ kind: 'catalog-edition', canonical: edition.url, version: edition.version, digest: edition.digest, sourceSetDigest }, ruleSetArtifact],
    configuredRules: [{ key: `${configuredRule.url}|${configuredRule.version}`, digest: configuredRule.digest }],
  })
  const ruleSetAdmission = encodeBillingAdmission({ ...common, id: 'synthetic-rule-set-admission', target: ruleSetLibrary.id, artifacts: [ruleSetArtifact] })
  return [editionAdmission.admission, ...editionAdmission.configuredRules, ruleSetAdmission.admission]
}
