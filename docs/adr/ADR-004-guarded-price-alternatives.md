# ADR-004: A definition prices a claim at its one matching guarded alternative

**Status:** Accepted by cognovis/fhir-billing-core#214 (product owner decision,
2026-11-03, cognovis/chp#1615 option 1). Supersedes ADR-003's exclusion of
alternate prices; ADR-003's unvalued marker and single guarded base stay valid.
Amended by cognovis/fhir-billing-core#33 (2026-11-10): a published amount of
0.00 is a known price.

KV-regional EBM editions price one GOP differently by payer group, provider
type, fee schedule and payer. KV 71 prices 01100 at 24.97 EUR unconditionally
and at 41.19 EUR for payer group 81. ADR-003 can price only the unconditional
row and leaves the others unavailable, so claims under a condition are
under-billed. One definition per alternative is not possible either: an
edition holds one definition per coding (ADR-002), and the SDK refuses a
second one as `catalog-membership-ambiguous`. We therefore let one
ChargeItemDefinition state its alternatives in native R4 `propertyGroup`
entries. R4 already defines a group as "properties applicable under the same
conditions", so the carrier needs no profile or extension.

## Shape

- A **price alternative** is a property group with exactly one
  `applicability` entry in the ADR-003 language
  `application/x-fhir-billing-price-scope+json`. Its expression is
  `{ "schemaVersion": 1, "kind": "billing-price-alternative", "alternative": "<id>", "conditions": [...] }`.
  The conditions use ADR-003's grammar unchanged: conjunctive, one fact each,
  `from`, a restricted `path`, and exactly one nonempty `in` or `notIn` list.
- The `alternative` id is unique in the definition and names the alternative
  in evidence.
- A fact name that several alternatives use must declare the same `from` and
  `path` in each of them.
- An alternative carries exactly one price: one `base` component (an amount or
  a points factor, never both) or only ADR-003's informational `unvalued` marker.
- At most one group without `applicability` is the **publisher base**, with
  the same one-price rule. A definition without that group has no base.
- A definition uses either ADR-003's single `billing-price-scope` group or
  alternatives, never both. `amount-at-booking` does not combine with
  alternatives. Each other mix is `SNAPSHOT_MALFORMED`
  (`catalog-price-scope-invalid`). All amounts of one definition share one
  currency.

## Evaluation

For each catalog-priced line of the code, the SDK projects every fact that any
alternative names, through the existing fact-source projection:

1. If more than one alternative matches on known facts, the result is
   `unavailable` with `PRICE_APPLICABILITY_UNAVAILABLE` and explanation
   `catalog-price-alternative-ambiguous`. The SDK never picks the cheaper or
   the dearer row. Overlap is a publisher or producer defect, so this check
   runs before the unknown-fact check and also for lines with an explicit
   price.
2. If any of those facts is unknown for the line, its unit price is unknown
   (`unitPriceUnknown`). An unknown fact is never treated as a non-match,
   because the alternative it guards could match. The base is not used either.
3. If exactly one alternative matches, its price applies. A points or
   unvalued alternative gives an unknown unit price.
4. If none matches, the publisher base applies when the definition states one.
   Otherwise the unit price is unknown.

An amount must have at most two fraction digits, the rule the engine applies
to every catalog price. An amount of exactly 0.00 that the publisher states is
a known price of zero, and the engine's `resolveCatalogUnitPrices` fills a line
from a table entry of 0.00 (amended by cognovis/fhir-billing-core#33). A
missing table entry, a `unitPriceUnknown` entry, a points-only price and an
unvalued marker stay unknown, never zero. A line's own 0.00 stays the
placeholder that takes the table entry.

The reason is that KVs value some codes at 0.00 on purpose. The KV 71 edition
for Q4/2026 (SDEBM 851) values the TSVG case markers 99873A, 99873B, 99873H,
99873O and 99873T at 0.00 EUR: a practice books them to mark a TSVG case, and
the extra-budgetary TSVG payment for the case depends on the marker. That
edition carries 343 GOPs with such a published zero row (SDEBM unit 2, value
0), which differs from an unvalued row (unit 5). Refusing the zero amount
withheld these codes and made the TSVG payment unclaimable.

There is no missing-value default. The SDK never derives a fact and never
falls back to the base while a fact is unknown. The selection record names
the outcome for each line of the definition in `selection.priceAlternatives`:
`alternative` (with its id), `base`, or `unknown` (with cause `fact-unknown`
and the fact, or `no-alternative`). Resources the projection reads are writer
evidence.

A line with an explicit `priceOverride` keeps that amount only when its
outcome is an alternative or the base whose price is an amount or points. In
an unknown context, and in an unvalued alternative or base, its unit price is
unknown, as ADR-003 requires for unvalued definitions and for a guarded base
outside its scope. A history line on an alternatives definition has an unknown
price, because the current Account's facts do not prove that line's context
(ADR-003).

## Why this differs from ADR-003's guarded base

ADR-003 makes an unknown or unsupported context `unavailable`, because that
definition states one price and no other. An alternatives definition states
every context its publisher prices. For it, the ticket requires an unknown
context to leave only the amount unknown, so the line still gets its rule
verdict. Rules that need an amount stay `UNIT_PRICE_UNAVAILABLE`.

## Consequences

- ADR-002 hashes the whole `propertyGroup`, so every alternative, guard and
  fact source is bound by the definition digest and the admission. A changed
  alternative needs a new edition digest and admission.
- SDKs before this version refuse an alternatives definition as
  `SNAPSHOT_MALFORMED`. Producers must upgrade the SDK before they emit
  alternatives.
- The producer must make alternatives mutually exclusive, for example
  `notIn: ["81"]` on the default provider-type rows when payer group 81 has its
  own row. Fact producers and paths stay with the host or RDA; Core holds no
  country canonical.

## Considered options

- One definition per alternative: rejected, because it breaks the ADR-002 rule
  of one definition per coding and needs a second selection step.
- Ordered alternatives where the first match wins: rejected, because the
  source rows have no publisher order, and a wrong order prices the wrong
  claim without any visible error.
- A missing fact treated as a non-match: rejected, because it prices the base
  or another alternative for a claim that could fall under the guarded one.
