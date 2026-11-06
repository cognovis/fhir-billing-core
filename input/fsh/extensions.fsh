Extension: CatalogDefinitionDigest
Id: catalog-definition-digest
Title: "Catalog definition digest"
Description: "Content digest of a catalog definition on its composed-of entry in a catalog-edition Library. The scheme-2 member-set digest binds this value to the edition's admission."
Context: Library.relatedArtifact
* ^url = "https://fhir.cognovis.de/billing-core/extension/catalog-definition-digest"
* . 0..1
* extension 0..0
* value[x] 1..1
* value[x] only string
* valueString ^short = "sha256:<64 lowercase hexadecimal digits> from billingCatalogDefinitionDigest"

Extension: ConfiguredRuleMembersDigest
Id: configured-rule-members-digest
Title: "Configured rule members digest"
Description: "Digest of the configured-rule members depending on this catalog definition, on its composed-of entry in a catalog-edition Library declaring configured-rule-per-code completeness. An absent extension commits to no configured rules."
Context: Library.relatedArtifact
* ^url = "https://fhir.cognovis.de/billing-core/extension/configured-rule-members-digest"
* . 0..1
* extension 0..0
* value[x] 1..1
* value[x] only string
* valueString ^short = "sha256:<64 lowercase hexadecimal digits> from billingConfiguredRuleMembersDigest"

Extension: BillingAdmissionTenant
Id: billing-admission-tenant
Title: "Billing admission tenant"
Description: "Tenant for which the producer admits the target Library."
Context: Provenance
* ^url = "https://fhir.cognovis.de/billing-core/extension/billing-admission-tenant"
* . 0..1
* extension 0..0
* value[x] 1..1
* value[x] only string

Extension: BillingAdmittedArtifact
Id: billing-admitted-artifact
Title: "Billing admitted artifact"
Description: "Exact canonical, version and digest of one admitted catalog edition or rule set. Catalog editions also bind sourceSetDigest; rule sets bind publisher when the Library names one."
Context: Provenance
* ^url = "https://fhir.cognovis.de/billing-core/extension/billing-admitted-artifact"
* value[x] 0..0
* extension contains kind 1..1 and canonical 1..1 and version 1..1 and digest 1..1 and sourceSetDigest 0..1 and publisher 0..1
* extension[kind].extension 0..0
* extension[kind].value[x] 1..1
* extension[kind].value[x] only code
* extension[kind].valueCode ^short = "catalog-edition | rule-set"
* extension[canonical].extension 0..0
* extension[canonical].value[x] 1..1
* extension[canonical].value[x] only uri
* extension[version].extension 0..0
* extension[version].value[x] 1..1
* extension[version].value[x] only string
* extension[digest].extension 0..0
* extension[digest].value[x] 1..1
* extension[digest].value[x] only string
* extension[sourceSetDigest].extension 0..0
* extension[sourceSetDigest].value[x] 1..1
* extension[sourceSetDigest].value[x] only string
* extension[publisher].extension 0..0
* extension[publisher].value[x] 1..1
* extension[publisher].value[x] only string

Extension: BillingAdmittedConfiguredRules
Id: billing-admitted-configured-rules
Title: "Billing admitted configured rules"
Description: "Reference and digest binding one shard of an edition's admitted configured rules. Repeated in shard order on its admission record."
Context: Provenance
* ^url = "https://fhir.cognovis.de/billing-core/extension/billing-admitted-configured-rules"
* value[x] 0..0
* extension contains reference 1..1 and digest 1..1
* extension[reference].extension 0..0
* extension[reference].value[x] 1..1
* extension[reference].value[x] only Reference(Provenance)
* extension[digest].extension 0..0
* extension[digest].value[x] 1..1
* extension[digest].value[x] only string

Extension: BillingAdmittedDigest
Id: billing-admitted-digest
Title: "Billing admitted digest"
Description: "Configured-rule payload digest bound to one entity of an admitted configured-rules shard."
Context: Provenance.entity
* ^url = "https://fhir.cognovis.de/billing-core/extension/billing-admitted-digest"
* . 0..1
* extension 0..0
* value[x] 1..1
* value[x] only string
