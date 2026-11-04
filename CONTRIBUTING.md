# Contributing to FHIR Billing Core

FHIR Billing Core holds the jurisdiction-neutral billing IG and the reference
engine packages `@cognovis/fhir-billing-types`, `@cognovis/fhir-billing-rules`
and `@cognovis/fhir-billing-engine`.

## Ownership and maintenance

cognovis GmbH owns and maintains this project and is the licensor of
everything in it. cognovis GmbH reviews and accepts changes by pull request on
GitHub and decides what is merged and released.

## License of contributions

The project is licensed under the [Apache License 2.0](LICENSE). Inbound
contributions are accepted under the same terms (Apache-2.0, section 5): by
opening a pull request you license your contribution under Apache-2.0. No
separate contributor license agreement is needed.

## Developer Certificate of Origin

Every commit in a pull request must carry a sign-off certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```text
Signed-off-by: Your Name <your.email@example.com>
```

`git commit -s` adds the line from your Git configuration. The name and address
must be your real identity. A pull request with an unsigned commit is not
merged; amend or rebase with `--signoff` to add the line.

## What belongs here

Billing Core contains rule *types*, their algorithms and the neutral FHIR
carriers, tested only with synthetic rule sets and synthetic code systems. It
ships no actual rules or rule values.

- Rule instances, fee-schedule values, GOZ or other tariff rules and court
  rulings stay in the products that own them, including a partner's own
  product. Do not contribute them here.
- Do not contribute licensed third-party content: catalog or tariff texts
  (for example GOÄ, GOZ, BEMA, BEB, BEL), SNOMED CT display texts, or any
  terminology content whose license does not allow publication.
- Do not contribute customer or patient data or identifiers of any real
  installation. Fixtures use invented codes and the `example.invalid` domain.
- The engine packages must stay free of any dependency on a cognovis SDK; CI
  refuses a manifest that declares one.

## Working on a change

Requirements: the latest Bun and the latest Node LTS (`.nvmrc`).

```sh
npm ci
npm test
npm run check:engine-manifests
```

Describe the behaviour your change adds or fixes in the pull request and add a
test that fails without it.
