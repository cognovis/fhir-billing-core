import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { it } from 'node:test'
import { assertIgDefinitions, extensionDefinitionUrls, sourceDefinitions } from './ig-contract.mjs'
import { fhirExamples } from './fhir-examples.mjs'

it('defines the extensions and owned CodeSystems used by public Library and admission emission', () => {
  const fsh = readdirSync('input/fsh').filter((file) => file.endsWith('.fsh'))
    .map((file) => readFileSync(`input/fsh/${file}`, 'utf8')).join('\n')
  assertIgDefinitions(fhirExamples(), sourceDefinitions(fsh))
})

it('refuses an undefined emitted URL and accepts its definition', () => {
  const url = 'https://example.invalid/extension/unpublished'
  const library = { resourceType: 'Library', relatedArtifact: [{ extension: [{ url, valueString: 'digest' }] }] }
  assert.throws(() => assertIgDefinitions([library], []), /not defined.*unpublished/)
  const definitions = [{ resourceType: 'StructureDefinition', type: 'Extension', derivation: 'constraint', url }]
  assertIgDefinitions([library], definitions)
})

it('refuses an undefined owned CodeSystem and an undefined code', () => {
  const system = 'https://fhir.cognovis.de/billing-core/CodeSystem/price-component'
  const resource = { resourceType: 'ChargeItemDefinition', propertyGroup: [{ priceComponent: [{ code: { coding: [{ system, code: 'unvalued' }] } }] }] }
  assert.throws(() => assertIgDefinitions([resource], []), /CodeSystem not defined/)
  assert.throws(() => assertIgDefinitions([resource], [{ resourceType: 'CodeSystem', url: system }]), /undefined in the IG/)
  assertIgDefinitions([resource], [{ resourceType: 'CodeSystem', url: system, concept: [{ code: 'unvalued' }] }])
})


it('continues to refuse custom resource profiles', () => {
  assert.throws(() => extensionDefinitionUrls([
    { resourceType: 'StructureDefinition', type: 'Library', derivation: 'constraint', url: 'https://example.invalid/profile' },
  ]), /custom resource profiles/)
})

// The IG Publisher fails QA on a definition whose ^url is not <canonical>/StructureDefinition/<id>
// unless sushi-config lists it under special-url. That QA runs only in the slow IG build, so this
// fast check keeps the list complete.
it('lists every non-standard FSH ^url under special-url in sushi-config', () => {
  const fsh = readdirSync('input/fsh').filter((file) => file.endsWith('.fsh'))
    .map((file) => readFileSync(`input/fsh/${file}`, 'utf8')).join('\n')
  const config = readFileSync('sushi-config.yaml', 'utf8')
  const canonical = config.match(/^canonical:\s*(\S+)/m)[1]
  const urls = [...fsh.matchAll(/^\* \^url = "([^"]+)"/gm)].map((match) => match[1])
  assert.ok(urls.length > 0, 'no FSH ^url found')
  const specialUrls = (config.match(/^ {2}special-url:\n((?: {4}- .*\n)+)/m)?.[1] ?? '')
    .split('\n').map((line) => line.replace(/^ {4}- /, '').trim()).filter(Boolean)
  const standard = (url) => ['StructureDefinition', 'CodeSystem', 'ValueSet'].some((type) => url.startsWith(`${canonical}/${type}/`))
  const missing = urls.filter((url) => !standard(url) && !specialUrls.includes(url))
  assert.deepEqual(missing, [])
})
