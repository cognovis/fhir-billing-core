# Billing Core implementation plan

This plan is the local execution view of FHIR Management ADR-006. Bead
`fbc-4oy` is the single review and delivery unit for the first Core release.

## Inputs

- the accepted package ownership in FHIR Management ADR-006;
- the reviewed Billing Core and Swiss research in `fhir-billing-de`;
- the current neutral portions of Polaris `billing-rules` and
  `billing-conformance`; and
- a sanitized parity inventory that contains no protected catalog content.

## Ordered implementation slices

1. Publish the neutral FHIR carrier hierarchy, payload, admission, capability,
   result, hierarchical reason, precision, ordering, and version contracts.
2. Generate `@cognovis/fhir-billing-types` from base R4 plus the Core package
   and prove that no national package is in its generation closure.
3. Move and normalize the rule-class registry into
   `@cognovis/fhir-billing-rules`; replace national canonicals and literals with
   typed parameters and country-owned instances.
4. Extract the pure compiler and evaluator into
   `@cognovis/fhir-billing-engine`; require an already-loaded immutable catalog,
   rule set, and admission state.
5. Run synthetic German and Swiss portability fixtures through the same engine
   build and public API. Preserve neutral payload-v2 digests and publish the
   outcome and reason migration maps required by consumers.
6. Pack the FHIR and npm artifacts and run API, dependency-direction,
   prohibited-content, notice, deterministic-ordering, and fail-closed guards.

## Handoffs

- `fhir-billing-de` consumes the stable Core contract and owns German instances
  and canonical maps.
- Applications evaluate authoritative FHIR billing data through
  `@cognovis/fhir-billing-sdk` with the ADR-009 canonical profile-bound client
  (`@cognovis/fhir-sdk/client`) and caller-selected profile descriptors; the
  SDK does not persist the application mutation. Since 0.37.1 the SDK is
  maintained in the cognovis Health Platform, not in this repository.
- `polaris` consumes the npm packages and retains the reference-data
  adapter and German product integration.
- `fhir-billing-ch` consumes the same stable Core contract for its synthetic
  portability proof.
- FHIR Management registers the graph but does not automatically publish or
  cascade releases.

No Core release is authorized by completion of this plan alone. Coordinated
release approval remains separate from implementation.
