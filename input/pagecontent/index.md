# FHIR Billing Core

FHIR Billing Core defines portable FHIR R4 contracts for deterministic medical
billing-rule evaluation.

The core owns rule types and calculation semantics. Country packages configure
those types with jurisdiction-specific rule instances, legal values,
terminology, catalogs, effective periods, and billing regimes.

The evaluator begins after a catalog and rule set have been selected and loaded.
It does not acquire, license, or persist source catalogs. Catalog definitions
use base R4 `ChargeItemDefinition`; catalog editions, configured rules, and rule
sets use base R4 `Library`; publication evidence uses base R4 `Provenance`; and
portable evaluator fixtures use base R4 `Parameters`. Billing Core publishes no
custom resource profiles. The `catalog-definition-digest` and
`configured-rule-members-digest` extensions carry the definition content and
configured-rule membership digests on a catalog-edition Library's `composed-of`
related artifacts. Each occurs at most once on an entry and carries one
`valueString` in `sha256:<64 lowercase hexadecimal digits>` form. The scheme-2
member-set digest binds both values; see the synthetic catalog-edition example.

The SDK's admission Provenance records use the Core extensions
`billing-admission-tenant`, `billing-admitted-artifact`,
`billing-admitted-configured-rules` and `billing-admitted-digest`. These carry
the existing tenant, artifact and configured-rule shard bindings. The SDK's
record-kind `meta.profile` markers are conventions with no StructureDefinitions
in this IG. The Reference Data Adapter's `billing-tenant`
canonical is not part of the SDK admission contract.

The `price-component` CodeSystem defines `unvalued`, an informational price
component marking a definition the publisher supplies without a valuation.
The marker carries neither amount nor factor; its unit price stays unknown.
See the synthetic unvalued-definition example.

Native libraries are distinguished by identifier systems, FHIR library
types, exact versioned relationships, `application/json` Library attachments, and
versioned JSON payloads. The SDK verifies those artifacts, derives availability, completeness,
compatibility, and digest match, then asks a tenant-bound entitlement resolver
for the exact selected artifacts and source records. Missing or uncertain
evidence fails closed.

## Publisher price carriers

A publisher-unvalued `ChargeItemDefinition` carries an informational
`propertyGroup.priceComponent` coded
`https://fhir.cognovis.de/billing-core/CodeSystem/price-component#unvalued`,
with no `amount`, `factor`, base component or `amount-at-booking` marker.
Its line carries `unitPriceUnknown: true`, even when `priceOverride` is set;
the SDK computes no amount. Rules requiring a price remain unavailable.

A single property group can guard its one base with one native
`applicability` entry whose language is
`application/x-fhir-billing-price-scope+json`. Its `expression` is a JSON
string containing `{ "schemaVersion": 1, "kind": "billing-price-scope",
"conditions": [...] }`. Each conjunctive condition names `fact`, an existing
fact-source origin in `from`, its restricted `path`, and exactly one nonempty
code list `in` or `notIn`. There are no missing-value defaults or alternate
prices. Each billed line must supply one known code satisfying every condition.

Unknown context or a context outside the base scope returns `unavailable`,
reason `PRICE_APPLICABILITY_UNAVAILABLE`, with explanation
`catalog-price-context-unknown` or `catalog-price-context-unsupported`.
An explicit line price cannot bypass the guard. Malformed scopes and unknown
languages fail closed. The source declarations and guards reside in
`propertyGroup`, which the definition digest and scheme-2 admission already bind.
These conventions add no profile or extension. See the repository README's
"Publisher-unvalued definitions and conditional base prices" section and ADR-003
for the exact JSON contract and producer obligations.

A definition can also state several guarded **price alternatives** (ADR-004).
Each alternative is one property group with one applicability entry in the
same language, whose expression has kind `billing-price-alternative`, a unique
`alternative` id and conditions in the grammar above, and exactly one price
component. At most one unguarded group is the publisher base. For each line,
when more than one alternative matches on known facts, the result is
`unavailable` (`PRICE_APPLICABILITY_UNAVAILABLE`,
`catalog-price-alternative-ambiguous`). Otherwise an unknown guard fact leaves
the unit price unknown, also for a line with an explicit price. Exactly one
match prices the line. When none matches, the publisher base
applies if one is stated; otherwise the price is unknown. The selection record
names each line's outcome in `priceAlternatives`. See the README's "Guarded
price alternatives" section.

The `contract-code-list` rule rejects a line whose code the selected Contract's
list of permitted codes does not contain, with `CONTRACT_CODE_NOT_PERMITTED`.
It belongs only to a rule set bound to Contracts.

The `minimum-evidence-count` rule evaluates configured positive-safe-integer
evidence counts using neutral fact names, per-source credits, and optional
bounded contributions. The Core evaluates the algorithm; country packages own
configured source names and values, and adapters own fact assembly.
