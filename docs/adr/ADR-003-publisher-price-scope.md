# ADR-003: Preserve publisher-unvalued prices and guard a conditional base

**Status:** Accepted by cognovis/fhir-billing-core#200. Its exclusion of alternate prices is superseded by [ADR-004](ADR-004-guarded-price-alternatives.md).

This extends ADR-001's native R4 carriers and ADR-002's admitted definition
digests. The publisher can explicitly leave a definition unvalued, or state a
base that is safe only outside unsupported price conditions. A missing amount
alone cannot distinguish these cases from a malformed definition.

An informational price component coded
`https://fhir.cognovis.de/billing-core/CodeSystem/price-component#unvalued`
means publisher-unvalued. It carries neither `amount` nor `factor`, has no base
component and cannot also request `amount-at-booking`. Its lines always carry
`unitPriceUnknown`, including when a line supplies `priceOverride`. No amount
is computed. Rules that require an amount remain unavailable.

A single property group can guard its one base using one native
`propertyGroup.applicability` entry. The language is
`application/x-fhir-billing-price-scope+json`; its expression is strict JSON
`{ schemaVersion: 1, kind: "billing-price-scope", conditions: [...] }`.
Each conjunctive condition declares `fact`, `from`, a restricted fact-source
`path`, and exactly one nonempty code list, `in` or `notIn`. Origins and paths
use the existing SDK fact-source projection; no country canonical belongs in
Core. There is no missing-value default, exception, alternate price or arbitrary
expression execution. Exactly one known code must satisfy every condition for
each billed line, including a line with an explicit price override.

Otherwise the result is `unavailable`, reason
`PRICE_APPLICABILITY_UNAVAILABLE`, explanation `catalog-price-context-unknown`
or `catalog-price-context-unsupported`. Unknown languages and malformed guards
remain structural refusals. The source's alternative rows do not become base
components. Their applicability determines the producer's conservative base
guard. `CATALOG_PARTIAL` remains advisory and never substitutes for that guard.

ADR-002 already hashes all of `propertyGroup`, including the unvalued marker,
expression string and source declarations. Changing any of these needs a new
edition digest and admission. Runtime resources used by the guard enter writer
evidence. A history line's conditional base is unknown because the current
Account's context does not establish that history line's price scope.

These conventions add no custom profile or extension. They avoid a new rule
class and avoid pricing unsupported conditions. The 0.34 work under #187 must
build on this contract: alternate payer/provider prices, edition overlays and
broader pricing expressions are outside #200. Older SDKs reject the new scope
language; producers must upgrade the SDK before importing these carriers.
