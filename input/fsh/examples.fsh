Instance: core-synthetic-oracle
InstanceOf: Parameters
Usage: #example
Title: "Core synthetic oracle"
Description: "Fictional profile-free portability fixture containing no operational catalog content."
* parameter[0].name = "rule-set"
* parameter[=].valueString = "{\"schemaVersion\":2,\"semanticMajor\":4,\"id\":\"synthetic-portability\",\"rules\":[]}"
* parameter[+].name = "case"
* parameter[=].valueString = "{\"id\":\"core-case\",\"asOf\":\"2026-08-14\",\"lines\":[],\"facts\":{}}"
* parameter[+].name = "expected-outcome"
* parameter[=].valueCode = #accepted
* parameter[+].name = "expected-reason"
* parameter[=].valueCoding = BillingReasonCS#ELIGIBLE

Instance: core-synthetic-definition-stable
InstanceOf: ChargeItemDefinition
Usage: #example
Title: "Core synthetic unchanged definition"
Description: "Fictional billing definition whose exact version is reused across publication periods."
* url = "https://example.invalid/fhir-billing-core/ChargeItemDefinition/syn-stable"
* version = "1.0"
* status = #active
* code = https://example.invalid/synthetic#SYN-STABLE

Instance: core-synthetic-catalog-edition-q1
InstanceOf: Library
Usage: #example
Title: "Core synthetic catalog edition Q1"
Description: "Base R4 Library selecting exact member versions and carrying the versioned edition manifest."
* url = "https://example.invalid/fhir-billing-core/Library/catalog-edition"
* version = "2026-Q1"
* status = #draft
* experimental = true
* publisher = "Synthetic Authority"
* type = $LibraryType#asset-collection
* effectivePeriod.start = "2026-01-01"
* effectivePeriod.end = "2026-03-31"
* identifier[0].system = "https://fhir.cognovis.de/billing-core/sid/artifact-kind"
* identifier[=].value = "catalog-edition"
* identifier[+].system = "https://fhir.cognovis.de/billing-core/sid/source-publication-digest"
* identifier[=].value = "sha256:377a060b57ccb94c2e643ded5e37f15c721d369b977d9bf55e506811c74c7a76"
* identifier[+].system = "https://fhir.cognovis.de/billing-core/sid/member-set-digest"
* identifier[=].value = "sha256:35f0143f1e490e93a6cbd26e457b439efee2257aae9541e13b0e7cd6cfde6591"
* identifier[+].system = "https://fhir.cognovis.de/billing-core/sid/billing-rule-completeness"
* identifier[=].value = "configured-rule-per-code"
* relatedArtifact[0].type = #composed-of
* relatedArtifact[=].resource = "https://example.invalid/fhir-billing-core/ChargeItemDefinition/syn-stable|1.0"
* relatedArtifact[=].extension[CatalogDefinitionDigest].valueString = "sha256:0989a00035871f11deb17f2a2600f7253cc2a0bcaa9817e50b8daefe3e30d832"
* relatedArtifact[=].extension[ConfiguredRuleMembersDigest].valueString = "sha256:f5b559ff0cdb4e6241b7e7dd852da36ec659922f0c2a1c6b46d5c76b2a3e9051"
* relatedArtifact[+].type = #composed-of
* relatedArtifact[=].resource = "https://example.invalid/fhir-billing-core/Library/configured-rule/synthetic-limit|1"
* relatedArtifact[+].type = #composed-of
* relatedArtifact[=].resource = "https://example.invalid/fhir-billing-core/Library/rule-set/synthetic|1"
* content.contentType = #application/json
* content.data = "eyJzY2hlbWFWZXJzaW9uIjoxLCJraW5kIjoiYmlsbGluZy1jYXRhbG9nLWVkaXRpb24iLCJjYXRhbG9nU2NvcGUiOiJzeW50aGV0aWMtY2F0YWxvZyIsInB1YmxpY2F0aW9uUGVyaW9kIjp7InN0YXJ0IjoiMjAyNi0wMS0wMSIsImVuZCI6IjIwMjYtMDMtMzEifSwic291cmNlcyI6W3sic291cmNlVXJpIjoiaHR0cHM6Ly9leGFtcGxlLmludmFsaWQvc291cmNlL3N5bnRoZXRpYy1jYXRhbG9nIiwic291cmNlVmVyc2lvbiI6IjIwMjYtUTEiLCJzb3VyY2VEaWdlc3QiOiJzaGEyNTY6MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInJldHJpZXZlZEF0IjoiMjAyNi0wMS0wMlQwMDowMDowMFoiLCJwcm9kdWNlclZlcnNpb24iOiJzeW50aGV0aWMtbWFwcGVyLTEiLCJjb21wbGV0ZW5lc3MiOiJjb21wbGV0ZSJ9XX0="

Instance: core-synthetic-definition-unvalued
InstanceOf: ChargeItemDefinition
Usage: #example
Title: "Core synthetic unvalued definition"
Description: "Fictional definition explicitly published without a valuation."
* url = "https://example.invalid/fhir-billing-core/ChargeItemDefinition/syn-unvalued"
* version = "1.0"
* status = #draft
* experimental = true
* code = https://example.invalid/synthetic#SYN-UNVALUED
* propertyGroup.priceComponent.type = #informational
* propertyGroup.priceComponent.code = BillingPriceComponentCS#unvalued

Instance: core-synthetic-rule-carrier
InstanceOf: Library
Usage: #example
Title: "Core synthetic configured rule"
Description: "Base R4 Library carrying one versioned configured-rule payload and an exact catalog dependency."
* url = "https://example.invalid/fhir-billing-core/Library/configured-rule/synthetic-limit"
* version = "1"
* status = #active
* type = $LibraryType#logic-library
* identifier[0].system = "https://fhir.cognovis.de/billing-core/sid/artifact-kind"
* identifier[=].value = "configured-rule"
* identifier[+].system = "https://fhir.cognovis.de/billing-core/sid/billing-rule-digest"
* identifier[=].value = "sha256:0e370dc38acdc5a18f6b802ab67b368a05c7270b2fdff7dbb8e26875982039b3"
* relatedArtifact.type = #depends-on
* relatedArtifact.resource = "https://example.invalid/fhir-billing-core/ChargeItemDefinition/syn-stable|1.0"
* content.contentType = #application/json
* content.data = "eyJzY2hlbWFWZXJzaW9uIjoyLCJzZW1hbnRpY01ham9yIjo0LCJydWxlIjp7ImlkIjoic3ludGhldGljLWxpbWl0IiwiY2xhc3MiOiJxdWFudGl0eS1saW1pdCIsIm11c3RVbmRlcnN0YW5kIjp0cnVlLCJlZmZlY3QiOiJyZWplY3QiLCJwcmlvcml0eSI6MSwicGFyYW1ldGVycyI6eyJzZWxlY3RvciI6eyJzeXN0ZW0iOiJodHRwczovL2V4YW1wbGUuaW52YWxpZC9zeW50aGV0aWMiLCJjb2RlcyI6WyJTWU4tU1RBQkxFIl19LCJtYXhpbXVtIjoyfX19"

Instance: core-synthetic-rule-set
InstanceOf: Library
Usage: #example
Title: "Core synthetic rule set"
Description: "Base R4 Library carrying one immutable aggregated rule-set payload."
* url = "https://example.invalid/fhir-billing-core/Library/rule-set/synthetic"
* version = "1"
* status = #active
* type = $LibraryType#logic-library
* identifier[0].system = "https://fhir.cognovis.de/billing-core/sid/artifact-kind"
* identifier[=].value = "rule-set"
* identifier[+].system = "https://fhir.cognovis.de/billing-core/sid/billing-rule-set-digest"
* identifier[=].value = "sha256:751bdf248b1666174f22109408e9ea6fe2628c3d7bd88671915179fe323d0d5f"
* content.contentType = #application/json
* content.data = "eyJzY2hlbWFWZXJzaW9uIjoyLCJzZW1hbnRpY01ham9yIjo0LCJpZCI6InN5bnRoZXRpYy1ydWxlcyIsInJ1bGVzIjpbXX0="

Instance: core-synthetic-provenance
InstanceOf: Provenance
Usage: #example
Title: "Core synthetic publication provenance"
Description: "Base R4 provenance for the synthetic native carriers."
* target[0] = Reference(core-synthetic-catalog-edition-q1)
* target[+] = Reference(core-synthetic-rule-set)
* recorded = "2026-08-14T00:00:00Z"
* agent.type = http://terminology.hl7.org/CodeSystem/provenance-participant-type#author
* agent.who = Reference(core-synthetic-publisher)
* entity.role = #source
* entity.what = Reference(core-synthetic-catalog-edition-q1)

Instance: core-synthetic-publisher
InstanceOf: Organization
Usage: #example
Title: "Core synthetic publisher"
Description: "Fictional publisher used only by the provenance example."
* active = true
* name = "Synthetic Billing Core Publisher"
