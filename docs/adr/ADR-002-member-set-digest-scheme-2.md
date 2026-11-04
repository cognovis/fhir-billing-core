# ADR-002: An edition's admission binds its definitions' prices and configured-rule membership

**Status:** Accepted (product owner, 2026-10-24, cognovis/fhir-billing-core#165)

An admission record binds a native catalog edition by its member-set digest.
Under scheme 1 that digest covered only the members' `url|version` strings.
Two findings of the 2026-10-23 security review followed from that:

- **F1:** a ChargeItemDefinition's price was checked only against the
  `catalog-digest` identifier on the same resource. A writer who could update an
  admitted definition at its `url|version` could change its amount and
  recompute that identifier, and the admission still matched.
- **F2:** a per-code edition states which configured rules depend on each
  definition through the `configured-rule-members-digest` extension of the
  definition's `composed-of` entry. The member-set digest did not cover that
  extension, and the configured-rule digest does not cover a rule's `depends-on`
  links. A writer could move a restrictive rule away from a billed definition
  and rewrite the extension, without re-admission.

## Decision

The member-set digest of a native catalog edition is scheme 2: SHA-256 over the
canonical JSON of `{ scheme: 2, members }`. `members` lists, for each
`composed-of` entry sorted by `url|version`, the entry's `url|version`, its
catalog definition digest or `null`, and its configured-rule members digest or
`null` (`billingCatalogEditionDigest`).

- Every catalog definition entry carries the definition's content digest in the
  extension `catalog-definition-digest` (`billingCatalogDefinitionDigest`: over
  `resourceType`, `url`, `version`, `code` and `propertyGroup`).
  `buildBillingLibrary` requires the edition's ChargeItemDefinitions as
  `catalogDefinitions` and writes it.
- The SDK uses a definition of a native edition only when its content digest
  equals the digest its edition entry carries. A missing or different digest is
  `DIGEST_MISMATCH`.
- The existing check of the configured rules found for a definition against
  that definition's members digest now rests on an admitted value. The check
  runs for each billed definition. A rule moved away from a definition, or
  onto another, changes the found set of both definitions, and an evaluation
  that bills either one is refused. An entry without a members digest commits
  to no configured rules. An edge added to an unbilled definition is checked
  when that definition is billed. An edge to a definition outside the edition
  never reaches an evaluation under it, because every billed line resolves to
  one of the edition's definitions. The configured-rule digest itself still
  excludes the `depends-on` links: the admitted members digests bind every edge
  that can change a decision.
- `buildBillingLibrary` refuses a per-code edition whose `definitions`
  inventory names a definition missing from `catalogDefinitions`.
- **Hard cutover.** There is no scheme-1 compatibility. An edition that still
  carries a scheme-1 digest fails with `SNAPSHOT_UNAUTHORIZED`
  (`edition-digest-outdated`), and the carrier codec refuses it with the cause
  `digest-scheme-v1`. Such an edition must be re-imported by the producer and
  re-admitted. An admission record of the old edition no longer admits anything.

Legacy editions (no artifact kind, admitted through the admission-state
extension) keep scheme 1. They are never admitted by record. Contract and
overlay rule sets are unchanged, because their rule-set digest already covers
their `depends-on` links.

## Alternatives considered

- **Definition digests in new admission shards**, as the configured-rule shards
  work. This was rejected because it needs a second record shape and more
  reads, while the edition Library already lists every definition.
- **Declaring ChargeItemDefinition writes producer-only** in the store's access
  policy, as for Library and Provenance. This was rejected because it leaves
  prices unbound by any digest and depends on every store's configuration.
- **Accepting scheme 1 during a transition.** The product owner rejected this:
  an edition admitted under scheme 1 is refused.

## Consequences

- Producers (the reference-data adapter) must upgrade to the release that
  carries scheme 2, pass `catalogDefinitions` when they build an edition,
  re-import every native edition and re-admit it per tenant. Re-admitting
  editions in customer stores is a production change.
- A host that adopts this SDK before its stores are re-admitted gets
  `unavailable` (`edition-digest-outdated`) for every native edition. Rolling
  it out and re-admitting the stores happen together.
