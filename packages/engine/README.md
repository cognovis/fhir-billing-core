# @cognovis/fhir-billing-engine

The reference evaluator of FHIR Billing Core: the jurisdiction-neutral FHIR R4
contract for deterministic medical billing rules.

The engine compiles an admitted, immutable rule set and evaluates billing cases
against it, with exact-decimal precision and priority-then-id ordering. It is
IO-free: it reads no files, network or FHIR server. The caller supplies the rule
set and each case with its own prices, facts, counting windows and contracts.

- `compileRuleSet(ruleSet, admission)` and `evaluateBillingCase(compiled, case)`
  evaluate a case under an admission state and return a `BillingResult` with
  outcome `accepted`, `rejected` or `needs-review` and its reasons.
- `evaluateConformanceCases({ ruleSet, cases })` evaluates one rule set on
  synthetic cases in standalone mode, without a FHIR server, catalog edition or
  tenant. Each case yields one `fhir-billing-conformance/1` record with the
  decision `allow`, `block` or `unavailable`.
- `compareConformanceRecords(left, right)` compares the records of two engines
  case by case, so another implementation can be checked against this one.

## Related packages

| Package | Role |
| --- | --- |
| `@cognovis/fhir-billing-types` | Types and constants. Installed with this package. |
| `@cognovis/fhir-billing-rules` | Rule-set payload, its decoder, digests, admission and the `Library` codec. Installed with this package. |
| `@cognovis/fhir-billing-engine` | Evaluator (this package). |
| `@cognovis/fhir-billing-sdk` | Reads authoritative billing data from a FHIR server, checks the tenant's admission of catalog editions and rule sets, and evaluates them with this engine. A separate package; the engine never depends on it, so it can be embedded in another product on its own. |

## Install

The `@cognovis` scope is served anonymously from `https://npm.cognovis.de`; no
token is needed. Add the scope line to the project's `.npmrc`:

```ini
@cognovis:registry=https://npm.cognovis.de
```

Then install:

```sh
npm install @cognovis/fhir-billing-engine
```

The package is an ES module and needs Node.js 22 or later (Bun works as well).

## Entry points

One entry point, `@cognovis/fhir-billing-engine`, with TypeScript declarations.
It also re-exports `BillingInputError` and the conformance record types. Import
rule-set and case types from `@cognovis/fhir-billing-types` and the rule-set
decoder from `@cognovis/fhir-billing-rules`.

## Example

Save as `example.mjs` next to the installation and run `node example.mjs`:

```js
import { evaluateConformanceCases } from '@cognovis/fhir-billing-engine'

const system = 'https://example.invalid/fee-schedule'

// One rule: code A100 may be billed at most once per case.
const ruleSet = {
  schemaVersion: 2,
  semanticMajor: 4,
  id: 'example-rules',
  rules: [
    {
      id: 'a100-once',
      class: 'quantity-limit',
      mustUnderstand: true,
      effect: 'reject',
      priority: 10,
      parameters: { selector: { system, codes: ['A100'] }, maximum: 1 },
    },
  ],
}

const line = (quantity) => ({
  id: 'line-1',
  code: { system, code: 'A100' },
  quantity,
  unitPrice: { value: '12.50', currency: 'EUR' },
})

const records = evaluateConformanceCases({
  ruleSet,
  cases: [
    { id: 'within-limit', asOf: '2026-01-15', lines: [line(1)], facts: {} },
    { id: 'over-limit', asOf: '2026-01-15', lines: [line(2)], facts: {} },
  ],
})

for (const record of records) {
  console.log(record.caseId, record.decision, record.findings.map((finding) => finding.code))
}
// within-limit allow []
// over-limit block [ 'QUANTITY_CAP_EXCEEDED' ]
```

A malformed rule set throws `BillingInputError` before any record; a case the
engine cannot read yields an `unavailable` record and the run continues.

## Documentation

- Implementation guide: https://fhir.cognovis.de/billing-core/
- Standalone evaluation, the conformance record format, rule classes and the
  engine contract: https://github.com/cognovis/fhir-billing-core#standalone-evaluation-and-comparison

## License

Apache-2.0. The licensor is cognovis GmbH. The license covers cognovis-authored
material only; referenced FHIR specifications, terminologies and tariff
catalogs keep their own terms.
