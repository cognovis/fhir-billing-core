/**
 * Comparing conformance records of two engines (`compareConformanceRecords`, @cognovis/fhir-billing-engine).
 * The records are the synthetic dental-shaped cases the standalone evaluation produced before the SDK and its
 * command-line tool moved to cognovis/chp (cognovis/fhir-billing-core#212).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { BillingInputError } from '@cognovis/fhir-billing-rules'
import { compareConformanceRecords } from '@cognovis/fhir-billing-engine'

const EXPECTED = 'fixtures/standalone/expected.jsonl'

type Finding = { code: string; ruleId?: string; lineId?: string; effect: string; details?: Record<string, unknown> }
type Row = { caseId: string; decision: string; findings: Finding[]; [key: string]: unknown }

function expected(): Row[] {
  return readFileSync(EXPECTED, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Row)
}

function byCase(rows: Row[], caseId: string): Row {
  return rows.find((row) => row.caseId === caseId)!
}

describe('conformance record comparison', () => {
  it('reports no difference for identical records', () => {
    assert.deepEqual(compareConformanceRecords(expected(), expected()), [])
  })

  it('reports a disagreement on the decision', () => {
    const right = expected()
    const factor = byCase(right, 'unjustified-factor')
    factor.decision = 'allow'
    factor.findings = []
    assert.deepEqual(compareConformanceRecords(expected(), right), [{
      kind: 'disagree',
      caseId: 'unjustified-factor',
      differs: ['decision', 'blocking'],
      left: { decision: 'block', blocking: [{ lineId: 'unjustified-factor-1', ruleId: 'factor-threshold' }] },
      right: { decision: 'allow', blocking: [] },
    }])
  })

  it('reports a disagreement on the blocking (lineId, ruleId) pairs when both sides block', () => {
    const right = expected()
    const pair = byCase(right, 'exclusive-pair')
    pair.findings = [{ code: 'OTHER_ENGINE_EXCLUSION', ruleId: 'exam-consultation-exclusive', lineId: 'exclusive-pair-1', effect: 'reject' }]
    assert.deepEqual(compareConformanceRecords(expected(), right), [{
      kind: 'disagree',
      caseId: 'exclusive-pair',
      differs: ['blocking'],
      left: { decision: 'block', blocking: [{ lineId: 'exclusive-pair-2', ruleId: 'exam-consultation-exclusive' }] },
      right: { decision: 'block', blocking: [{ lineId: 'exclusive-pair-1', ruleId: 'exam-consultation-exclusive' }] },
    }])
  })

  it('ignores codes, review findings, finding order, record order and unknown fields of another engine', () => {
    const right = expected().reverse().map((row) => ({
      caseId: row.caseId,
      decision: row.decision,
      engine: 'other-engine/7',
      findings: [
        ...[...row.findings].reverse().map((finding) => ({ code: `X-${finding.code}`, ruleId: finding.ruleId, lineId: finding.lineId, effect: finding.effect, note: 'foreign' })),
        { code: 'X-HINT', ruleId: 'hint', lineId: 'line-1', effect: 'needs-review' },
      ],
    }))
    assert.deepEqual(compareConformanceRecords(expected(), right), [])
  })

  it('treats a null lineId or ruleId of a foreign finding as absent and still requires effect', () => {
    const left = [{ caseId: 'c', decision: 'block', findings: [{ code: 'A', effect: 'reject' }, { code: 'B', ruleId: 'r', effect: 'reject' }] }]
    const right = [{ caseId: 'c', decision: 'block', findings: [{ code: 'X', lineId: null, ruleId: null, effect: 'reject' }, { code: 'Y', lineId: null, ruleId: 'r', effect: 'reject' }] }]
    assert.deepEqual(compareConformanceRecords(left, right), [])
    assert.deepEqual(compareConformanceRecords(right, []), [{ kind: 'left-only', caseId: 'c', left: { decision: 'block', blocking: [{}, { ruleId: 'r' }] } }])
    assert.throws(() => compareConformanceRecords([{ caseId: 'c', decision: 'block', findings: [{ code: 'X', lineId: null, ruleId: null }] }], []), BillingInputError)
  })

  it('lists cases present on one side only, sorted by caseId', () => {
    const left = expected().filter((row) => row.caseId !== 'clean')
    const right = expected().filter((row) => row.caseId !== 'quantity-limit')
    assert.deepEqual(compareConformanceRecords(left, right), [
      { kind: 'right-only', caseId: 'clean', right: { decision: 'allow', blocking: [] } },
      {
        kind: 'left-only',
        caseId: 'quantity-limit',
        left: { decision: 'block', blocking: [{ lineId: 'quantity-limit-1', ruleId: 'scaling-quantity-limit' }] },
      },
    ])
  })

  it('refuses a duplicate caseId on one side and a record without caseId, decision or findings', () => {
    assert.throws(() => compareConformanceRecords([...expected(), expected()[0]], expected()), /duplicate caseId exclusive-pair/)
    assert.throws(() => compareConformanceRecords([{ decision: 'allow', findings: [] }], []), BillingInputError)
    assert.throws(() => compareConformanceRecords([{ caseId: 'a', decision: 'maybe', findings: [] }], []), BillingInputError)
    assert.throws(() => compareConformanceRecords([{ caseId: 'a', decision: 'allow' }], []), BillingInputError)
    assert.throws(() => compareConformanceRecords([{ caseId: 'a', decision: 'block', findings: [{ code: 'C', effect: 'deny' }] }], []), BillingInputError)
  })
})
