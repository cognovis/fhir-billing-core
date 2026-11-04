/**
 * The overlay rule-set carrier (cognovis/fhir-billing-core#47): a third party's rule set bound to the
 * catalog edition it applies to. Evaluating an overlay beside the fee schedule's rule set is tested with
 * the SDK in cognovis/chp (fhir-foundation/packages/fhir-billing-sdk). Every edition, code system,
 * publisher and rule is synthetic.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BillingRuleSetAppliesTo } from '@cognovis/fhir-billing-types'
import { billingRuleSetDigest, buildBillingLibrary, decodeBillingLibrary } from '@cognovis/fhir-billing-rules'
import { DENTAL_EDITION_URL, OVERLAY_ID, OVERLAY_PUBLISHER, OVERLAY_URL, OVERLAY_VERSION, overlayContent, overlayRuleSet, SYNTHETIC_YEAR } from './rule-set-binding-fixtures.js'

describe('overlay rule-set carrier', () => {
  it('binds an overlay to its edition in the digest-covered content and in a depends-on link', () => {
    const decoded = decodeBillingLibrary(overlayRuleSet())
    assert.equal(decoded.kind, 'rule-set')
    if (decoded.kind !== 'rule-set') return
    assert.deepEqual(decoded.payload.appliesTo, { catalogEditions: [DENTAL_EDITION_URL] })
    assert.deepEqual(decoded.relatedArtifacts, [{ type: 'depends-on', resource: DENTAL_EDITION_URL }])
    // The binding is covered by the payload digest.
    const { appliesTo: _appliesTo, ...unbound } = decoded.payload
    assert.notEqual(billingRuleSetDigest(decoded.payload), billingRuleSetDigest(unbound))
  })

  it('refuses a link that names another edition than the payload, and a rule set bound to Contracts and editions', () => {
    const build = (payload: ReturnType<typeof overlayContent>, links: readonly string[]) => buildBillingLibrary({
      kind: 'rule-set',
      id: OVERLAY_ID,
      url: OVERLAY_URL,
      version: OVERLAY_VERSION,
      status: 'active',
      effectivePeriod: { ...SYNTHETIC_YEAR },
      publisher: OVERLAY_PUBLISHER,
      payload,
      relatedArtifacts: links.map((resource) => ({ type: 'depends-on' as const, resource })),
    })
    assert.throws(() => build(overlayContent(), ['https://example.invalid/Library/synthetic-other-edition']), { code: 'BILLING_INPUT_INVALID' })
    assert.throws(() => build(overlayContent(), []), { code: 'BILLING_INPUT_INVALID' })
    const contract = 'https://example.invalid/Contract/synthetic-overlay-contract'
    assert.throws(
      () => build(overlayContent({ contracts: [contract] }), [contract, DENTAL_EDITION_URL]),
      { code: 'BILLING_INPUT_INVALID', message: /both/i },
    )
    assert.throws(() => build(overlayContent({ catalogEditions: [] }), []), { code: 'BILLING_INPUT_INVALID' })
  })

  it('R7: types appliesTo as Contracts or catalog editions, never both', () => {
    // @ts-expect-error A rule set binds Contracts or catalog editions, never both.
    const both: BillingRuleSetAppliesTo = { contracts: ['https://example.invalid/Contract/synthetic-overlay-contract'], catalogEditions: [DENTAL_EDITION_URL] }
    assert.ok(both)
  })
})
