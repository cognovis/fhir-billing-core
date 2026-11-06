# @cognovis/fhir-billing-rules

The rule contract of FHIR Billing Core: the jurisdiction-neutral FHIR R4
contract for deterministic medical billing rules.

A rule set is a versioned JSON payload (`schemaVersion` 2, `semanticMajor` 4,
`id`, `rules`, optionally `factSources` and `appliesTo`). This package owns
everything about that payload except evaluating it:

- the strict decoder `decodeBillingRuleSet` and `defineBillingRuleSet`, which
  refuse a malformed payload with `BillingInputError`;
- the payload digests `billingRuleSetDigest` and `billingRulePayloadDigest`
  over canonical JSON (`canonicalizeJson`);
- the generic rule-class registry (`BILLING_RULE_CLASS_DEFINITIONS`,
  `isGenericRuleClass`) and admission of a rule set (`admitBillingRuleSet`);
- the native FHIR `Library` codec for catalog editions, configured rules and
  rule sets (`buildBillingLibrary`, `decodeBillingLibrary`);
- the rule-set JSON Schema (draft 2020-12), with one `parameters` schema per
  rule class, for editors and validators.

## Related packages

| Package | Role |
| --- | --- |
| `@cognovis/fhir-billing-types` | Types and constants. Installed with this package. |
| `@cognovis/fhir-billing-rules` | Rule contract (this package). |
| `@cognovis/fhir-billing-engine` | Compiles an admitted rule set and evaluates billing cases. Depends on this package. |
| `@cognovis/fhir-billing-sdk` | Reads authoritative billing data from a FHIR server and evaluates it with the engine. A separate package; the three above never depend on it. |

Install this package to write, check or encode rule sets. To evaluate them,
install `@cognovis/fhir-billing-engine`.

## Install

The `@cognovis` scope is served anonymously from `https://npm.cognovis.de`; no
token is needed. Add the scope line to the project's `.npmrc`:

```ini
@cognovis:registry=https://npm.cognovis.de
```

Then install:

```sh
npm install @cognovis/fhir-billing-rules
```

The package is an ES module and needs Node.js 22 or later (Bun works as well).

## Entry points

- `@cognovis/fhir-billing-rules`: the decoder, digests, rule-class registry,
  admission and `Library` codec, with TypeScript declarations.
- `@cognovis/fhir-billing-rules/schema/billing-rule-set.schema.json`: the
  rule-set JSON Schema. Its `$id` is
  `https://fhir.cognovis.de/billing-core/schema/billing-rules/v2`
  (`BILLING_RULE_PAYLOAD_SCHEMA_URI`). A rule-set file can name it in a
  top-level `$schema`, for example
  `"$schema": "./node_modules/@cognovis/fhir-billing-rules/schema/billing-rule-set.schema.json"`,
  so editors validate and complete it. The decoder accepts and drops `$schema`.

The decoder is the authority: a payload the schema refuses, the decoder refuses
too, and the decoder also checks what JSON Schema cannot state, such as unique
rule ids.

## Example

Save as `example.mjs` next to the installation and run `node example.mjs`:

```js
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  BILLING_RULE_PAYLOAD_SCHEMA_URI,
  BillingInputError,
  billingRuleSetDigest,
  decodeBillingRuleSet,
} from '@cognovis/fhir-billing-rules'

// Decode a rule set with one rule: a line of code A100 may carry a quantity of at most 1.
const ruleSet = decodeBillingRuleSet({
  $schema: BILLING_RULE_PAYLOAD_SCHEMA_URI,
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
      parameters: { selector: { system: 'https://example.invalid/fee-schedule', codes: ['A100'] }, maximum: 1 },
    },
  ],
})
console.log('decoded', ruleSet.id, 'digest', billingRuleSetDigest(ruleSet))

// A malformed rule set is refused with BillingInputError.
try {
  decodeBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'broken', rules: [{ id: '', class: 'quantity-limit' }] })
} catch (error) {
  if (!(error instanceof BillingInputError)) throw error
  console.log('refused:', error.message)
}

// The JSON Schema ships in the package.
const schemaPath = createRequire(import.meta.url).resolve('@cognovis/fhir-billing-rules/schema/billing-rule-set.schema.json')
console.log('schema', JSON.parse(readFileSync(schemaPath, 'utf8')).$id)
```

## Documentation

- Implementation guide: https://fhir.cognovis.de/billing-core/
- Rule classes with their parameters and examples, and the rule-set JSON
  Schema: https://github.com/cognovis/fhir-billing-core#rule-set-json-schema
- The schema of each release is also a GitHub release asset:
  `https://github.com/cognovis/fhir-billing-core/releases/download/v<version>/billing-rule-set.schema.json`

## License

Apache-2.0. The licensor is cognovis GmbH. The license covers cognovis-authored
material only; referenced FHIR specifications, terminologies and tariff
catalogs keep their own terms.
