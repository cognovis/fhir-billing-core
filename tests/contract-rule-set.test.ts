/**
 * The contract binding on the rule-set carrier (cognovis/fhir-billing-core#46): a contract rule set names
 * the Contracts it applies to in its digest-covered payload and in one depends-on link each. The selection
 * of contract rule sets for a Schein is tested with the SDK in cognovis/chp
 * (fhir-foundation/packages/fhir-billing-sdk). Every Contract, code system and rule is synthetic.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { BILLING_RULE_SET_DIGEST_SYSTEM } from '@cognovis/fhir-billing-types'
import { billingRulePayloadDigest, billingRuleSetDigest, buildBillingLibrary, decodeBillingLibrary, decodeBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { CONTRACT_RULES_URL, contractPayload, contractRuleSet, FEE_RULES_URL, feeRuleSet, nativeRuleSetLibrary, OTHER, RULES_VERSION, SELECTIVE } from './rule-set-binding-fixtures.js'

describe('the contract binding on the rule-set carrier', () => {
  it('builds and decodes a contract rule set with one depends-on link per appliesTo Contract', () => {
    const decoded = decodeBillingLibrary(contractRuleSet({ contracts: [SELECTIVE, `${OTHER}|7`] }))
    assert.equal(decoded.kind, 'rule-set')
    assert.deepEqual(decoded.relatedArtifacts, [{ type: 'depends-on', resource: SELECTIVE }, { type: 'depends-on', resource: `${OTHER}|7` }])
  })

  it('refuses a link without appliesTo, appliesTo without its link, another link type and duplicates', () => {
    const plain = nativeRuleSetLibrary({ id: 'plain', url: FEE_RULES_URL, version: RULES_VERSION, payload: feeRuleSet() })
    assert.throws(() => decodeBillingLibrary({ ...plain, relatedArtifact: [{ type: 'depends-on', resource: SELECTIVE }] }), /appliesTo/)
    const bound = contractRuleSet()
    const { relatedArtifact: _links, ...unlinked } = bound
    assert.throws(() => decodeBillingLibrary(unlinked), /appliesTo/)
    assert.throws(() => decodeBillingLibrary({ ...bound, relatedArtifact: [{ type: 'composed-of', resource: SELECTIVE }] }), /depends-on/)
    assert.throws(() => decodeBillingLibrary({ ...bound, relatedArtifact: [{ type: 'depends-on', resource: SELECTIVE }, { type: 'depends-on', resource: SELECTIVE }] }), /once/)
    assert.throws(() => buildBillingLibrary({ kind: 'rule-set', id: 'x', url: CONTRACT_RULES_URL, version: '1', status: 'active', publisher: 'p', payload: contractPayload(), relatedArtifacts: [{ type: 'depends-on', resource: OTHER }] }), /appliesTo/)
  })

  it('refuses an empty, duplicate or non-canonical appliesTo and unknown members', () => {
    assert.throws(() => decodeBillingRuleSet({ ...contractPayload(), appliesTo: { contracts: [] } }), /non-empty/)
    assert.throws(() => decodeBillingRuleSet({ ...contractPayload(), appliesTo: { contracts: [SELECTIVE, SELECTIVE] } }), /unique/)
    assert.throws(() => decodeBillingRuleSet({ ...contractPayload(), appliesTo: { contracts: ['not a canonical'] } }), /canonical/)
    assert.throws(() => decodeBillingRuleSet({ ...contractPayload(), appliesTo: { contracts: [SELECTIVE], extra: true } }), /extra/)
  })

  it('covers appliesTo by the digest and leaves every digest without it unchanged', () => {
    const payload = contractPayload()
    assert.notEqual(billingRuleSetDigest(payload), billingRuleSetDigest(contractPayload([OTHER])))
    const { appliesTo: _appliesTo, ...unbound } = payload
    assert.equal(billingRuleSetDigest(unbound), billingRulePayloadDigest({ schemaVersion: 2, rules: unbound.rules }))
    // The checked-in synthetic dental rule set keeps its published digest.
    const library = JSON.parse(readFileSync('fixtures/standalone/rule-set.json', 'utf8')) as Record<string, unknown>
    const declared = (library.identifier as { system: string; value: string }[]).find((item) => item.system === BILLING_RULE_SET_DIGEST_SYSTEM)!.value
    const decoded = decodeBillingLibrary(library)
    assert.equal(decoded.digest, declared)
    if (decoded.kind !== 'rule-set') return assert.fail('expected a rule set')
    assert.equal(billingRuleSetDigest(decoded.payload), declared)
    assert.equal(billingRulePayloadDigest({ schemaVersion: 2, rules: decoded.payload.rules, factSources: decoded.payload.factSources }), declared)
  })
})
