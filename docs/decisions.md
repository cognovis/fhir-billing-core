# Decisions

- [ADR-001: Billing Core owns every portable rule algorithm and the reference engine](adr/ADR-001-jurisdiction-neutral-rule-contract.md) — Core owns the neutral carrier conventions, admission derivation, result contracts and the IO-free engine packages; country packages own configured instances and bindings
- [ADR-002: An edition's admission binds its definitions' prices and configured-rule membership](adr/ADR-002-member-set-digest-scheme-2.md) — scheme 2 binds definition content and configured-rule membership to tenant admission
- [ADR-003: Preserve publisher-unvalued prices and guard a conditional base](adr/ADR-003-publisher-price-scope.md) — native price markers and conjunctive fact guards keep unknown or unsupported prices unavailable
- [ADR-004: A definition prices a claim at its one matching guarded alternative](adr/ADR-004-guarded-price-alternatives.md) — guarded `propertyGroup` alternatives plus an optional base; an unknown fact leaves the price unknown, overlap fails closed
- [ADR-005: A catalog edition bound to a Contract prices that Contract's lines](adr/ADR-005-contract-bound-catalog-editions.md) — manifest `contracts` plus `depends-on` links, covered by the member-set digest; a bound edition is the only candidate for the codings it holds under its Contract
