/**
 * The published rule-set JSON Schema and the decoder accept and refuse the same rule sets
 * (cognovis/fhir-billing-core#16). The shared fixtures are in rule-set-schema-fixtures.ts; a constraint only
 * the decoder can enforce is named in the schema's `$defs/decoderOnly`, and every name there has a fixture.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { BILLING_FACT_SOURCE_ORIGINS, BILLING_NATIVE_FACT_NAMES, BILLING_RULE_SOURCE_KINDS, type BillingRuleSet } from '@cognovis/fhir-billing-types'
import {
  BILLING_RULE_CLASS_DEFINITIONS,
  BILLING_RULE_PAYLOAD_SCHEMA_URI,
  billingRuleSetDigest,
  buildBillingLibrary,
  decodeBillingLibrary,
  decodeBillingRuleSet,
} from '@cognovis/fhir-billing-rules'
import { evaluateConformanceCases } from '@cognovis/fhir-billing-engine'
import { CLASS_PARAMETERS, RULE_SET_FIXTURES, rule, ruleSet, type RuleSetFixture } from './rule-set-schema-fixtures.js'

const SCHEMA_PATH = new URL('../../packages/rules/schema/billing-rule-set.schema.json', import.meta.url)
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, any>

function compile(reference?: string): (value: unknown) => boolean {
  const ajv = new Ajv2020.default({ strict: true, strictTypes: false, strictRequired: false })
  ajv.addSchema(schema)
  const validate = ajv.getSchema(reference === undefined ? schema.$id : `${schema.$id}${reference}`)
  assert.ok(validate, `schema ${reference ?? schema.$id} compiles`)
  return (value) => validate(value) === true
}

const validateFile = compile()
const validateLibraryPayload = compile('#/$defs/libraryPayload')

function decoderAccepts(decode: () => unknown): boolean {
  try {
    decode()
    return true
  } catch (error) {
    assert.equal((error as { code?: string }).code, 'BILLING_INPUT_INVALID', `the decoder refuses with BillingInputError, not ${String(error)}`)
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const LIBRARY_TEMPLATE = buildBillingLibrary({
  kind: 'rule-set',
  id: 'synthetic-rules',
  url: 'https://example.invalid/Library/synthetic-rules',
  version: '1',
  status: 'active',
  publisher: 'Synthetic Rule Authority',
  payload: { schemaVersion: 2, semanticMajor: 4, id: 'synthetic-rules', rules: [] },
  relatedArtifacts: [],
})

/** A rule-set Library carrying the given payload, with a matching digest and the binding links its appliesTo names. */
function libraryOf(payload: unknown): Record<string, unknown> {
  const digestSystem = (LIBRARY_TEMPLATE.identifier as readonly { readonly system: string }[])[1]!.system
  const appliesTo = isRecord(payload) && isRecord(payload.appliesTo) ? payload.appliesTo : {}
  const bound = [appliesTo.contracts, appliesTo.catalogEditions].flatMap((list) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []))
  const { relatedArtifact: _links, ...template } = LIBRARY_TEMPLATE
  return {
    ...template,
    identifier: [(LIBRARY_TEMPLATE.identifier as unknown[])[0], { system: digestSystem, value: isRecord(payload) ? billingRuleSetDigest(payload as unknown as BillingRuleSet) : `sha256:${'0'.repeat(64)}` }],
    ...(bound.length === 0 ? {} : { relatedArtifact: bound.map((resource) => ({ type: 'depends-on', resource })) }),
    content: [{ contentType: (LIBRARY_TEMPLATE.content as readonly { readonly contentType: string }[])[0]!.contentType, data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') }],
  }
}

function withoutSchemaReference(fixture: RuleSetFixture): boolean {
  return !(isRecord(fixture.ruleSet) && Object.hasOwn(fixture.ruleSet, '$schema'))
}

describe('rule-set JSON Schema', () => {
  it('is a draft 2020-12 schema whose $id is the payload schema URI', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.equal(schema.$id, BILLING_RULE_PAYLOAD_SCHEMA_URI)
  })

  for (const fixture of RULE_SET_FIXTURES) {
    it(`agrees with decodeBillingRuleSet: ${fixture.name}`, () => {
      const decoded = decoderAccepts(() => decodeBillingRuleSet(fixture.ruleSet))
      const validated = validateFile(fixture.ruleSet)
      assert.equal(decoded, fixture.expect === 'accept', `decoder ${decoded ? 'accepts' : 'refuses'}`)
      assert.equal(validated, fixture.decoderOnly === undefined ? fixture.expect === 'accept' : true, `schema ${validated ? 'accepts' : 'refuses'}`)
    })
  }

  for (const fixture of RULE_SET_FIXTURES.filter(withoutSchemaReference)) {
    it(`agrees with decodeBillingLibrary on the carried payload: ${fixture.name}`, () => {
      const decoded = decoderAccepts(() => decodeBillingLibrary(libraryOf(fixture.ruleSet)))
      const validated = validateLibraryPayload(fixture.ruleSet)
      assert.equal(decoded, fixture.expect === 'accept', `decoder ${decoded ? 'accepts' : 'refuses'}`)
      assert.equal(validated, fixture.decoderOnly === undefined ? fixture.expect === 'accept' : true, `schema ${validated ? 'accepts' : 'refuses'}`)
    })
  }

  it('refuses a $schema member in the payload a Library carries, in the schema and the decoder', () => {
    const payload = ruleSet([], { $schema: BILLING_RULE_PAYLOAD_SCHEMA_URI })
    assert.equal(validateLibraryPayload(payload), false)
    assert.throws(() => decodeBillingLibrary(libraryOf(payload)), { code: 'BILLING_INPUT_INVALID' })
  })

  it('drops the $schema member of a bare rule-set file from the decoded payload and its digest', () => {
    const bare = ruleSet([rule('quantity-limit', CLASS_PARAMETERS['quantity-limit']!)])
    const decoded = decodeBillingRuleSet({ $schema: BILLING_RULE_PAYLOAD_SCHEMA_URI, ...bare })
    assert.equal(Object.hasOwn(decoded, '$schema'), false)
    assert.deepEqual(decoded, decodeBillingRuleSet(bare))
    assert.equal(billingRuleSetDigest(decoded), billingRuleSetDigest(decodeBillingRuleSet(bare)))
  })

  it('validates a rule-set file with $schema in standalone evaluation without cases, as fhir-billing-check evaluate does', () => {
    const file = ruleSet([rule('quantity-limit', CLASS_PARAMETERS['quantity-limit']!)], { $schema: BILLING_RULE_PAYLOAD_SCHEMA_URI })
    assert.deepEqual(evaluateConformanceCases({ ruleSet: file, cases: [] }), [])
    assert.throws(() => evaluateConformanceCases({ ruleSet: { ...file, semanticMajor: 3 }, cases: [] }), { code: 'BILLING_INPUT_INVALID' })
  })

  it('names every decoder-only constraint once, and each has a fixture', () => {
    const listed = Object.keys(schema.$defs.decoderOnly.properties as Record<string, unknown>).sort()
    const fixtured = [...new Set(RULE_SET_FIXTURES.flatMap((fixture) => (fixture.decoderOnly === undefined ? [] : [fixture.decoderOnly])))].sort()
    assert.deepEqual(fixtured, listed)
  })

  it('covers every generic rule class with a parameters schema, a valid fixture and a refused fixture', () => {
    const classes = Object.keys(BILLING_RULE_CLASS_DEFINITIONS).sort()
    assert.deepEqual(Object.keys(schema.$defs.ruleClassParameters).sort(), classes)
    assert.deepEqual(Object.keys(CLASS_PARAMETERS).sort(), classes)
    for (const ruleClass of classes) {
      const parameters = schema.$defs.ruleClassParameters[ruleClass]
      assert.equal(parameters.description, BILLING_RULE_CLASS_DEFINITIONS[ruleClass as keyof typeof BILLING_RULE_CLASS_DEFINITIONS].description, `${ruleClass} description`)
      for (const required of BILLING_RULE_CLASS_DEFINITIONS[ruleClass as keyof typeof BILLING_RULE_CLASS_DEFINITIONS].requiredParameters) {
        assert.ok((parameters.required as string[]).includes(required), `${ruleClass} requires ${required}`)
      }
      const classOf = (fixture: RuleSetFixture) => isRecord(fixture.ruleSet) && Array.isArray(fixture.ruleSet.rules) && fixture.ruleSet.rules.some((item) => isRecord(item) && item.class === ruleClass)
      assert.ok(RULE_SET_FIXTURES.some((fixture) => classOf(fixture) && fixture.expect === 'accept'), `${ruleClass} has a valid fixture`)
      assert.ok(RULE_SET_FIXTURES.some((fixture) => classOf(fixture) && fixture.expect === 'reject'), `${ruleClass} has a refused fixture`)
    }
  })

  it('accepts every example of the schema in the schema and the decoder', () => {
    for (const [ruleClass, parameters] of Object.entries(schema.$defs.ruleClassParameters as Record<string, { examples: unknown[] }>)) {
      assert.ok(parameters.examples.length > 0, `${ruleClass} has an example`)
      for (const example of parameters.examples) {
        const file = ruleSet([rule(ruleClass, example as never)])
        assert.equal(validateFile(file), true, `${ruleClass} example is valid in the schema`)
        assert.doesNotThrow(() => decodeBillingRuleSet(file), `${ruleClass} example decodes`)
      }
    }
    for (const example of schema.examples as unknown[]) {
      assert.equal(validateFile(example), true, 'rule-set example is valid in the schema')
      assert.doesNotThrow(() => decodeBillingRuleSet(example))
    }
  })

  it('names the source kinds, fact-source origins and native facts of the types package', () => {
    assert.deepEqual(schema.$defs.provenanceSource.properties.kind.enum, [...BILLING_RULE_SOURCE_KINDS])
    assert.deepEqual(schema.$defs.factSource.properties.from.enum, [...BILLING_FACT_SOURCE_ORIGINS])
    assert.deepEqual(schema.$defs.factSource.properties.fact.not.enum, [...BILLING_NATIVE_FACT_NAMES])
  })
})
