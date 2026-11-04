# ADR-005: A catalog edition bound to a Contract prices that Contract's lines

**Status:** Accepted by cognovis/fhir-billing-core#127. Extends ADR-002's member-set
digest and the edition selection of ADR-001; ADR-003 and ADR-004 price rules are
unchanged.

Practices bill under several HZV contracts, and each contract has its own tariff.
In one practice's PVS data (2026-10-11), 723 `hzv-ziffern-de` codes carry more than
one price across those tariffs. An edition holds one definition per coding
(ADR-002), so the contracts' prices cannot share one edition. The shared HZV edition
of reference-data-adapter#156 publishes those prices as unknown. Two editions in
force that hold one coding answer `SNAPSHOT_AMBIGUOUS`, because the SDK selects by
coding only.

## Decision

- A **contract-bound catalog edition** names its Contract canonicals in its
  manifest's `contracts`: a non-empty list of unique absolute canonicals, each a
  `Contract.url` or `Contract.instantiatesUri`, optionally `|version`. The Library
  carries one `depends-on` related artifact per Contract and no other, as a contract
  rule set does. `buildBillingLibrary` writes the links from the manifest.
  `decodeBillingLibrary` refuses links that are not exactly the manifest's
  Contracts, so an edition is bound or unbound, never both.
- Each catalog definition entry of a bound edition names the definition's billed
  coding (`system|code`, extension `catalog-definition-coding`). The member-set
  digest covers the sorted Contracts and each entry's coding: `{ scheme: 2,
  members, contracts }`, a member being `[url|version, definition digest, members
  digest, coding]`. A bound edition holds a coding that one of its admitted
  entries names, or whose found definition is its member. A writer who changes a
  definition's code therefore cannot hide the Contract's edition from a coding. The
  builder refuses a bound edition whose inventory is incomplete: every member is
  a given definition, its rule-set Library or a configured rule. An entry that
  still lacks its digest selects the edition, which then fails closed with
  `DIGEST_MISMATCH`. The admission record binds that digest, so it binds the Contract
  assignment. An unbound edition hashes `{ scheme: 2, members }` as before, so no
  existing edition needs re-import or re-admission. There is no scheme 3, because
  canonical JSON leaves the unbound form unchanged.
- **Selection.** A bound edition is a candidate only for a case whose Applicable
  Contract it is bound to (binding without version: every Contract of that
  identity; `url|version`: only a Contract with that `version`). For each billed
  coding, the bound editions that hold it are its only candidates; otherwise the
  unbound editions are, unchanged. Two overlapping editions bound to the same
  Contract that hold the coding answer `SNAPSHOT_AMBIGUOUS`, also when one of them
  covers every billed coding. An edition bound to other Contracts is never a
  candidate, also not through an explicit `catalog` selector. An explicit
  selector of another edition, while an edition bound to the Contract holds a
  billed coding, is `SNAPSHOT_AMBIGUOUS`: the host cannot set the Contract's
  tariff aside.
- Membership and binding decide only as admitted. Among several in-force editions,
  and for every edition an explicit selector sets aside (outside it, or matching
  it but excluded by the Contract), every native edition an
  admission record of the tenant targets is digest-checked and must be bound by
  one of those records, else the evaluation fails closed. Without this, a store
  writer could remove a coding from the Contract's edition, or retarget or strip
  its binding, and let the line fall back to the shared edition's price (CODING_STANDARDS
  rule 5). An edition no record of the tenant targets is not the tenant's and
  fails only where it is selected, as before. Without a tenant no native
  edition can be verified, so setting one aside fails closed. This costs one admission search per
  edition set aside, run at once and awaited after the selected editions are
  admitted. An edition bound to other Contracts that holds a
  billed coding, and its record, are evidence.
- A versioned binding to an identity of a Contract without `version` cannot be
  decided. Where its edition could price a line it fails closed with
  `SNAPSHOT_INCOMPATIBLE` (`contract-version-missing`), as a contract rule set does.
  It never falls back to an unbound edition.
- The bound edition prices its lines with its own definitions. ADR-003 and ADR-004
  decide each price as before, so a price that depends on other facts stays unknown.
  `selection.contractBoundEditions` names the edition and binding of every line
  it evaluates.
- Producers keep at most one bound edition per Contract in force. They end the
  previous edition's effective period when they load the next one. The SDK does
  not repair an overlap; it reports it as ambiguous.

## Alternatives considered

- **A contract price overlay rule set** beside a shared edition: prices are not
  rules, and an overlay never changes an amount.
- **Price alternatives guarded by the Contract** (ADR-004) in one shared
  definition: the Contract is no fact the price-scope language reads. Each
  contract's tariff would also be copied into every definition of every contract.
- **Selecting the bound edition only through the host's `catalog` selector**: the
  host would decide the tariff, and the admission would not bind the assignment.

## Consequences

- SDKs before 0.41.0 refuse a contract-bound edition: the codec rejects the
  manifest member `contracts`. Producers must upgrade before they load one.
- The reference-data adapter can publish one edition per HZV contract and admit
  each one. Codes without a contract tariff stay in the shared edition.
- Every candidate edition is read in full before selection, because the binding
  is in the links that edition discovery leaves out. That was already the case
  when the billed codings decide among several editions.
