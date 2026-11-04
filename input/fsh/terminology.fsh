CodeSystem: BillingPriceComponentCS
Id: price-component
Title: "Billing price component"
Description: "Publisher valuation markers on catalog definitions."
* ^url = "https://fhir.cognovis.de/billing-core/CodeSystem/price-component"
* ^caseSensitive = true
* ^content = #complete
* #unvalued "Unvalued" "The publisher supplies no valuation for this definition. Its informational marker has neither amount nor factor; the unit price remains unknown, including when a line carries an explicit price."

CodeSystem: BillingRuleClassCS
Id: billing-rule-class
Title: "Billing Rule Class"
Description: "Jurisdiction-neutral algorithms implemented by the Core reference engine."
* ^url = "https://fhir.cognovis.de/billing-core/CodeSystem/billing-rule-class"
* ^caseSensitive = true
* ^content = #complete
* #quantity-limit "Quantity limit"
* #value-limit "Value limit"
* #mutual-exclusion "Mutual exclusion"
* #companion-required "Companion required"
* #bounded-multiplier "Bounded multiplier"
* #accompanying-information-required "Accompanying information required"
* #patient-attribute-constraint "Patient attribute constraint"
* #contract-participation "Contract participation"
* #setting-constraint "Setting Constraint"
* #prior-authorization-required "Prior Authorization Required"
* #procedure-finding-requirement "Procedure Finding Requirement"
* #diagnosis-requirement "Diagnosis Requirement"
* #provider-eligibility "Provider Eligibility"
* #quota-degression "Quota Degression"
* #minimum-evidence-count "Minimum evidence count"
* #contract-code-list "Contract code list"

CodeSystem: BillingOutcomeCS
Id: billing-outcome
Title: "Billing Outcome"
Description: "The deterministic tri-state evaluator outcome."
* ^url = "https://fhir.cognovis.de/billing-core/CodeSystem/billing-outcome"
* ^caseSensitive = true
* ^content = #complete
* #accepted "Accepted"
* #rejected "Rejected"
* #needs-review "Needs review"

CodeSystem: BillingReasonCS
Id: billing-reason
Title: "Billing Reason"
Description: "Hierarchical coarse and axis-level reasons emitted by the reference engine."
* ^url = "https://fhir.cognovis.de/billing-core/CodeSystem/billing-reason"
* ^caseSensitive = true
* ^content = #complete
* ^hierarchyMeaning = #is-a
* #ELIGIBLE "Eligible"
* #CATALOG_PARTIAL "Catalog edition partial" "Advisory that accompanies an allow or a rule block and never changes the decision: the admitted catalog edition declares partial source completeness, so only its decoded rules were evaluated and constraints its publisher has not decoded were not checked."
* #ACCOUNT_OWNER_PRACTICE_DIFFERS "Account owner in another practice" "Advisory that accompanies an allow or a rule block and never changes the decision: the owner of the evaluated Account belongs to another practice (KV-Arztpraxis) on a line's service date than the line's site, whose practice alone decides the counting windows."
* #RULE_REJECTED "Rule rejected"
* #RULE_REJECTED #QUANTITY_CAP_EXCEEDED "Quantity cap exceeded"
* #RULE_REJECTED #VALUE_CAP_APPLICABLE "Value cap applicable"
* #RULE_REJECTED #MUTUALLY_EXCLUSIVE_CODE_PRESENT "Mutually exclusive code present"
* #RULE_REJECTED #COMPANION_CODE_REQUIRED "Companion code required"
* #RULE_REJECTED #MULTIPLIER_OUT_OF_BOUNDS "Multiplier out of bounds"
* #RULE_REJECTED #MULTIPLIER_THRESHOLD_EXCEEDED "Multiplier threshold exceeded"
* #RULE_REJECTED #MULTIPLIER_JUSTIFICATION_REQUIRED "Multiplier justification required"
* #RULE_REJECTED #ACCOMPANYING_INFORMATION_REQUIRED "Accompanying information required"
* #RULE_REJECTED #PATIENT_ATTRIBUTE_MISMATCH "Patient attribute mismatch"
* #RULE_REJECTED #CONTRACT_PARTICIPATION_REQUIRED "Contract participation required"
* #RULE_REJECTED #SETTING_NOT_PERMITTED "Setting not permitted"
* #RULE_REJECTED #PRIOR_AUTHORIZATION_REQUIRED "Prior authorization required"
* #RULE_REJECTED #PROCEDURE_FINDING_NOT_SATISFIED "Procedure finding not satisfied"
* #RULE_REJECTED #DIAGNOSIS_NOT_SATISFIED "Diagnosis not satisfied"
* #RULE_REJECTED #PROVIDER_NOT_ELIGIBLE "Provider not eligible"
* #RULE_REJECTED #QUOTA_DEGRESSION_APPLICABLE "Quota degression applicable"
* #RULE_REJECTED #MINIMUM_EVIDENCE_NOT_MET "Minimum evidence not met"
* #RULE_REJECTED #CONTRACT_CODE_NOT_PERMITTED "Contract code not permitted"
* #NEEDS_REVIEW "Needs review"
* #NEEDS_REVIEW #ADMISSION_INCOMPLETE "Admission incomplete"
* #NEEDS_REVIEW #EDITION_UNAVAILABLE "Edition unavailable"
* #NEEDS_REVIEW #EDITION_UNENTITLED "Edition unentitled"
* #NEEDS_REVIEW #EDITION_EXPIRED "Edition expired"
* #NEEDS_REVIEW #EDITION_INCOMPATIBLE "Edition incompatible"
* #NEEDS_REVIEW #DIGEST_MISMATCH "Digest mismatch"
* #NEEDS_REVIEW #UNSUPPORTED_RULE "Unsupported must-understand rule"
* #NEEDS_REVIEW #REQUIRED_FACT_UNAVAILABLE "Required fact unavailable"
* #NEEDS_REVIEW #RULE_EXCEPTION_UNAVAILABLE "Rule exception unavailable"
* #NEEDS_REVIEW #COUNTING_SCOPE_UNAVAILABLE "Counting scope unavailable"
* #NEEDS_REVIEW #ACTUAL_MULTIPLIER_UNAVAILABLE "Actual multiplier unavailable"
* #NEEDS_REVIEW #UNIT_PRICE_UNAVAILABLE "Unit price unavailable" "A value limit applies to a line whose unit price is unknown, for example because its catalog definition carries points but no amount, so the limit cannot be checked; the amount is never assumed."
* #NEEDS_REVIEW #AGREEMENT_OVERRIDE_UNAVAILABLE "Agreement override unavailable"
* #NEEDS_REVIEW #SETTING_INDETERMINATE "Setting indeterminate"
* #NEEDS_REVIEW #PRIOR_AUTHORIZATION_INDETERMINATE "Prior authorization indeterminate"
* #NEEDS_REVIEW #PROCEDURE_FINDING_INDETERMINATE "Procedure finding indeterminate"
* #NEEDS_REVIEW #DIAGNOSIS_INDETERMINATE "Diagnosis indeterminate"
* #NEEDS_REVIEW #PROVIDER_ELIGIBILITY_INDETERMINATE "Provider eligibility indeterminate"
* #NEEDS_REVIEW #QUOTA_DEGRESSION_INDETERMINATE "Quota degression indeterminate"
* #NEEDS_REVIEW #QUOTA_PARAMETER_UNAVAILABLE "Quota parameter unavailable"
* #NEEDS_REVIEW #PATIENT_ATTRIBUTE_INDETERMINATE "Patient attribute indeterminate"
* #NEEDS_REVIEW #PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE "Patient attribute unit unavailable"
* #NEEDS_REVIEW #ACCOMPANYING_INFORMATION_INDETERMINATE "Accompanying information indeterminate"
* #NEEDS_REVIEW #MINIMUM_EVIDENCE_INDETERMINATE "Minimum evidence indeterminate"

ValueSet: BillingOutcomeVS
Id: billing-outcome
Title: "Billing Outcome"
Description: "All Core billing outcomes."
* ^url = "https://fhir.cognovis.de/billing-core/ValueSet/billing-outcome"
* include codes from system BillingOutcomeCS

ValueSet: BillingReasonVS
Id: billing-reason
Title: "Billing Reason"
Description: "All Core billing reasons."
* ^url = "https://fhir.cognovis.de/billing-core/ValueSet/billing-reason"
* include codes from system BillingReasonCS
