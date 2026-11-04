import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { BillingInputError, billingRulePayloadDigest, canonicalizeJson } from '@cognovis/fhir-billing-rules'

/** The canonical JSON implementation of Billing Core 0.24.6, kept verbatim as the reference. */
function previousCanonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : previousCanonicalizeJson(item)).join(',')}]`
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new BillingInputError('Canonical JSON values must be JSON-compatible.')
    return serialized
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${previousCanonicalizeJson(record[key])}`).join(',')}}`
}

/** A small deterministic PRNG, so a failure reproduces from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KEY_ALPHABET = ['a', 'b', 'Z', '0', '9', '10', '_', '$', 'ä', 'ß', '\u0000', '"', '\\', '\n', ' ', '😀', '\ud800', 'é', 'é', ' ', '__proto__', 'constructor', 'toJSON']
const NUMBERS = [0, -0, 1, -1, 0.1, 1e21, 1e-7, -1.5e300, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, 12.5, 2.3]

function randomText(next: () => number): string {
  const length = Math.floor(next() * 6)
  let out = ''
  for (let index = 0; index < length; index += 1) out += KEY_ALPHABET[Math.floor(next() * KEY_ALPHABET.length)]
  return out
}

function randomValue(next: () => number, depth: number): unknown {
  const pick = next()
  if (depth <= 0 || pick < 0.35) {
    const scalar = Math.floor(next() * 6)
    if (scalar === 0) return randomText(next)
    if (scalar === 1) return NUMBERS[Math.floor(next() * NUMBERS.length)]
    if (scalar === 2) return next() < 0.5
    if (scalar === 3) return null
    if (scalar === 4) return Math.floor(next() * 1_000_000) - 500_000
    return next() * 1000
  }
  if (pick < 0.65) {
    const length = Math.floor(next() * 5)
    const array: unknown[] = []
    for (let index = 0; index < length; index += 1) array.push(next() < 0.1 ? undefined : randomValue(next, depth - 1))
    // Holes are kept as the previous implementation printed them.
    if (next() < 0.05) array.length += 1
    return array
  }
  const record: Record<string, unknown> = Object.create(next() < 0.05 ? null : Object.prototype) as Record<string, unknown>
  const size = Math.floor(next() * 6)
  for (let index = 0; index < size; index += 1) {
    const key = randomText(next)
    Object.defineProperty(record, key, { value: next() < 0.1 ? undefined : randomValue(next, depth - 1), enumerable: true, writable: true, configurable: true })
  }
  return record
}

function outcome(implementation: (value: unknown) => string, value: unknown): { ok: string } | { error: string } {
  try {
    return { ok: implementation(value) }
  } catch (error) {
    return { error: error instanceof Error ? `${error.constructor.name}:${error.message}` : String(error) }
  }
}

function fixtureValues(): { label: string; value: unknown }[] {
  const values: { label: string; value: unknown }[] = []
  const roots = [join(process.cwd(), 'fixtures'), join(process.cwd(), 'tests')]
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith('.json')) values.push({ label: path, value: JSON.parse(readFileSync(path, 'utf8')) })
      else if (entry.name.endsWith('.jsonl')) {
        for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) if (line.trim()) values.push({ label: `${path}:${index + 1}`, value: JSON.parse(line) })
      }
    }
  }
  for (const root of roots) visit(root)
  return values
}

describe('Canonical JSON is byte-identical to Billing Core 0.24.6 (cognovis/fhir-billing-core#124)', () => {
  it('matches the previous implementation on 20,000 random JSON-like values, failures included', () => {
    const next = prng(124)
    for (let index = 0; index < 20_000; index += 1) {
      const value = randomValue(next, 5)
      assert.deepEqual(outcome(canonicalizeJson, value), outcome(previousCanonicalizeJson, value), `value ${index}`)
    }
  })

  it('matches the previous implementation on values JSON cannot carry', () => {
    const odd: unknown[] = [undefined, () => 1, Symbol('s'), { a: () => 1 }, [() => 1], new Date(0), new Map([[1, 2]]), Object.assign(Object.create({ inherited: 1 }), { own: 2 }), { toJSON: () => 'x' }, [1, , 2], new String('boxed'), 1n]
    for (const [index, value] of odd.entries()) assert.deepEqual(outcome(canonicalizeJson, value), outcome(previousCanonicalizeJson, value), `odd value ${index}`)
  })

  it('matches the previous implementation on every fixture resource and payload', () => {
    // The SDK fixtures left with the SDK (cognovis/fhir-billing-core#212); the payload-v2 vector remains.
    const values = fixtureValues()
    assert.ok(values.some(({ label }) => label.endsWith('payload-v2-digest.json')))
    for (const { label, value } of values) assert.equal(canonicalizeJson(value), previousCanonicalizeJson(value), label)
  })

  it('keeps the published payload-v2 digest', () => {
    const vector = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'payload-v2-digest.json'), 'utf8')) as { payload: never; digest: string }
    assert.equal(billingRulePayloadDigest(vector.payload), vector.digest)
  })
})
