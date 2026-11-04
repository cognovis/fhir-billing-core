import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertFshGeneratedFresh, resourceDirectory } from './fsh-source-fingerprint.mjs'
import { extensionDefinitionUrls } from './ig-contract.mjs'

assertFshGeneratedFresh()
const implementationGuide = JSON.parse(readFileSync(join(resourceDirectory, 'ImplementationGuide-de.cognovis.fhir.billing.core.json'), 'utf8'))
extensionDefinitionUrls(readdirSync(resourceDirectory)
  .filter((name) => name.startsWith('StructureDefinition-') && name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(resourceDirectory, name), 'utf8'))))

const lines = [
  `/** Generated from FHIR R4 ${implementationGuide.fhirVersion[0]} and the Billing Core native-carrier conventions. */`,
  'export interface R4Meta { profile?: readonly string[] }',
  'export interface R4Resource { resourceType: string; id?: string; meta?: R4Meta }',
  "export interface BillingCatalogDefinitionResource extends R4Resource { resourceType: 'ChargeItemDefinition'; url: string; version: string; status: string }",
  "export interface BillingCatalogEditionRelatedArtifact { type: 'composed-of'; resource: string }",
  'export interface BillingCatalogEditionIdentifier { system: string; value: string }',
  'export interface BillingCatalogEditionPeriod { start: string; end?: string }',
  "export interface BillingCatalogEditionResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; publisher: string; type: unknown; effectivePeriod: BillingCatalogEditionPeriod; identifier: readonly BillingCatalogEditionIdentifier[]; relatedArtifact: readonly BillingCatalogEditionRelatedArtifact[]; content: readonly unknown[] }",
  "export interface BillingConfiguredRuleResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; type: unknown; identifier: readonly { system: string; value: string }[]; relatedArtifact: readonly { type: 'depends-on'; resource: string }[]; content: readonly unknown[] }",
  "export interface BillingRuleSetResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; type: unknown; identifier: readonly { system: string; value: string }[]; content: readonly unknown[] }",
  "export interface FhirParametersResource extends R4Resource { resourceType: 'Parameters'; parameter: readonly unknown[] }",
]
writeFileSync('packages/types/src/generated.ts', `${lines.join('\n')}\n`)
writeFileSync('packages/types/generation-closure.json', `${JSON.stringify({
  packages: [`hl7.fhir.r4.core#${implementationGuide.fhirVersion[0]}`],
  inputProfiles: [],
  baseDefinitions: [
    'http://hl7.org/fhir/StructureDefinition/ChargeItemDefinition',
    'http://hl7.org/fhir/StructureDefinition/Library',
    'http://hl7.org/fhir/StructureDefinition/Parameters',
    'http://hl7.org/fhir/StructureDefinition/Provenance',
  ],
}, null, 2)}\n`)
