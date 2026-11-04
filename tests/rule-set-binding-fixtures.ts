/**
 * Synthetic fixtures of the rule-set binding carrier tests: a fee schedule rule set, a contract rule set
 * bound to synthetic Contracts (cognovis/fhir-billing-core#46) and an overlay rule set bound to a synthetic
 * catalog edition (cognovis/fhir-billing-core#47). Every Contract, edition, code system, publisher and rule
 * is synthetic. The case and edition fixtures of the SDK tests are with the SDK in cognovis/chp.
 */
import { buildBillingLibrary } from '@cognovis/fhir-billing-rules'
import type { BillingRule, BillingRuleSet, BillingRuleSetAppliesTo } from '@cognovis/fhir-billing-types'

export const SYNTHETIC_YEAR = { start: '2026-01-01', end: '2026-12-31' } as const
export const SYSTEM = 'https://example.invalid/CodeSystem/synthetic-contract-service'
export const SECOND_SYSTEM = 'https://example.invalid/CodeSystem/synthetic-contract-second-service'
export const SELECTIVE = 'https://example.invalid/Contract/synthetic-selective-contract'
export const OTHER = 'https://example.invalid/Contract/synthetic-other-contract'
export const FEE_RULES_URL = 'https://example.invalid/Library/synthetic-fee-rules'
export const CONTRACT_RULES_URL = 'https://example.invalid/Library/synthetic-selective-rules'
export const CONTRACT_RULES_ID = 'synthetic-selective-rules'
export const RULES_VERSION = '2026.1'
export const AS_OF = '2026-06-15'

const CODES = ['K-1', 'K-2'] as const

/** A native rule-set Library carrier for the synthetic year. */
export function nativeRuleSetLibrary(input: { id: string; url: string; version: string; payload: BillingRuleSet; publisher?: string }): Record<string, unknown> {
  return { ...buildBillingLibrary({ kind: 'rule-set', id: input.id, url: input.url, version: input.version, status: 'active', effectivePeriod: { ...SYNTHETIC_YEAR }, publisher: input.publisher ?? 'Synthetic Rule Authority', payload: input.payload, relatedArtifacts: [] }) }
}

/** The fee schedule's rule set: at most three of each code. */
export function feeRuleSet(): BillingRuleSet {
  return {
    schemaVersion: 2,
    semanticMajor: 4,
    id: 'synthetic-fee-rules',
    rules: [{ id: 'fee-limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { system: SYSTEM, codes: [...CODES] }, maximum: 3 } }],
  }
}

/** The selective contract does not permit K-2. */
export const EXCLUDES_K2: BillingRule = { id: 'selective-excludes-k2', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { system: SYSTEM, codes: ['K-2'] }, maximum: 0 } }

/** The contract rule set's payload; by default the selective contract does not permit K-2. */
export function contractPayload(contracts: readonly string[] = [SELECTIVE], rules: readonly BillingRule[] = [EXCLUDES_K2]): BillingRuleSet {
  return { schemaVersion: 2, semanticMajor: 4, id: CONTRACT_RULES_ID, appliesTo: { contracts: [...contracts] }, rules: [...rules] }
}

/** The contract rule-set Library: one depends-on link per bound Contract. */
export function contractRuleSet(options: { contracts?: readonly string[] } = {}): Record<string, unknown> {
  const contracts = options.contracts ?? [SELECTIVE]
  return {
    ...buildBillingLibrary({
      kind: 'rule-set',
      id: CONTRACT_RULES_ID,
      url: CONTRACT_RULES_URL,
      version: RULES_VERSION,
      status: 'active',
      effectivePeriod: { ...SYNTHETIC_YEAR },
      publisher: 'Synthetic Contract Partner',
      payload: contractPayload(contracts),
      relatedArtifacts: contracts.map((resource) => ({ type: 'depends-on' as const, resource })),
    }),
  }
}

export const DENTAL_SYSTEM = 'https://example.invalid/CodeSystem/synthetic-dental-service'
export const DENTAL_EDITION_URL = 'https://example.invalid/Library/synthetic-dental-edition'
export const OVERLAY_URL = 'https://example.invalid/Library/synthetic-practice-check'
export const OVERLAY_ID = 'synthetic-practice-check'
export const OVERLAY_VERSION = '2026.1'
export const OVERLAY_PUBLISHER = 'Synthetic Dental Practice'
export const EVIDENCE_SYSTEM = 'https://example.invalid/CodeSystem/synthetic-evidence-level'

/** The practice's own check: D-2 is never billed without the practice's review. */
export const PRACTICE_D2: BillingRule = {
  id: 'practice-d2-review',
  class: 'quantity-limit',
  mustUnderstand: true,
  effect: 'reject',
  priority: 1,
  parameters: { selector: { system: DENTAL_SYSTEM, codes: ['D-2'] }, maximum: 0 },
  provenance: {
    sources: [{ kind: 'fee-schedule', citation: 'Synthetic dental fee schedule 2026, section 4', codes: ['D-2'] }],
    evidenceLevel: { system: EVIDENCE_SYSTEM, code: 'practice-policy', display: 'Practice policy' },
  },
}

export function overlayContent(options: { catalogEditions?: readonly string[]; contracts?: readonly string[]; rules?: readonly BillingRule[] } = {}): BillingRuleSet {
  const catalogEditions = options.catalogEditions ?? [DENTAL_EDITION_URL]
  return {
    schemaVersion: 2,
    semanticMajor: 4,
    id: OVERLAY_ID,
    // A test may name both members to check that the codec refuses them.
    appliesTo: {
      ...(options.contracts !== undefined ? { contracts: [...options.contracts] } : {}),
      catalogEditions: [...catalogEditions],
    } as unknown as BillingRuleSetAppliesTo,
    rules: [...(options.rules ?? [PRACTICE_D2])],
  }
}

/** The overlay rule-set Library: a native rule set bound to the dental edition by payload and link. */
export function overlayRuleSet(): Record<string, unknown> {
  return {
    ...buildBillingLibrary({
      kind: 'rule-set',
      id: OVERLAY_ID,
      url: OVERLAY_URL,
      version: OVERLAY_VERSION,
      status: 'active',
      effectivePeriod: { ...SYNTHETIC_YEAR },
      publisher: OVERLAY_PUBLISHER,
      payload: overlayContent(),
      relatedArtifacts: [{ type: 'depends-on' as const, resource: DENTAL_EDITION_URL }],
    }),
  }
}
