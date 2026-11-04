# Billing Core

Billing Core defines the jurisdiction-neutral language and deterministic
execution semantics shared by national medical-billing packages. Native
libraries are distinguished by identifier systems, `application/json` Library
attachments, and versioned JSON payloads.

## Language

**Publisher-unvalued definition**:
A catalog definition whose publisher explicitly assigns no valuation. Its unit
price is unknown, including when the billing line supplies an amount.

**Base price scope**:
The conjunctive conditions under which a catalog definition's base price is
usable. An unknown context or a context outside that scope leaves pricing unavailable.

**Price alternative**:
One guarded price of a catalog definition, valid only in the claim context its
conditions describe. Exactly one matching alternative prices a line; an unknown
condition fact leaves the unit price unknown, and two matches are ambiguous.
_Avoid_: Conditional price row, override price, regional surcharge

**Publisher base**:
The unguarded price a catalog definition with price alternatives states for a
context no alternative matches. Without one, such a context has no price.
_Avoid_: Default price, fallback price

**Rule type**:
A versioned calculation algorithm with typed inputs, parameters, results, and diagnostics that can execute without a country or legal-text branch.
_Avoid_: German rule, Swiss rule, evaluator special case

**Rule instance**:
An imported configuration of a rule type with regime, terminology, values, effective period, and contractual or legal bindings, written by the reference-data adapter or supplied by an external rule-set author. Neither Billing Core nor a country package ships rule instances.
_Avoid_: Rule type, engine rule

**Catalog edition**:
An immutable base R4 `Library` with artifact-kind `catalog-edition`, type `asset-collection`, one versioned manifest attachment, and exact `canonical|version` members. The manifest identifies catalog scope, publication period, and normalized source records. An unchanged definition keeps the version first published in an earlier period; a later edition reuses that member instead of copying or re-versioning it. Identical refreshes with the same authority, catalog scope, publisher identity, source-set digest, and member-set digest are the same edition.
_Avoid_: Live catalog, latest catalog, BillingCatalogSnapshot, BillingMasterDataSnapshot

**Contract-bound catalog edition**:
A native catalog edition bound to the canonical of each Contract whose own tariff it is, by a `depends-on` related artifact per Contract and the same Contracts in its manifest's `contracts`, with each definition entry naming its billed coding; the member-set digest covers both, so the admission record binds the Contract assignment and the codings the edition holds (ADR-005). For a line whose Applicable Contract it is bound to and whose coding it holds, it is the coding's only candidate edition and prices the line; it is never a candidate for a case of another Contract. An edition is contract-bound or unbound, never both, and at most one per Contract is in force: two overlapping ones holding the coding are ambiguous.
_Avoid_: HZV catalog, contract tariff overlay, contract price list (in code and docs)

**Configured rule carrier**:
A base R4 `Library` with artifact-kind `configured-rule`, type `logic-library`, one versioned payload attachment, a payload digest, and one or more unique, sorted `depends-on` relationships to catalog `canonical|version` values.
_Avoid_: BillingRuleCarrier profile, rule payload extension

**Configured-rule members digest**:
The digest on a declaring edition's member entry of a catalog definition (extension `configured-rule-members-digest`) over the sorted `canonical|version` list of the configured rule carriers that depend on that definition. A definition entry without it has no configured rules. The SDK compares the configured rules it finds for a billed definition against it. The member-set digest covers it, so the admission record binds it.
_Avoid_: per-code digest, rule index

**Catalog definition digest**:
The content digest of one catalog definition (`ChargeItemDefinition`) over its `resourceType`, `url`, `version`, `code` and `propertyGroup`, so over its prices, carried on the definition's member entry of a native edition (extension `catalog-definition-digest`). The member-set digest covers it, so the admission record binds every definition's prices. A definition is used only with the content its entry names.
_Avoid_: catalog digest identifier (the definition's own, self-declared `catalog-digest`), price hash

**Member-set digest scheme 2**:
The member-set digest of a native catalog edition since cognovis/fhir-billing-core#165 (ADR-002): over each member's `url|version`, catalog definition digest and configured-rule members digest. An edition still carrying the scheme-1 digest (over the `url|version` strings alone) is refused as `edition-digest-outdated` and must be re-imported and re-admitted (hard cutover).
_Avoid_: digest v2 (in code and docs), membership hash

**Per-code rule completeness**:
The declaration of a catalog edition, as the identifier `billing-rule-completeness` with value `configured-rule-per-code`, that its configured rule carriers hold every rule of the edition, one carrier per rule whose `depends-on` relationships name the edition's catalog definition of every code the rule names in any role (selector, excluded, required) that has one there, and that each such definition's member entry carries the configured-rule members digest. Building it takes every catalog definition of the edition, so a named code counts as absent only when no edition definition carries it; an edition member that is neither a given definition, a configured rule nor the one given rule-set Library (passed as the Library itself, not its canonical) refuses it. An edition with a rule that names no explicit codes (a `"*"` or code-less selector) cannot declare it. Only with it is an edition without a rule-set carrier evaluated from the configured rules of the billed codes; only the configured rules among its members count, so another edition's configured rule on a reused definition is not used.
_Avoid_: Split rule set, partial rule set

**Rule-set carrier**:
A base R4 `Library` with artifact-kind `rule-set`, type `logic-library`, one versioned aggregate payload attachment, and a payload digest.
_Avoid_: BillingRuleSet profile, compatibility extension stack

**Rule provenance**:
The optional `provenance` of a rule: a non-empty list of sources (each a kind such as `statute`, `fee-schedule` or `court-decision`, a citation, an optional URI, and optionally the fee numbers it concerns), an evidence-level coding whose system the rule-set author chooses, and an optional note. The rule-set digest covers it; it never changes evaluation, and every reason the rule produces names its sources and evidence level.
_Avoid_: rule justification, evidence score, FHIR Provenance resource

**Rule-set publisher**:
The party named in `Library.publisher` of a rule-set carrier that maintains the rule set and is responsible for it, optionally with `Library.contact`. Required to build a rule-set carrier since 0.17.0; an older carrier without one still decodes, and its records name no publisher. It is carrier metadata outside the payload digest and is attested only by the entitlement policy, which receives it in the rule-set entitlement request; the standalone typed path reports it as declared.
_Avoid_: rule-set owner, tenant, catalog publisher

**Billing snapshot**:
The SDK `BillingSnapshot` is the transient, evidence-bound FHIR read set used for one evaluation. It is not a stored copy of a catalog edition.
_Avoid_: Catalog edition, persisted catalog copy

**Service date**:
The date part of a ChargeItem's valid FHIR `occurrenceDateTime`, else of its `occurrencePeriod.start`; when that value carries a zoned time, its instant is compared against zoned period bounds. Coverage and Contract are selected per service date; an Account check without ChargeItems uses `asOf`, which otherwise remains the admission date for catalog editions and rule sets.
_Avoid_: Evaluation date, asOf as service date

**Selected Coverage**:
The single Coverage linked by `Account.coverage` that is `active`, whose period contains the service date, and whose beneficiary is the same Patient reference as the Account subject (relative references by id, absolute references only when identical, never absolute against relative); several such Coverages resolve only by the lowest `Account.coverage.priority`, and only when all their priorities are distinct.
_Avoid_: Caller-supplied Coverage, first Coverage

**KV-Arztpraxis (practice)**:
The practice under which a Kassenärztliche Vereinigung bills (BMV-Ä §1a no. 18). A line's practice is the `organization` of the one `OrganizationAffiliation` coded `kv-arztpraxis-membership` or `uebag-membership` whose participant is the line's site (`ChargeItem.performingOrganization`) and whose period contains the service date. No membership, several, or an unknown relationship code leaves it unknown.
_Avoid_: BSNR, Account owner, partOf root as practice

**Behandlungsfall**:
The counting window `quarter`/`patient-per-practice-and-insurer`: the lines of one patient at sites of one KV-Arztpraxis in one calendar quarter under one insurer, across Accounts (EBM I 3.1, BMV-Ä §21 para. 1). Not the per-Account `treatment-case`/`patient`.
_Avoid_: Schein, Account as treatment case

**Betriebsstättenfall**:
The counting window `quarter`/`patient-per-site-and-insurer`: the lines of one patient at one site (`ChargeItem.performingOrganization`, a Betriebsstätte or Nebenbetriebsstätte) in one calendar quarter under one insurer, across Accounts, whoever performed them (EBM I 3.3, BMV-Ä §21 para. 1a).
_Avoid_: KV-Arztpraxis as site, Account owner as site

**Arztfall**:
The counting window `quarter`/`patient-per-physician-number-and-insurer`: the lines of one patient by one physician number (LANR) in one calendar quarter under one insurer, across Accounts and independent of the site (EBM I 3.4, BMV-Ä §21 para. 1b).
_Avoid_: Practitioner resource as physician identity

**Physician number**:
The one value of the performing Practitioner's identifiers in the systems the host passes as `physicianNumber.systems` (the LANR for a German host). No value or several distinct values leave it unknown.
_Avoid_: Practitioner id

**Arztgruppenfall**:
The counting window `quarter`/`patient-per-practice-physician-group-and-insurer`: the lines of one patient by one physician group of one KV-Arztpraxis in one calendar quarter under one insurer, across Accounts (EBM I 3.5, BMV-Ä §21 para. 1c).
_Avoid_: Fachgruppe, WBO specialty as group

**Physician group**:
The one code, in the system the host passes as `physicianGroup.system`, of `PractitionerRole.specialty` on the performing Practitioner's in-force roles at the line's site. For a German host it is the EBM Arztgruppe: an EBM chapter, or a subsection in chapter 13. No role, a role without such a code, or several distinct codes leave it unknown.
_Avoid_: LANR digits, WBO specialty

**Behandlungstag**:
The counting window `day`/`patient-per-practice`: the lines of one patient at sites of one KV-Arztpraxis on one calendar day, across Accounts, whatever the number of sessions and the insurer (EBM I 3.8.5). The day is the line's `ChargeItem.occurrence`; for in-vitro diagnostics the writer records the specimen-collection date there. Not `day`/`patient`, which counts across practices.
_Avoid_: Session, Encounter day

**Applicable Contract**:
The single Contract linked by the Selected Coverage's `Coverage.contract` whose status is `executed`, `amended`, `appended`, or `renewed`, whose `applies` period contains the service date, and which carries a canonical identity (`url` or `instantiatesUri`). Only that identity takes part in contract-participation rules and selects the contract rule sets.
_Avoid_: Referenced Contract, Contract identifier value, ChargeItem Contract reference

**Contract rule set**:
A native rule-set carrier bound to the canonical of the Contract it applies to, by a `depends-on` related artifact per Contract and the same Contracts in the digest-covered payload member `appliesTo`. It decides which codes and conditions are allowed under that Contract, such as an HZV or selective contract's permitted codes; it never states what is reimbursed. The SDK resolves the contract rule sets bound to the Applicable Contract's canonical identity, entitles each through the tenant policy, and evaluates every line of the Schein against them beside the fee schedule's rule set: any `block` blocks, otherwise any `unavailable` is `unavailable`. A Contract without one evaluates as before.
_Avoid_: tariff, reimbursement rule set, Contract extension

**Overlay rule set**:
A native rule-set carrier a third party maintains, bound to the canonical of the catalog edition(s) it applies to by a `depends-on` related artifact per edition and the same editions in the digest-covered payload member `appliesTo.catalogEditions`, without being a `composed-of` member of the edition. The SDK evaluates only the overlays the host requests, each with a role, entitles each through the tenant policy, evaluates it on the lines of the editions it is bound to, and reports its verdict with its publisher apart from the fee schedule's decision: an `advisory` overlay never changes the decision, a `gate` overlay blocks or makes the result `unavailable` as a contract rule set does. A rule set is bound to Contracts or to catalog editions, never both.
_Avoid_: plugin rule set, extra edition member, third-party catalog edition

**Selection record**:
The SDK result evidence naming the Account, the service dates, the Selected Coverage and Applicable Contract with their versions and canonical identity, the catalog edition, the rule set, every contract rule set read, and per line the contract-bound catalog edition that priced it. It is complete for `allow` and a rule `block`, ends at the blocking step for a selection `block`, and holds the parts resolved before the failure for `unavailable`.
_Avoid_: Audit log, selection guess

**Catalog master data**:
Admitted catalog editions, billing definitions, and rule-set artifacts. They are not `ChargeItem` movement or other transactional billing data.
_Avoid_: ChargeItem, invoice line, encounter charge

**Points-only price**:
A catalog definition's base price component that carries a numeric `factor` (points) and no `amount`, published when no point value is configured. The line's unit price is unknown, not zero: the line carries `unitPriceUnknown: true` instead of a `unitPrice`, no amount is computed from the points, and a `value-limit` on it gives `UNIT_PRICE_UNAVAILABLE`.
_Avoid_: zero price, missing price, point value

**Admission state**:
A transient SDK result derived from native artifact structure, effective periods, source completeness, engine compatibility, verified digests, and the tenant's admission record in FHIR. It is not embedded as self-attested booleans in immutable artifacts.
_Avoid_: Loader status, generic billing role, admission extension

**Admission record**:
A `Provenance` with the `billing-admission` profile that a producer writes at import time to admit, for one tenant, one catalog-edition, contract or overlay rule-set Library: it targets that Library and binds each admitted artifact by kind, canonical, version and digest (an edition also by its source-set digest, a rule set by its publisher), and an edition's configured rules through an admitted-configured-rules record it binds by digest. The SDK evaluates a native carrier only when exactly one admission record of the tenant binds it; it never asks the producer.
_Avoid_: Entitlement call, tenant license, admission extension

**Admitted configured rules**:
The `Provenance` with the `billing-admitted-configured-rules` profile that lists every configured-rule member of one admitted edition as `url|version` with its configured-rule digest, sorted. Its digest is bound by the edition's admission record, so the record itself is no evidence of its own.
_Avoid_: Rule allow list, entitlement cache

**Artifact cache**:
The opt-in, host-held, bounded cache `createBillingArtifactCache` returns: it keeps admitted, digest-verified catalog artifacts (admitted configured rules, a billed definition's configured rules, merged rule sets) under the digests that admitted them, never Account-side data. A hit returns exactly that content with the evidence and receipts recorded when it was verified.
_Avoid_: Response cache, FHIR cache, entitlement cache

**Entitlement policy**:
Before 0.25.0, a host-supplied asynchronous resolver the SDK asked per artifact at evaluation time. Removed: an operation refuses `policy`, and native carriers are admitted by admission records. The `BillingEntitlement*` types stay exported, deprecated.
_Avoid_: Allow-all default, generic billing access, immutable entitlement boolean

**Standalone admission**:
The admission `evaluateConformanceCases` builds for one given rule set: the rule set is its own admitted, complete, entitled edition with its own digest, and no tenant, entitlement policy or catalog membership decides. Only a rule-set Library's effective period still applies.
_Avoid_: Production admission, tenant verdict

**Conformance record**:
One `fhir-billing-conformance/1` line per evaluated case, marked `mode: "standalone"` for a typed case or `mode: "standalone-fhir"` for an Account evaluated from FHIR Bundles, with the decision, the sorted findings and the rule set's id, digest and, for a Library, canonical and version. Two engines' records are compared by decision and blocking `(lineId, ruleId)` pairs.
_Avoid_: Billing result, oracle fixture, admitted verdict

**Bundle client**:
The read-only canonical FHIR client `createBundleFhirClient` returns over the resources of supplied FHIR Bundles. It answers exactly the reads and searches the Billing SDK issues, fails any other search and every write, and never opens a network connection.
_Avoid_: Mock server, test transport, general FHIR client

**Bundle admission records**:
The admission records `bundleAdmissionRecords` returns: they admit, for one tenant, exactly the catalog-edition, rule-set and configured-rule Libraries the supplied bundles contain, by kind, canonical, version and digest. `evaluateBundleConformance` serves them with the bundles. It is an explicit opt-in for evaluating supplied artifacts, never a default. `bundleEntitlementPolicy`, the policy it replaces, stays exported, deprecated.
_Avoid_: Allow-all policy, tenant license

**Conformance corpus**:
The synthetic rules, connecting master data and cases with expected decision, reason code and rule id that Billing Core's tests evaluate in memory through the bundle client, covering every rule class with a blocking and a non-blocking case. Its code systems are invented; it is no rule content.
_Avoid_: Reference rules, sample tariff, real rule set

**Native fact**:
A fact the SDK reads from generic FHIR R4 resources the Schein references, without any declaration: `patient.age` and `patient.gender` from the Account's Patient, `encounter.class` and `diagnoses` from the line's Encounter and its Conditions, `provider.qualifications` from the line's billing doctor. A native fact whose source the Schein does not prove is `source-unavailable`, so a rule needing it is unavailable rather than decided on missing data.
_Avoid_: Host fact, supplied fact, Observation fact

**Fact-source declaration**:
An entry of a rule set's `factSources`, covered by its digest, that names a jurisdiction-specific fact, the resource it is read from (Patient, selected Coverage, Account, the line's Encounter, the billing doctor's Practitioner or PractitionerRole, valid on the service date) and a strictly validated path to it (element names, `extension('<url>')`, a final `coding('<system>')`, optionally a match per billed code). It keeps Core free of any jurisdiction's canonical; a path that finds nothing leaves the fact `source-unavailable`.
_Avoid_: Fact mapping, host fact contract, FHIRPath expression

**Reason resolution**:
The optional typed `resolution` of a block reason (effect `reject`): the codings that would resolve it, with the action `add-one-of` (any one of them, with one of its listed qualifier values, satisfies the rule) or `remove` (the present codings that caused or may have caused the block, with their line ids for lines; a mutual exclusion names exactly the reason's own line when that line matches the excluded codes itself). It informs a UI and never changes a decision.
_Avoid_: Fix suggestion, rebooking proposal, details list

**Portability fixture**:
A synthetic case and rule set that proves the same Core engine contract across country packages without reproducing protected operational content.
_Avoid_: Sample tariff, demo catalog

**Unit-bearing bound**:
A numeric rule bound that declares its own unit and is compared only against a case quantity carrying a unit of the same dimension, by exact decimal arithmetic.
_Avoid_: Bare age, raw number bound

**Completed age**:
The native `patient.age` on a line's service date from a full `Patient.birthDate`, stated once per unit as completed years, months, weeks and days. A month is completed on the day of a later month that has the birth day's number, or on the first day of the following month when that month is shorter (born 31 January: 0 completed months on 28 February, 1 on 1 March). A year is 12 completed months, a week 7 completed days, and the birth date is day 0. An age bound compares against the completed quantity in its own unit, inclusive, so the n-th year of life is completed age n - 1 in `a`. A partial or unknown birth date gives no age in any unit.
_Avoid_: Age in years only, converted age

**Value alternation**:
An ordered set of admissible values a fact may take, satisfied when any supplied value equals any member of the set.
_Avoid_: Equals value, first accepted value

**Selector**:
The `parameters.selector` of a rule instance: a non-empty list of line codes, matched literally, with an optional code system. `"*"` as the only code selects every line code within that system, or of every system when none is given. The `excluded` and `required` companion selectors are literal only.
_Avoid_: Code pattern, wildcard mixed with codes, catalog-wide code list

**Country package**:
A national FHIR package that owns regimes, mappings, terminology bindings, source-publication decisions, and clinical or financial composition over Billing Core. It carries no rule instances or rule values.
_Avoid_: Engine plugin, Core extension

**IO-free engine**:
`@cognovis/fhir-billing-engine`, `@cognovis/fhir-billing-rules`, and `@cognovis/fhir-billing-types` execute from already-projected typed inputs. They have no network, FHIR client, or store transport.
_Avoid_: Billing SDK, FHIR client, snapshot resolution

**Billing SDK**:
The consumer of the engine contract, maintained and published from the cognovis Health Platform since 0.37.1 and not part of this repository. `@cognovis/fhir-billing-sdk` owns FHIR-backed billing snapshot resolution, Coverage and Contract selection for the service date, BillingCase projection, fail-closed evaluation, search receipts, and writer-bindable evidence. It reads through the ADR-009 canonical profile-bound client (`@cognovis/fhir-sdk/client`) and does not publish a second transport or general FHIR client; its bundle client is that canonical client over a read-only in-memory transport limited to the SDK's own reads and searches.
_Avoid_: Caller-implemented FhirTransport, second FHIR client, Aidbox client

**Canonical FHIR client**:
The single public Cognovis FHIR access client from `@cognovis/fhir-sdk/client`. Applications construct one client and pass that client, plus selected profile descriptors, into Billing SDK evaluation.
_Avoid_: Billing-owned HTTP client, raw URL access, Health Samurai types
