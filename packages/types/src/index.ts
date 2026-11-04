export {
  type BillingCatalogDefinitionResource,
  type BillingCatalogEditionIdentifier,
  type BillingCatalogEditionPeriod,
  type BillingCatalogEditionRelatedArtifact,
  type BillingCatalogEditionResource,
  type BillingConfiguredRuleResource,
  type BillingRuleSetResource,
  type FhirParametersResource,
  type R4Meta,
  type R4Resource,
} from './generated.js'

export const BILLING_CORE_VERSION = '0.41.1' as const
export const BILLING_RULE_SEMANTIC_MAJOR = 4 as const
export const BILLING_RULE_PAYLOAD_SCHEMA_VERSION = 2 as const
export const BILLING_ARTIFACT_KIND_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/artifact-kind' as const
export const BILLING_CATALOG_DIGEST_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/catalog-digest' as const
export const BILLING_SOURCE_PUBLICATION_DIGEST_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/source-publication-digest' as const
export const BILLING_MEMBER_SET_DIGEST_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/member-set-digest' as const
export const BILLING_RULE_DIGEST_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/billing-rule-digest' as const
export const BILLING_RULE_SET_DIGEST_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/billing-rule-set-digest' as const
/**
 * A catalog edition's declaration of how its rules are carried. Its one value,
 * {@link BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE}, states that the edition's configured-rule
 * members carry every rule of the edition, one Library per rule whose `depends-on` links name the catalog
 * definition of every code the rule names in any role (selector, excluded, required), and that each
 * definition's `composed-of` entry carries {@link BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION} when
 * it has configured rules. An edition with a rule that names no explicit codes (a `"*"` or code-less
 * selector) must not declare it. An edition without a rule-set member can then be evaluated from the
 * configured rules of the billed codes. An SDK that does not know the identifier ignores it and keeps
 * such an edition `unavailable`.
 */
export const BILLING_RULE_COMPLETENESS_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/billing-rule-completeness' as const
export const BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE = 'configured-rule-per-code' as const
/**
 * Under {@link BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE}, the extension on the edition's
 * `composed-of` entry of a catalog definition that has configured rules: `valueString` is the digest
 * (`sha256:<hex>` over the canonical JSON of the sorted `url|version` list) of the configured-rule members
 * whose `depends-on` names that definition. A definition entry without it has no configured rules.
 */
export const BILLING_CONFIGURED_RULE_MEMBERS_DIGEST_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/configured-rule-members-digest' as const
/**
 * The extension on a native catalog edition's `composed-of` entry of a catalog definition: `valueString`
 * is the definition's content digest (`billingCatalogDefinitionDigest`: `sha256:<hex>` over the canonical
 * JSON of its `resourceType`, `url`, `version`, `code` and `propertyGroup`, so its prices). The edition's
 * member-set digest covers it, so the admission record that binds the edition binds every definition's
 * prices (member-set digest v2, cognovis/fhir-billing-core#165).
 */
export const BILLING_CATALOG_DEFINITION_DIGEST_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/catalog-definition-digest' as const
/**
 * The extension on a contract-bound catalog edition's `composed-of` entry of a catalog definition
 * (cognovis/fhir-billing-core#127): `valueString` is the definition's billed coding as `system|code`. The
 * member-set digest of a contract-bound edition covers it, so which codings the edition holds is decided
 * from the admitted edition alone, not from a code search a store writer could change. Absent on an unbound
 * edition.
 */
export const BILLING_CATALOG_DEFINITION_CODING_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/catalog-definition-coding' as const
export type BillingRuleCompleteness = typeof BILLING_RULE_COMPLETENESS_CONFIGURED_RULE_PER_CODE
/**
 * Admission record (`Provenance`): a tenant's admission of one catalog-edition, contract or overlay
 * rule-set Library, written by the producer that admits it at import time. `target` names exactly the
 * admitted Library; {@link BILLING_ADMISSION_TENANT_EXTENSION} names the tenant, one
 * {@link BILLING_ADMITTED_ARTIFACT_EXTENSION} per admitted artifact binds its canonical, version and
 * digest, and {@link BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION} binds the admitted configured rules of
 * an edition (record 2) by reference and digest. The SDK evaluates a native carrier only when such a
 * record binds it.
 */
export const BILLING_ADMISSION_PROFILE = 'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-admission' as const
/**
 * Admitted configured rules (`Provenance`, record 2): one shard of the configured-rule members of one
 * admitted edition, at most {@link BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE} `entity` entries sorted
 * by `url|version`, each with its configured-rule digest. The shards of an edition are disjoint and
 * contiguous in key order; the edition's admission record binds each shard's digest
 * ({@link BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION}) in shard order.
 */
export const BILLING_ADMITTED_CONFIGURED_RULES_PROFILE = 'https://fhir.cognovis.de/billing-core/StructureDefinition/billing-admitted-configured-rules' as const
/**
 * The most admitted configured rules one record-2 shard lists. With canonicals of 100 to 150 characters
 * one entity serializes to about 420 bytes, so a full shard stays near 2 MB, well under 4 MB and far
 * below a FHIR server's request limit (Aidbox: 16,000,000 bytes); an edition of 45,545 configured
 * rules takes 10 shards.
 */
export const BILLING_ADMITTED_CONFIGURED_RULES_SHARD_SIZE = 5000
/** The tenant an admission record admits for (`valueString`). */
export const BILLING_ADMISSION_TENANT_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/billing-admission-tenant' as const
/**
 * One admitted artifact (complex): `kind` (`valueCode` `catalog-edition` or `rule-set`), `canonical`
 * (`valueUri`), `version`, `digest`, `sourceSetDigest` (catalog edition only, required) and `publisher`
 * (rule set only, when its Library names one), each but `kind` and `canonical` a `valueString`.
 */
export const BILLING_ADMITTED_ARTIFACT_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/billing-admitted-artifact' as const
/**
 * One record-2 shard of an edition's admitted configured rules (complex): `reference` (`valueReference`
 * to the shard) and `digest` (`valueString`, the shard's configured-rules digest). Record 1 carries one
 * per shard, in shard order.
 */
export const BILLING_ADMITTED_CONFIGURED_RULES_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/billing-admitted-configured-rules' as const
/** The configured-rule digest of one admitted configured rule, on its record-2 `entity` (`valueString`). */
export const BILLING_ADMITTED_DIGEST_EXTENSION = 'https://fhir.cognovis.de/billing-core/extension/billing-admitted-digest' as const
/** The identifier system of an admitted configured rule in record 2; the value is its `url|version`. */
export const BILLING_ADMITTED_CONFIGURED_RULE_SYSTEM = 'https://fhir.cognovis.de/billing-core/sid/admitted-configured-rule' as const

/** The kind of an admitted artifact. */
export type BillingAdmittedArtifactKind = 'catalog-edition' | 'rule-set'

/**
 * One artifact an admission record binds. A catalog edition binds its member-set digest as `digest`
 * and its source-set digest as `sourceSetDigest`. A rule set binds its rule-set digest as `digest`
 * and, when its Library names one, its `publisher`.
 */
export interface BillingAdmittedArtifact {
  readonly kind: BillingAdmittedArtifactKind
  readonly canonical: string
  readonly version: string
  readonly digest: string
  readonly sourceSetDigest?: string
  readonly publisher?: string
}

/** One admitted configured rule: its `url|version` and its configured-rule digest. */
export interface BillingAdmittedConfiguredRule {
  readonly key: string
  readonly digest: string
}

export const BILLING_CATALOG_EDITION_MIME = 'application/json' as const
export const BILLING_CONFIGURED_RULE_MIME = 'application/json' as const
export const BILLING_RULE_SET_MIME = 'application/json' as const

export type BillingOutcome = 'accepted' | 'rejected' | 'needs-review'
export type SourceAvailability = 'available' | 'missing' | 'expired'
export type SourceCompleteness = 'complete' | 'partial' | 'unknown'
export type PrecisionMode = 'exact-decimal'
export type OrderingMode = 'priority-then-id'

export interface Coding {
  system: string
  code: string
  display?: string
  version?: string
}

export interface Money {
  value: string
  currency: string
}

export interface EditionAdmission {
  edition: string
  digest: string
  availability: SourceAvailability
  completeness: SourceCompleteness
  entitled: boolean
  compatible: boolean
  digestMatches: boolean
  effectiveStart?: string
  effectiveEnd?: string
}

export interface AdmissionState {
  status: 'admitted' | 'needs-review'
  catalog: EditionAdmission
  ruleSet: EditionAdmission
}

export type GenericRuleClass =
  | 'quantity-limit'
  | 'value-limit'
  | 'mutual-exclusion'
  | 'companion-required'
  | 'bounded-multiplier'
  | 'accompanying-information-required'
  | 'patient-attribute-constraint'
  | 'contract-participation'
  | 'contract-code-list'
  | 'setting-constraint'
  | 'prior-authorization-required'
  | 'procedure-finding-requirement'
  | 'diagnosis-requirement'
  | 'provider-eligibility'
  | 'quota-degression'
  | 'minimum-evidence-count'

export type BillingRuleEffect = 'reject' | 'needs-review'

export type BillingFactState = 'known' | 'known-absent' | 'not-supplied' | 'source-unavailable'

/**
 * Why a `source-unavailable` fact could not be stated, where Billing Core names the cause. The
 * resolution of a `valueAs: 'group-member'` fact from a Practitioner performer names one
 * (cognovis/fhir-billing-core#134): `account-owner-missing` (the Account names no literal `owner`
 * Organization), `role-missing` (no usable PractitionerRole of the Practitioner at that owner) and
 * `ambiguous-role` (the roles at the owner do not resolve to one set of entries).
 * Billing performer selection also names missing, ambiguous and invalid assignments on
 * provider qualifications and declared performer/performer-role facts (including group-member facts).
 */
export const BILLING_FACT_UNAVAILABLE_CAUSES = ['account-owner-missing', 'role-missing', 'ambiguous-role', 'missing-billing-performer', 'ambiguous-billing-performer', 'invalid-billing-performer'] as const

export type BillingFactUnavailableCause = (typeof BILLING_FACT_UNAVAILABLE_CAUSES)[number]

export interface BillingFact {
  kind: 'billing-fact'
  state: BillingFactState
  value?: unknown
  /**
   * Why the fact is unavailable; only in state `source-unavailable`, and only when Core names a cause.
   * The engine copies it into the `PROVIDER_ELIGIBILITY_INDETERMINATE` finding details as `cause`.
   */
  cause?: BillingFactUnavailableCause
}

export type BillingFactValue =
  | BillingFact
  | string
  | number
  | boolean
  | null
  | readonly BillingFactValue[]
  | { readonly [key: string]: BillingFactValue }

export interface BillingCountingScope {
  window: string
  subject: string
}

export interface BillingCountingWindow {
  scope: BillingCountingScope
  lineIds: readonly string[]
}

export interface BillingRuleException {
  fact: string
  valueIn: readonly (string | number | boolean | null)[]
}

export type BillingAgreementOverride = BillingRuleException

/** The kinds of source a rule's provenance may cite, in the order Core documents them. */
export const BILLING_RULE_SOURCE_KINDS = [
  'statute',
  'fee-schedule',
  'contract',
  'court-decision',
  'authority-statement',
  'commentary',
  'author-assessment',
] as const

export type BillingRuleSourceKind = (typeof BILLING_RULE_SOURCE_KINDS)[number]

/**
 * One source a rule rests on. A `court-decision` names court, file number and decision date in
 * `citation`; `codes` lists the fee numbers the source concerns, when it concerns only some.
 */
export interface BillingRuleSource {
  readonly kind: BillingRuleSourceKind
  readonly citation: string
  readonly uri?: string
  readonly codes?: readonly string[]
}

/**
 * Where a rule comes from and how strong its basis is. `evidenceLevel` is a coding whose system the
 * rule-set author chooses; Core fixes no scale. Provenance is covered by the rule-set digest and never
 * changes evaluation.
 */
export interface BillingRuleProvenance {
  readonly sources: readonly BillingRuleSource[]
  readonly evidenceLevel: Coding
  readonly note?: string
}

export interface BillingRule {
  id: string
  class: GenericRuleClass | (string & {})
  mustUnderstand: boolean
  effect: BillingRuleEffect
  priority: number
  requiredFacts?: readonly string[]
  parameters: Record<string, unknown>
  effectiveStart?: string
  effectiveEnd?: string
  provenance?: BillingRuleProvenance
}

/**
 * The facts the SDK reads from generic FHIR R4 resources itself, without a declaration. A rule names
 * one of them as its fact; the README lists the FHIR element each comes from.
 */
export const BILLING_NATIVE_FACT_NAMES = [
  'patient.age',
  'patient.gender',
  'encounter.class',
  'diagnoses',
  'provider.qualifications',
] as const

export type BillingNativeFactName = (typeof BILLING_NATIVE_FACT_NAMES)[number]

/**
 * The resources a fact-source declaration may start from: the Account's Patient, the selected
 * Coverage, the Account, the line's Encounter (`ChargeItem.context`), the line's billing doctor as a
 * Practitioner (`performer`: the `ChargeItem.performer.actor` Practitioner, or the `practitioner` of a
 * PractitionerRole actor) and the PractitionerRole actor itself (`performer-role`).
 */
export const BILLING_FACT_SOURCE_ORIGINS = ['patient', 'coverage', 'account', 'encounter', 'performer', 'performer-role'] as const

export type BillingFactSourceOrigin = (typeof BILLING_FACT_SOURCE_ORIGINS)[number]

/**
 * Where a jurisdiction-specific fact is read, shipped in the rule set and covered by its digest, so
 * Core names no jurisdiction's canonical. `path` is a restricted path from the `from` resource:
 * dot-separated element names, `extension('<url>')` steps, and a final `coding('<system>')` filter.
 * `valueAs` (default `code`) shapes each value reached; `perBilledCode` makes the fact a boolean per
 * line, true when a reached coding's code equals the line's billed code. A path that reaches nothing
 * leaves the fact `source-unavailable`, or `known-absent` when `absent` says so. Path steps read own
 * JSON members only; `coding`, `extension` and `Object.prototype` member names are refused as names.
 *
 * `valueAs: 'group-member'` (only on `from: 'performer-role'`, and only with `groupPath`) yields
 * `provider-eligibility` entries `{ group, member }` from one PractitionerRole. Both paths end in
 * `coding('<system>')`; every coding reached before that filter (a CodeableConcept's codings or a bare
 * Coding) is examined, and a system or code is readable only as a string that is non-empty after
 * trimming and equal to its trimmed form. A coding with an unreadable system, or of the declared system
 * with an unreadable code, leaves the fact `source-unavailable`; codings of another readable system are
 * ignored. `groupPath` must reach exactly one coding of its system (two or more, identical or not, are
 * `source-unavailable`), whose `<system>|<code>` is the group; `path` must reach at least one, one entry
 * per distinct code. The form refuses `absent` and `perBilledCode`.
 *
 * A PractitionerRole performer is that one role (0.26.0). A Practitioner performer, valid on the
 * service date, resolves to its PractitionerRoles at the Account's owner (cognovis/fhir-billing-core#134):
 * `Account.owner` must be a literal relative `Organization/<id>`, else the fact is `source-unavailable`
 * with cause `account-owner-missing` and no fallback. The SDK searches PractitionerRole by `practitioner`
 * and `organization` (every page, receipted, every returned role kept as evidence). A returned role counts
 * only when its `practitioner` is the performer and its `organization` the owner. A candidate is such a
 * role that is not `active: false`, whose `period` covers the service point, that carries exactly one
 * coding of the `groupPath` system and whose entries are readable as above. A counted role whose
 * candidacy or entries cannot be read (modifier extension or implicit rules, a period indeterminate on
 * the service date, an unreadable `groupPath` coding, unreadable or missing member codings) is unusable.
 * When every candidate yields the same set of `(group, member)` pairs, that set is the fact; different
 * sets, or an unusable role beside a candidate, are `source-unavailable` with cause `ambiguous-role`; no
 * candidate is `source-unavailable` with cause `role-missing`. The cause reaches the
 * `PROVIDER_ELIGIBILITY_INDETERMINATE` finding details (see {@link BillingFact.cause}).
 */
export interface BillingFactSourceDeclaration {
  readonly fact: string
  readonly from: BillingFactSourceOrigin
  readonly path: string
  readonly valueAs?: 'code' | 'system|code' | 'boolean-present' | 'group-member'
  /** The path to the group coding of a `valueAs: 'group-member'` declaration; present exactly then. */
  readonly groupPath?: string
  readonly perBilledCode?: { readonly system?: string }
  readonly absent?: 'known-absent'
}

export interface BillingRuleSet {
  schemaVersion: 2
  semanticMajor: 4
  id: string
  rules: readonly BillingRule[]
  /** Fact-source declarations of the rule set's jurisdiction-specific facts; covered by its digest. */
  factSources?: readonly BillingFactSourceDeclaration[]
  /**
   * The Contracts a contract rule set, or the catalog editions an overlay rule set, applies to; covered
   * by its digest. Present only on a contract or an overlay rule set, whose Library names the same
   * canonicals as `depends-on` related artifacts.
   */
  appliesTo?: BillingRuleSetAppliesTo
}

/**
 * What a bound rule set applies to: exactly one of the two members.
 *
 * - `contracts` (contract rule set): a non-empty list of unique Contract canonicals, each a
 *   `Contract.url` or `Contract.instantiatesUri` value, optionally `|version` (the `Contract.version`).
 * - `catalogEditions` (overlay rule set): a non-empty list of unique catalog-edition canonicals, each a
 *   catalog-edition Library `url`, optionally `|version`, whose lines the overlay checks beside the
 *   edition's own rule set.
 */
export type BillingRuleSetAppliesTo =
  | { readonly contracts: readonly string[]; readonly catalogEditions?: never }
  | { readonly catalogEditions: readonly string[]; readonly contracts?: never }

export interface BillingCatalogSource {
  readonly sourceUri: string
  readonly sourceVersion: string
  readonly sourceDigest: `sha256:${string}`
  readonly retrievedAt: string
  readonly producerVersion: string
  readonly completeness: SourceCompleteness
}

export interface BillingCatalogEditionManifestV1 {
  readonly schemaVersion: 1
  readonly kind: 'billing-catalog-edition'
  readonly catalogScope: string
  readonly publicationPeriod: { readonly start: string; readonly end?: string }
  readonly sources: readonly BillingCatalogSource[]
  /**
   * The Contracts a contract-bound edition applies to (cognovis/fhir-billing-core#127): a non-empty list
   * of unique Contract canonicals, each a `Contract.url` or `Contract.instantiatesUri` value, optionally
   * `|version` (the `Contract.version`). The edition Library carries one `depends-on` link per Contract and
   * no other, and the member-set digest covers the list, so the admission record binds the assignment.
   * Absent on an unbound edition, whose member-set digest is unchanged.
   */
  readonly contracts?: readonly string[]
}

export interface BillingConfiguredRulePayloadV2 {
  readonly schemaVersion: 2
  readonly semanticMajor: 4
  readonly rule: BillingRule
  /**
   * The fact-source declarations of the facts the rule names, validated as a rule set's and covered by
   * the configured-rule digest. A payload without them keeps the digest it had before the member existed.
   */
  readonly factSources?: readonly BillingFactSourceDeclaration[]
}

/** Byte-compatible neutral payload schema published before the Core extraction. */
export interface BillingRulePayloadV2 {
  schemaVersion: 2
  rules: readonly {
    id: string
    class: string
    effect: string
    requiredFacts?: readonly string[]
    parameters: Readonly<Record<string, unknown>>
  }[]
  coverage?: {
    codeCompleteness: Readonly<Record<string, SourceCompleteness>>
    declarations?: readonly {
      system?: string
      code: string
      completeness: SourceCompleteness
      unsupportedFamilies?: readonly string[]
    }[]
  }
  /**
   * The rule set's fact-source declarations. Canonical JSON drops an absent or `undefined` member, so
   * the digest of a rule set without declarations is unchanged.
   */
  factSources?: readonly BillingFactSourceDeclaration[] | undefined
  /** A contract rule set's Contract binding; absent on every other rule set, so its digest is unchanged. */
  appliesTo?: BillingRuleSetAppliesTo | undefined
}

export interface BillingLine {
  id: string
  code: Coding
  quantity: number
  /**
   * The line's unit price. Absent exactly when `unitPriceUnknown` is `true`: a line carries either a
   * unit price or the unknown marker, never both and never neither.
   */
  unitPrice?: Money
  /**
   * `true` when the line's unit price is unknown, for example because its catalog definition carries
   * points but no amount. The amount is unknown, not zero: only `value-limit` reads a price, and it
   * leaves such a line undecided with `UNIT_PRICE_UNAVAILABLE`.
   */
  unitPriceUnknown?: true
  actualMultiplier?: number
  /** @deprecated Use actualMultiplier. Retained for 0.1.x wire compatibility. */
  multiplier?: number
  /**
   * True when the line carries a written justification for a multiplier above the standard
   * threshold. Only the presence is projected; the justification text never enters the engine.
   */
  multiplierJustified?: boolean
  modifiers?: readonly string[]
  annotations?: readonly string[]
  /**
   * Facts that hold for this line only, such as the patient's age on its service date or its
   * Encounter's diagnoses. The line-scoped classes (`patient-attribute-constraint`,
   * `setting-constraint`, `prior-authorization-required`, `diagnosis-requirement`,
   * `provider-eligibility`, `accompanying-information-required`) read a fact the line names here
   * before the case fact; every other read stays case-wide.
   */
  facts?: Readonly<Record<string, BillingFactValue>>
  /**
   * The line's own accompanying information. When present, `accompanying-information-required` reads
   * its fact from here alone for this line: a name it lacks is not supplied, so the rule is
   * unavailable for the line, whatever the case or another line states.
   */
  information?: Readonly<Record<string, BillingFactValue>>
}

export interface BillingCase {
  id: string
  asOf: string
  lines: readonly BillingLine[]
  facts: Readonly<Record<string, BillingFactValue>>
  countingWindows?: readonly BillingCountingWindow[]
  contracts?: readonly string[]
}

export const BILLING_REASON_CODES = [
  'ELIGIBLE',
  'CATALOG_PARTIAL',
  'ACCOUNT_OWNER_PRACTICE_DIFFERS',
  'RULE_REJECTED',
  'ADMISSION_INCOMPLETE',
  'EDITION_UNAVAILABLE',
  'EDITION_UNENTITLED',
  'EDITION_EXPIRED',
  'EDITION_INCOMPATIBLE',
  'DIGEST_MISMATCH',
  'UNSUPPORTED_RULE',
  'REQUIRED_FACT_UNAVAILABLE',
  'RULE_EXCEPTION_UNAVAILABLE',
  'COUNTING_SCOPE_UNAVAILABLE',
  'ACTUAL_MULTIPLIER_UNAVAILABLE',
  'UNIT_PRICE_UNAVAILABLE',
  'AGREEMENT_OVERRIDE_UNAVAILABLE',
  'QUANTITY_CAP_EXCEEDED',
  'VALUE_CAP_APPLICABLE',
  'MUTUALLY_EXCLUSIVE_CODE_PRESENT',
  'COMPANION_CODE_REQUIRED',
  'MULTIPLIER_OUT_OF_BOUNDS',
  'MULTIPLIER_THRESHOLD_EXCEEDED',
  'MULTIPLIER_JUSTIFICATION_REQUIRED',
  'ACCOMPANYING_INFORMATION_REQUIRED',
  'PATIENT_ATTRIBUTE_MISMATCH',
  'CONTRACT_PARTICIPATION_REQUIRED',
  'SETTING_NOT_PERMITTED',
  'SETTING_INDETERMINATE',
  'PRIOR_AUTHORIZATION_REQUIRED',
  'PRIOR_AUTHORIZATION_INDETERMINATE',
  'PROCEDURE_FINDING_NOT_SATISFIED',
  'PROCEDURE_FINDING_INDETERMINATE',
  'DIAGNOSIS_NOT_SATISFIED',
  'DIAGNOSIS_INDETERMINATE',
  'PROVIDER_NOT_ELIGIBLE',
  'PROVIDER_ELIGIBILITY_INDETERMINATE',
  'QUOTA_DEGRESSION_APPLICABLE',
  'QUOTA_DEGRESSION_INDETERMINATE',
  'QUOTA_PARAMETER_UNAVAILABLE',
  'PATIENT_ATTRIBUTE_INDETERMINATE',
  'PATIENT_ATTRIBUTE_UNIT_UNAVAILABLE',
  'ACCOMPANYING_INFORMATION_INDETERMINATE',
  'MINIMUM_EVIDENCE_NOT_MET',
  'MINIMUM_EVIDENCE_INDETERMINATE',
  'CONTRACT_CODE_NOT_PERMITTED',
] as const

export type BillingReasonCode = (typeof BILLING_REASON_CODES)[number]

/**
 * A coding a reason resolution names. `lineId` identifies the present line that carries it; on a
 * `MUTUALLY_EXCLUSIVE_CODE_PRESENT` reason a `lineId` equal to the reason's own `lineId` means that line
 * matches the `excluded` selector itself, so removing it is the only fix that resolves the reason. `qualifiers` is set only on an `add-one-of`
 * code whose admissible member declares qualifiers: the code satisfies the rule with one of the listed
 * values for every listed qualifier.
 */
export interface BillingResolutionCode {
  readonly system?: string
  readonly code: string
  readonly lineId?: string
  readonly qualifiers?: Readonly<Record<string, readonly (string | number | boolean | null)[]>>
}

/**
 * The codes that would resolve a block reason: `add-one-of` means any one of `codes` satisfies the rule,
 * `remove` means the listed present codes caused, or may have caused, the block. Codes are unique and keep
 * their first position. It informs a UI and never changes a decision.
 */
export interface BillingReasonResolution {
  readonly action: 'add-one-of' | 'remove'
  readonly codes: readonly BillingResolutionCode[]
}

export interface BillingReason {
  code: BillingReasonCode
  ruleId?: string
  lineId?: string
  details?: Readonly<Record<string, string | number | boolean>>
  /**
   * Present only on COMPANION_CODE_REQUIRED, MUTUALLY_EXCLUSIVE_CODE_PRESENT, DIAGNOSIS_NOT_SATISFIED and
   * PROCEDURE_FINDING_NOT_SATISFIED from a rule with effect `reject`; never on a `needs-review` finding.
   */
  resolution?: BillingReasonResolution
  /** The producing rule's provenance sources, as the rule states them; present only when the rule has provenance. */
  sources?: readonly BillingRuleSource[]
  /** The producing rule's evidence level; present only when the rule has provenance. */
  evidenceLevel?: Coding
}

export interface BillingResult {
  outcome: BillingOutcome
  reason: BillingReason
  axisReasons: readonly BillingReason[]
  /**
   * Advisories that never change the outcome. `CATALOG_PARTIAL` is present on an `accepted` or
   * `rejected` result when the admitted catalog or rule-set edition is partial; absent otherwise.
   */
  advisories?: readonly BillingReason[]
  evaluatedRuleIds: readonly string[]
  engineVersion: typeof BILLING_CORE_VERSION
}

export interface CompiledRuleSet {
  id: string
  admission: AdmissionState
  rules: readonly BillingRule[]
  withheldReasons: readonly BillingReason[]
  ignoredRuleIds: readonly string[]
}

/** Line format of a standalone conformance record; one canonical JSON record per line. */
export const BILLING_CONFORMANCE_FORMAT = 'fhir-billing-conformance/1' as const

/** Record-format code for a case the engine cannot read; it is not a `BillingReasonCode`. */
export const BILLING_CONFORMANCE_INPUT_INVALID = 'BILLING_INPUT_INVALID' as const

export type BillingConformanceDecision = 'allow' | 'block' | 'unavailable'

export interface BillingConformanceFinding {
  code: BillingReasonCode | typeof BILLING_CONFORMANCE_INPUT_INVALID
  ruleId?: string
  lineId?: string
  effect: BillingRuleEffect
  details?: Readonly<Record<string, string | number | boolean>>
  /** The reason's resolution, unchanged; comparison ignores it. */
  resolution?: BillingReasonResolution
  /** The producing rule's provenance sources and evidence level, unchanged; comparison ignores them. */
  sources?: readonly BillingRuleSource[]
  evidenceLevel?: Coding
}

export interface BillingConformanceRuleSetIdentity {
  id: string
  digest: string
  /** Library.url and Library.version, present only when the rule set was given as a rule-set Library. */
  canonical?: string
  version?: string
  /** Library.publisher of a rule-set Library that names one; comparison ignores it. */
  publisher?: string
}

/**
 * One case evaluated against one rule set without a tenant, a catalog edition or a FHIR server.
 * `mode: 'standalone'` marks it as a conformance result, never an admitted production verdict.
 */
export interface BillingConformanceRecord {
  format: typeof BILLING_CONFORMANCE_FORMAT
  mode: 'standalone'
  caseId: string
  decision: BillingConformanceDecision
  ruleSet: BillingConformanceRuleSetIdentity
  engineVersion: typeof BILLING_CORE_VERSION
  /** Rules of an unsupported class without mustUnderstand that the engine skipped; sorted, absent when none. */
  ignoredRuleIds?: readonly string[]
  advisories?: readonly BillingReason[]
  findings: readonly BillingConformanceFinding[]
}

/** A blocking pair is a finding with effect `reject`, identified by its line and rule. */
export interface BillingConformanceBlockingPair {
  lineId?: string
  ruleId?: string
}

export interface BillingConformanceSide {
  decision: BillingConformanceDecision
  blocking: readonly BillingConformanceBlockingPair[]
}

export type BillingConformanceDifference =
  | { kind: 'disagree'; caseId: string; differs: readonly ('decision' | 'blocking')[]; left: BillingConformanceSide; right: BillingConformanceSide }
  | { kind: 'left-only'; caseId: string; left: BillingConformanceSide }
  | { kind: 'right-only'; caseId: string; right: BillingConformanceSide }

export interface OracleFixture {
  id: string
  admission: AdmissionState
  ruleSet: BillingRuleSet
  case: BillingCase
  expectedOutcome: BillingOutcome
  expectedReason: BillingReasonCode
  expectedAxisReasons: readonly BillingReasonCode[]
}

export interface FhirParameters {
  resourceType: 'Parameters'
  id: string
  meta?: { profile?: readonly string[] }
  parameter: Array<
    | { name: string; valueString: string }
    | { name: string; valueCode: BillingOutcome }
    | { name: string; valueCoding: Coding }
    | { name: string; resource: Record<string, unknown> }
  >
}
