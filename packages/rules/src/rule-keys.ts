/**
 * The members a rule may carry, shared by `defineBillingRuleSet` and the configured-rule and rule-set
 * carrier codecs, so the typed API and the carriers refuse the same unknown keys. Internal; not exported
 * from the package root.
 */
export const BILLING_RULE_KEYS: readonly string[] = [
  'id',
  'class',
  'mustUnderstand',
  'effect',
  'priority',
  'requiredFacts',
  'parameters',
  'effectiveStart',
  'effectiveEnd',
  'provenance',
]
