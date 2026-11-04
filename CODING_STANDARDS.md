# Coding Standards

The rules below apply to this repository. [AGENTS.md](AGENTS.md) holds the repository boundary
and the engine independence rule.

## Security

A billing decision is money: a rule that lets a store writer widen what an
evaluator allows is a payment defect. These rules come from the security review
of 2026-10-23 (cognovis/fhir-billing-core#165). Its rules on how the SDK reads
the store (a deciding resource belongs to the case, references compare only in
normal form, a replaced line contributes nothing) moved with the SDK to
`cognovis/chp` in 0.37.1.

1. **The publish job runs no build code.** In `.github/workflows/`, a job that
   reads a repository secret runs no repository or dependency code; it
   publishes only archives whose sha256 the build job recorded when it packed
   them. No step pipes a download into a shell. Every action outside the
   `actions/` organisation is pinned by commit SHA. Every checkout in a job that
   reads a secret or may write contents sets `persist-credentials: false`.
   `scripts/workflow-hardening.mjs` enforces this rule in `npm test`.

2. **Admission binds every value that decides money.** A carrier value that can
   change a price, an amount or which rules apply (a ChargeItemDefinition's
   `propertyGroup`, a definition's configured-rule membership, a rule's
   `depends-on` edge) is covered by a digest the admission record binds, never
   only by a digest the same resource declares about itself. A new carrier field
   of that kind goes into the member-set digest (`billingCatalogEditionDigest`,
   [ADR-002](docs/adr/ADR-002-member-set-digest-scheme-2.md)) or the rule-set
   payload digest. The `#165` cases in `tests/rules-library.test.ts` prove that
   the member-set digest covers each definition's content digest and its
   configured-rule membership.

3. **Core names no country canonical.** A country code system a consumer must
   read (for example the praxis practice-membership codes) is a host input of
   that consumer, never a constant of an engine package;
   `scripts/prohibited-content.mjs` refuses it in package sources (ADR-001).

## Verification route

Route: none
Proven: no
