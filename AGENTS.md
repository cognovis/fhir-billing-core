# Agent Instructions for fhir-billing-core

## Repository boundary

This repository holds the Billing Core IG and the engine packages
`@cognovis/fhir-billing-types`, `-rules` and `-engine`, all Apache-2.0 under
licensor cognovis GmbH. `@cognovis/fhir-billing-sdk` is maintained and
published from `cognovis/chp` (`fhir-foundation/packages/fhir-billing-sdk`)
since 0.37.1. Do not add it back here or cut an SDK release from this
repository; an SDK change lands in chp.

## Engine independence

A partner ships the engine inside its own product, so no engine package may
depend on a cognovis SDK.

- `types`, `rules` and `engine` declare no dependency, peer, optional,
  development or bundled dependency on any `@cognovis/*` package other than
  each other, and carry `license: Apache-2.0`.
- `scripts/engine-manifest-guard.mjs` enforces the rule
  (`npm run check:engine-manifests`). `npm test` runs its test,
  `.github/workflows/validate.yml` runs it on every pull request, and the
  release workflow `.github/workflows/release.yml` runs it before packing
  (tarballs are published through `ccore release publish-npm`, which runs no
  lifecycle scripts). `scripts/verify-release.mjs` applies the same check.
- `scripts/verify-packed-portability.mjs` installs the three packed archives
  offline into an empty consumer, refuses any further cognovis package in its
  tree, and proves public types, evaluator decisions and a refusal in Node and
  Bun. The release workflow supplies the same archives it publishes.
- Publication requires an explicit per-version npm tag on all three units and
  GitHub `--latest=false`; the workflow verifies existing pointers are unchanged.

## Contributions

[CONTRIBUTING.md](CONTRIBUTING.md) holds the DCO sign-off rule and the
maintainer statement. Commits that will be public carry a `Signed-off-by`
trailer. Land pull requests with `ccore pr merge --strategy merge`: the
default squash writes a new commit without the trailer.
