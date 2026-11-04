/** Generated from FHIR R4 4.0.1 and the Billing Core native-carrier conventions. */
export interface R4Meta { profile?: readonly string[] }
export interface R4Resource { resourceType: string; id?: string; meta?: R4Meta }
export interface BillingCatalogDefinitionResource extends R4Resource { resourceType: 'ChargeItemDefinition'; url: string; version: string; status: string }
export interface BillingCatalogEditionRelatedArtifact { type: 'composed-of'; resource: string }
export interface BillingCatalogEditionIdentifier { system: string; value: string }
export interface BillingCatalogEditionPeriod { start: string; end?: string }
export interface BillingCatalogEditionResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; publisher: string; type: unknown; effectivePeriod: BillingCatalogEditionPeriod; identifier: readonly BillingCatalogEditionIdentifier[]; relatedArtifact: readonly BillingCatalogEditionRelatedArtifact[]; content: readonly unknown[] }
export interface BillingConfiguredRuleResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; type: unknown; identifier: readonly { system: string; value: string }[]; relatedArtifact: readonly { type: 'depends-on'; resource: string }[]; content: readonly unknown[] }
export interface BillingRuleSetResource extends R4Resource { resourceType: 'Library'; url: string; version: string; status: string; type: unknown; identifier: readonly { system: string; value: string }[]; content: readonly unknown[] }
export interface FhirParametersResource extends R4Resource { resourceType: 'Parameters'; parameter: readonly unknown[] }
