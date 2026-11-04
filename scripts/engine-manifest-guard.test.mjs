import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ENGINE_PACKAGE_DIRECTORIES, engineManifestViolations } from './engine-manifest-guard.mjs'

const clean = {
  name: '@cognovis/fhir-billing-engine',
  license: 'Apache-2.0',
  dependencies: { '@cognovis/fhir-billing-rules': '0.37.0', '@cognovis/fhir-billing-types': '0.37.0' },
}

describe('engine manifest guard', () => {
  it('accepts the repository engine manifests as committed', () => {
    assert.deepEqual(ENGINE_PACKAGE_DIRECTORIES, ['packages/types', 'packages/rules', 'packages/engine'])
    for (const directory of ENGINE_PACKAGE_DIRECTORIES) {
      const manifest = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'))
      assert.deepEqual(engineManifestViolations(manifest), [], directory)
    }
  })

  it('accepts dependencies between the engine packages', () => {
    assert.deepEqual(engineManifestViolations(clean), [])
  })

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies', 'peerDependenciesMeta']) {
    it(`refuses a cognovis SDK in ${field}`, () => {
      const value = field === 'peerDependenciesMeta' ? { optional: true } : '^0.23.2'
      const manifest = { ...clean, [field]: { ...(clean[field] ?? {}), '@cognovis/fhir-sdk': value } }
      assert.deepEqual(engineManifestViolations(manifest), [`${field} declares @cognovis/fhir-sdk`])
    })
  }

  it('refuses the billing SDK and any other cognovis package outside the engine set', () => {
    const manifest = { ...clean, dependencies: { ...clean.dependencies, '@cognovis/fhir-billing-sdk': '0.37.1', '@cognovis/health-sdk': '1.0.0' } }
    assert.deepEqual(engineManifestViolations(manifest), [
      'dependencies declares @cognovis/fhir-billing-sdk',
      'dependencies declares @cognovis/health-sdk',
    ])
  })

  it('refuses a cognovis SDK installed under an npm alias, also under an engine package name', () => {
    assert.deepEqual(engineManifestViolations({ ...clean, dependencies: { ...clean.dependencies, adapter: 'npm:@cognovis/fhir-sdk@0.23.3' } }), [
      'dependencies declares @cognovis/fhir-sdk as adapter',
    ])
    assert.deepEqual(engineManifestViolations({ ...clean, peerDependencies: { '@cognovis/fhir-billing-types': 'npm:@cognovis/fhir-billing-sdk@0.37.1' } }), [
      'peerDependencies declares @cognovis/fhir-billing-sdk as @cognovis/fhir-billing-types',
    ])
    assert.deepEqual(engineManifestViolations({ ...clean, dependencies: { ...clean.dependencies, adapter: 'NPM:@cognovis/fhir-sdk@0.23.3' } }), [
      'dependencies declares @cognovis/fhir-sdk as adapter',
    ])
    assert.deepEqual(engineManifestViolations({ ...clean, dependencies: { ...clean.dependencies, helper: 'npm:left-pad@1.3.0' } }), [])
  })

  it('refuses a bundled cognovis SDK', () => {
    assert.deepEqual(engineManifestViolations({ ...clean, bundleDependencies: ['@cognovis/fhir-sdk'] }), ['bundleDependencies declares @cognovis/fhir-sdk'])
  })

  it('refuses a license other than Apache-2.0', () => {
    assert.deepEqual(engineManifestViolations({ ...clean, license: 'MIT' }), ['license is MIT, not Apache-2.0'])
    assert.deepEqual(engineManifestViolations({ ...clean, license: undefined }), ['license is missing, not Apache-2.0'])
  })
})
