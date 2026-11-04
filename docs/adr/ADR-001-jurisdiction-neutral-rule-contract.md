# ADR-001: Billing Core owns every portable rule algorithm and the reference engine

**Status:** Accepted

Billing Core owns the neutral FHIR carrier conventions, admission derivation,
result and diagnostic contracts plus `@cognovis/fhir-billing-types`,
`@cognovis/fhir-billing-rules`, and `@cognovis/fhir-billing-engine`. It does not
publish custom resource profiles or extensions. Base R4 resource types,
identifier systems, native relationships, `application/json` Library
attachments, versioned JSON payloads, and strict JSON schemas provide the
smallest interoperable carrier surface. A rule algorithm
belongs here whenever it can execute from typed inputs and versioned parameters
without a country, regime, national canonical, or legal-text branch, even when
its first known rule instance exists in only one jurisdiction. Rule instances
and rule values are imported content from the reference-data adapter or an
external rule-set author, not part of Core or a country package (product-owner
decision, 2026-10-07); country packages own regimes and bindings; adapters own catalog acquisition,
tenant-bound entitlement evidence, digest generation, persistence, and product
integration. This separation permits one deterministic engine to evaluate
German and Swiss synthetic cases without importing either country package into
Core or redistributing protected catalogs.

## Consequences

- Core depends only on FHIR R4 and neutral dependencies required by its authored contract.
- Native catalog editions, configured rules, and rule sets use base R4 `Library` resources; catalog definitions use `ChargeItemDefinition`, evidence uses `Provenance`, and fixtures use `Parameters`.
- Immutable artifacts do not assert their own admission or entitlement. The SDK derives structural and digest evidence and requires a tenant-bound resolver for entitlement.
- Legacy Billing Core `_profile` discovery and admission-extension parsing remain isolated read compatibility. Producers write only native carriers.
- A country-specific calculation is decomposed into a generic Core algorithm and a country-owned instance before the engine can support it.
- Missing, partial, unentitled, incompatible, or digest-mismatched required editions yield `needs-review`, never acceptance.
- `@cognovis/fhir-billing-engine`, `@cognovis/fhir-billing-rules`, and `@cognovis/fhir-billing-types` remain IO-free: they contain no network, filesystem, FHIR-store query, source decoder, tenant selection, country branch, or writeback behavior.
- `@cognovis/fhir-billing-sdk` is the FHIR-backed Billing Core package. It resolves authoritative billing snapshots through the ADR-009 canonical profile-bound client (`@cognovis/fhir-sdk/client`) rather than a caller-implemented transport or a second general FHIR client. It does not write FHIR; MIRA remains the sole conditional writer. Its optional host-owned persistence stores only versioned canonical reference artifacts, with codec/digest validation on restoration and current tenant authority checked per call. Database drivers and schema lifecycles stay with the host. Store-scoped generation fences prevent reuse after invalidation, including in-flight writes; storage failures remain misses.
- Polaris may temporarily expose compatibility adapters but cannot retain a second evaluator authority after migration.

## Implemented public contract

Version 0.1.0 fixes payload schema 2, rule semantic major 1, exact-decimal
precision, and priority-then-id ordering. The first registry contains quantity
limit, value limit, mutual exclusion, companion required, bounded multiplier,
accompanying-information required, patient-attribute constraint, and contract
participation. Unknown must-understand classes and any unusable required edition
are withheld as `needs-review`; malformed structural contradictions are typed
input errors. Canonical and reason migration maps are published under
`migration/` and are not alternate normative homes.

Version 0.2.0 adds shared must-understand semantics without changing payload
schema 2 and advances the rule semantic major to 2. Rules can declare required facts, counting scopes,
fact-driven exceptions, modifier exceptions, threshold effects, and agreement
override evidence. Cases carry typed fact availability, explicit counting-window
membership, modifiers, and actual multipliers. Missing decision-bearing evidence
produces a typed `needs-review` result; the evaluator never substitutes a default
multiplier or approximates an unavailable counting window.
The major break makes 0.1.x evaluators reject 0.2.0 rule sets before evaluation,
so an older consumer cannot silently ignore the new parameters.
Typed availability envelopes use `kind: "billing-fact"`; unmarked JSON objects,
including legacy values with their own `state` property, remain ordinary known
fact values. Quantity limits aggregate quantities across an explicit counting
window. Value limits remain line-local inside that window and compare each
line's pre-multiplier unit price times quantity independently.
An unmarked object using one of the reserved availability states is malformed
and rejected, preventing a dropped envelope marker from becoming known evidence.
FHIR reason parents describe the rejection-axis classification of a rule reason;
the configured rule effect may still route that reason to `needs-review`.

Version 0.3.0 widens the registry to fourteen classes without changing payload
schema 2 and advances the rule semantic major to 3. Setting constraint, prior
authorization required, procedure finding requirement, diagnosis requirement,
provider eligibility, and quota degression are generic algorithms over typed case
facts, so a source dialect carrying those families no longer forces a whole rule
set to be withheld. A coded predicate admits a list of coded members, each carrying
its own qualifier alternation, because one global code list beside one global
qualifier map is a lossy projection of a source that admits different qualifier
combinations per code. Each supplied entry contributes a decision, an ambiguity, or
nothing: a definite mismatch on any conjunctive constraint makes the entry a
decidable non-match and therefore never an ambiguity, an ambiguity is recorded only
when the missing information could still change that entry's verdict, and a
recorded ambiguity is emitted only when no entry matched fully. A complete entry
consequently decides both polarities, and neither an incomplete nor an unreadable
sibling can downgrade a settled answer to `needs-review`.
Numeric patient-attribute bounds now declare an explicit unit
and are compared against a unit-bearing case quantity by exact decimal arithmetic;
units in different dimensions, such as a year bound against a day fact, are
refused as uninterpretable rather than converted through an inexact calendar
factor. Value alternation is a first-class predicate on patient attributes and on
accompanying information, replacing single-value equality, and a multi-member
alternation is never collapsed to its first member. Unreadable, ambiguous, or
unstated inputs produce typed indeterminate reasons that name the responsible
fact, qualifier, or parameter, and the reason vocabulary is published as a
runtime-enumerable list. The major break makes 0.2.x evaluators reject 0.3.0 rule
sets before evaluation, and the removed `predicate.equals` and top-level `fact`
spellings are refused as typed input errors so an unmigrated rule set cannot be
silently reinterpreted.

Version 0.5.0 adds `minimum-evidence-count`, the portable algorithm for a
configured positive minimum over one or more unique named numeric fact sources.
Each source contributes `min(rawCount * credit, maximumCredit ?? rawCount *
credit)`, where every parameter and raw count is a safe integer. The algorithm
has no jurisdiction, contract, profession, payer, or catalog branch: country
packages configure source names and credits, while adapters supply those facts at
the point of action. A known-absent fact contributes zero; a missing,
not-supplied, or source-unavailable fact yields typed `needs-review`; malformed
counts, invalid parameters, credited-product overflow, or accumulated-sum
overflow are typed input errors. Payload schema 2 remains byte-compatible while
rule semantic major 4 makes semantic-major-3 rule sets unacceptable to the new
engine, preventing a consumer from silently evaluating a contract it cannot
fully understand.

Version 0.6.4 removes the eight active Billing Core resource profile identities
and seven extension identities. It replaces them with strict base R4 carrier
conventions and a shared codec. Catalog-edition manifests record normalized
source evidence and derive their source-set digest. The SDK requires an exact
tenant-bound entitlement resolver for native artifacts and derives all other
admission dimensions itself. Existing legacy carriers remain readable during
migration; they are no longer an authoring contract.

Version 0.7.1 defines the selector code contract. Selector codes match
literally, except that `"*"` as the only entry of `parameters.selector.codes`
selects every line code within the optional `selector.system`. Without it, a
rule scoped to every code had no portable spelling: a non-empty literal list
would couple the rule payload to one catalog edition. Without a system, `"*"`
selects the lines of every code system in the case; regime scoping comes from
the rule set composition or from `selector.system`. A list mixing `"*"` with
other codes, and `"*"` anywhere in the `excluded` or `required` companion
selectors, are typed input errors, because their meaning would be ambiguous. The
rule semantic major stays 4 and payload schema 2 and its canonical digest are
unchanged: a 0.7.0 evaluator admits such a rule but silently treats `"*"` as a
literal code that no line carries, so the rule never fires. Consumers must
upgrade to 0.7.1 to enforce rules that select every code.

Version 0.13.0 adds a standalone conformance entry point to the engine.
`evaluateConformanceCases` evaluates one rule set, given as a rule-set `Library`
or a bare payload, on typed cases under a standalone admission (the rule set is
its own admitted edition; no tenant or catalog decides) and returns one
`fhir-billing-conformance/1` record per case marked `mode: "standalone"`;
`compareConformanceRecords` diffs two engines' records by decision and blocking
`(lineId, ruleId)` pairs. Both stay IO-free. The command-line tool
`fhir-billing-check`, which reads files and writes stdout around them, is a `bin`
of `@cognovis/fhir-billing-sdk`, so the engine, rules and types packages keep
their no-filesystem boundary. A standalone record is a conformance result for
rule-set authors, never an admitted production verdict.

Version 0.15.0 adds in-memory bundle evaluation to the SDK. A rule-set author
evaluates cases written as FHIR resources through `evaluateBillingAccount`, the
projection MIRA uses, without a FHIR server. `createBundleFhirClient` is the
canonical client of `@cognovis/fhir-sdk/client` over a read-only in-memory
transport that answers only the SDK's own reads and searches and fails any other
search, so it is no second general FHIR client. `bundleEntitlementPolicy`
entitles exactly the supplied catalog-edition and rule-set artifacts by
canonical, version and digest; it is a named opt-in, and the SDK keeps no
allow-all default. `fhir-billing-check evaluate --bundle` prints one
`fhir-billing-conformance/1` record per Account marked `mode: "standalone-fhir"`.
Such a record, like a typed standalone record, is a conformance result, never an
admitted production verdict.

Version 0.17.0 adds rule provenance and the rule-set publisher. A rule may carry
`provenance`: its sources (statute, fee schedule, contract, court decision,
authority statement, commentary or author assessment, each with a citation), an
evidence-level coding and a note. Core keeps the contract neutral: the source
kinds name what a source is, not which jurisdiction issued it, and the
evidence-level system is the rule-set author's, so Core defines no scale and
never interprets a level. Provenance is data about a rule, not a parameter of
it: the rule-set digest covers it, so a changed citation is a new rule-set
version, but it never changes an outcome, a reason code or a detail. Every
reason a rule with provenance produces names that rule's sources and evidence
level, so a finding can be traced to what it rests on. A rule-set Library names
in `Library.publisher` the third party that maintains it and is responsible for
it; Core builds no rule-set Library without one and still decodes older rule-set
Libraries that have none. Core ships no real rules and fills no provenance into
country packages or adapter rule instances.

Version 0.18.0 lets the SDK read the facts its rules need from FHIR itself,
without a host-supplied fact contract. Native facts come only from generic R4
elements every jurisdiction shares: the Patient's birth date and gender, the
line's Encounter class and its Conditions, and the billing doctor's
PractitionerRole specialties and Practitioner qualifications. A
jurisdiction-specific fact (an insured-person status in a national Coverage
extension, a regional approval for a billed code, a Schein type in a national
code system) is read only through a fact-source declaration that the rule set
ships in its payload and that the rule-set digest covers. The declaration names
the fact, the resource it starts from and a small, strictly validated path to it,
so the country canonicals live with the rule-set author or the reference-data
adapter, and Core and the SDK contain none. A declaration is data, not code: the
path grammar is element names, `extension('<url>')` and a final
`coding('<system>')`, with an optional match per billed code, and anything the
path cannot prove leaves the fact `source-unavailable`, so a rule is unavailable
rather than decided on missing data. Facts that differ per line (the age on each
service date, each line's Encounter and doctor, each line's supplemental
information) are carried per line and read per line by the classes that decide a
line on one fact; case-wide they hold only a value every line shares.

Version 0.19.0 lets the selected Contract bring rule sets. A contract rule set is
an ordinary native rule-set Library bound to a Contract canonical, by a base R4
`depends-on` related artifact that a FHIR server can search and by the
`appliesTo` payload member that the rule-set digest covers; the two must name the
same Contracts. The binding lives on the rule-set carrier, so a contract owner
publishes rules for a Contract without editing the Contract resource and without
an extension, and Core stays country-neutral: it knows Contracts only by their
canonical identity, never an HZV or other regime by name. The contract rule set
answers the SDK's one question, whether a code is allowed on the Schein as it is
in FHIR, under that Contract; reimbursement and tariff coverage stay outside
Core. Its decision combines with the fee schedule's as any two rule sets do: a
`block` from either blocks, and a contract rule set that is bound but cannot be
used is `unavailable` rather than skipped, because a silently skipped contract
rule would let a code outside the contract pass.

Version 0.20.0 keeps the catalog edition's `composed-of` list as the only
authority on membership but stops reading every member to use a few of them. The
SDK finds the edition's rule set by its artifact kind and the billed lines'
definitions by their coding, and admits a hit only when its `url|version` is a
member; the member-set digest is still checked over the whole list. A native
rule-set member therefore has to carry the `rule-set` artifact-kind identifier,
which the carrier codec already requires; a legacy rule set without it stays
reachable only through an explicit selector. Members that decide nothing about
the evaluation, such as configured-rule Libraries, are neither read nor bound as
evidence, so the cost and the evidence of one evaluation follow the billed lines
rather than the edition's size.

Version 0.23.0 lets a host run rule sets that a third party maintains beside the
fee schedule's rule set, for example a practice's own check of its fee schedule.
An overlay rule set is a native rule-set Library bound to the catalog edition it
applies to in the same two parts as a contract rule set (a searchable
`depends-on` link and `appliesTo.catalogEditions` under the digest) and is never
a `composed-of` member, so its author neither republishes nor edits the edition,
and the edition's publisher stays the only authority on membership. The SDK
evaluates only the overlays the host names, each entitled on its own canonical,
version, digest and publisher, because the host, not the catalog publisher,
decides whom it trusts. Its verdict is reported apart from the fee schedule's
decision with its publisher, and the host's role decides its weight: an
`advisory` overlay never changes the decision, a `gate` overlay blocks or makes
the result `unavailable` like a contract rule set. An overlay that cannot be used
is reported `unavailable` rather than skipped, and as advisory it leaves the
decision unchanged, so a broken third-party check cannot stop billing that the
host did not make depend on it. A rule set binds to Contracts or to catalog
editions, never both, so each binding keeps one meaning.

cognovis/fhir-billing-core#54 adds `contract-code-list`, the portable algorithm
for a Contract's list of allowed codes: a selected line whose code the list does
not contain is rejected with `CONTRACT_CODE_NOT_PERMITTED`. The list is inline
rule data, so the rule-set digest and the admission record that binds it cover
every code, and no other store resource can widen it. The class belongs only to
a rule set bound to Contracts, because in a fee schedule's or overlay's rule set
it would apply to every Schein whatever its Contract. A billed coding that no
catalog edition contains is no longer `unavailable` before the Contract's rule
sets are read: the SDK holds it back, and it is decided only when a contract code
list blocks every line that bills it. In every other case its `SNAPSHOT_MISSING`
stands as an `unavailable` contribution, so a missing catalog entry can make a
result a `block` but never an `allow`. A code list carries no rule-level dates:
an inactive rule is skipped, so its validity is the contract rule set's effective
period, which fails closed. Nor does it take the shared parameters (counting
scope, fact exception, modifier exceptions): it judges each line of the Schein by
its own code, an exception would let a code outside the list pass, and a window
would let another Account's lines decide it. A conditional list is a separate
decision.

cognovis/fhir-billing-core#131 states the native age in completed units. A
completed coarser unit is not a finer count divided by a factor: a 34-month-old
is 2 completed years, which converted are 24 months, so a month bound read
against a year quantity allowed a child the bound excludes. The SDK therefore
projects `patient.age` as a list of completed quantities, one each in `a`, `mo`,
`wk` and `d`, and a numeric bound compares against the member in its own unit,
inclusive, never against a conversion. A bound in a unit the list does not state,
a list member that is no quantity in an interpretable unit, and a repeated unit
are `PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE`, so an incomplete projection fails
closed. A single quantity keeps the exact conversion within its dimension, and
cross-dimension bounds stay uninterpretable. An evaluator before this change
reads the list as no quantity and also fails closed.
