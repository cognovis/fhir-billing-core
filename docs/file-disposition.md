# First-release file disposition

| Source concern | Core disposition | Excluded disposition |
| --- | --- | --- |
| Neutral payload-v2 canonicalization and digest | Reimplemented in `@cognovis/fhir-billing-rules`; `fixtures/payload-v2-digest.json` records a pre-extraction Polaris vector and producer commit | Legacy national payload-v1 readers remain in country integration packages |
| Generic rule algorithms | Normalized into eight Core registry entries and the pure engine | Country instances, legal values, and regime-specific applicability remain in country packages |
| Catalog and rule-set readiness | Typed admission input consumed by the engine | Acquisition, entitlement decisions, digest generation, and persistence remain in adapters |
| Evaluation result and diagnostics | One Core tri-state result and hierarchical reason vocabulary | Product action models and localized messages remain in consumers |
| Portability fixtures | Fictional identifiers under `example.invalid` | Operational catalog codes, descriptions, valuations, and customer data are prohibited |

The Core implementation is a clean jurisdiction-neutral extraction. It does not copy
source loaders, protected fixtures, national canonicals, or product orchestration.
