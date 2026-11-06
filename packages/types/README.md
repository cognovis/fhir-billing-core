# @cognovis/fhir-billing-types

Shared types and constants of FHIR Billing Core: the jurisdiction-neutral FHIR R4
contract for deterministic medical billing rules.

The package holds no logic. It defines what the other packages exchange:

- runtime types of a billing evaluation: `BillingCase`, `BillingLine`,
  `BillingRule`, `BillingRuleSet`, `BillingResult`, `AdmissionState` and the
  conformance record types;
- base R4 resource shapes of the Billing Core artifacts (catalog definitions as
  `ChargeItemDefinition`, catalog editions, configured rules and rule sets as
  `Library`);
- identifier systems, extension URLs, profile canonicals and code lists such as
  `BILLING_REASON_CODES` and `BILLING_RULE_SOURCE_KINDS`.

## Related packages

| Package | Role |
| --- | --- |
| `@cognovis/fhir-billing-types` | Types and constants (this package). |
| `@cognovis/fhir-billing-rules` | Rule-set payload, its decoder, digests, admission and the `Library` codec. Depends on this package. |
| `@cognovis/fhir-billing-engine` | Compiles an admitted rule set and evaluates billing cases. Depends on both. |
| `@cognovis/fhir-billing-sdk` | Reads authoritative billing data from a FHIR server and evaluates it with the engine. A separate package; the three above never depend on it. |

Install this package alone when you only need the types, for example to build
`BillingCase` inputs in another service. To evaluate rules, install
`@cognovis/fhir-billing-engine`, which brings this package along.

## Install

The `@cognovis` scope is served anonymously from `https://npm.cognovis.de`; no
token is needed. Add the scope line to the project's `.npmrc`:

```ini
@cognovis:registry=https://npm.cognovis.de
```

Then install:

```sh
npm install @cognovis/fhir-billing-types
```

The package is an ES module and needs Node.js 22 or later (Bun works as well).

## Entry points

One entry point, `@cognovis/fhir-billing-types`, with TypeScript declarations.
It has no dependencies.

## Example

Save as `example.mjs` next to the installation and run `node example.mjs`:

```js
import {
  BILLING_REASON_CODES,
  BILLING_RULE_PAYLOAD_SCHEMA_VERSION,
  BILLING_RULE_SEMANTIC_MAJOR,
} from '@cognovis/fhir-billing-types'

/** @type {import('@cognovis/fhir-billing-types').BillingCase} */
const billingCase = {
  id: 'example-case',
  asOf: '2026-01-15',
  lines: [
    {
      id: 'line-1',
      code: { system: 'https://example.invalid/fee-schedule', code: 'A100' },
      quantity: 1,
      unitPrice: { value: '12.50', currency: 'EUR' },
    },
  ],
  facts: {},
}

console.log('rule payload schema', BILLING_RULE_PAYLOAD_SCHEMA_VERSION, 'semantic major', BILLING_RULE_SEMANTIC_MAJOR)
console.log('case', billingCase.id, 'has', billingCase.lines.length, 'line')
console.log('knows RULE_REJECTED:', BILLING_REASON_CODES.includes('RULE_REJECTED'))
```

In TypeScript, import the types directly:
`import type { BillingCase } from '@cognovis/fhir-billing-types'`.

## Documentation

- Implementation guide: https://fhir.cognovis.de/billing-core/
- Source, rule classes and the engine contract: https://github.com/cognovis/fhir-billing-core

## License

Apache-2.0. The licensor is cognovis GmbH. The license covers cognovis-authored
material only; referenced FHIR specifications, terminologies and tariff
catalogs keep their own terms.
