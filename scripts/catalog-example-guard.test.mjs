import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'bun:test'

const guard = resolve('scripts/catalog-example-guard.mjs')
const edition = {
  resourceType: 'Library',
  id: 'catalog-example',
  identifier: [{ system: 'https://fhir.cognovis.de/billing-core/sid/artifact-kind', value: 'catalog-edition' }],
  status: 'active',
}

function checkArchive(resource, entry = 'example/Library-catalog.json') {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-example-guard-'))
  try {
    const file = join(directory, 'package', entry)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(resource))
    const archive = join(directory, 'package.tgz')
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package'])
    const result = spawnSync('bun', [guard, archive], { encoding: 'utf8' })
    assert.ifError(result.error)
    return result
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('the package guard refuses an active catalog-edition example with its archive path', () => {
  const result = checkArchive(edition)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /package\/example\/Library-catalog.json/)
  assert.match(result.stderr, /draft.*experimental/)
})

test('the package guard accepts draft experimental catalog examples and unrelated active Libraries', () => {
  assert.equal(checkArchive({ ...edition, status: 'draft', experimental: true }).status, 0)
  assert.equal(checkArchive({ ...edition, identifier: [{ system: edition.identifier[0].system, value: 'rule-set' }] }).status, 0)
  assert.equal(checkArchive({ ...edition, identifier: [{ system: 'https://example.invalid/other', value: 'catalog-edition' }] }).status, 0)
  assert.notEqual(checkArchive({ ...edition, status: 'draft' }).status, 0)
  assert.notEqual(checkArchive({ ...edition, experimental: true }).status, 0)
})

test('the package guard checks resource examples shipped in npm unit directories', () => {
  const result = checkArchive(edition, 'dist/examples/catalog.json')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /package\/dist\/examples\/catalog.json/)
})

test('the package guard checks catalog editions inside shipped Bundles', () => {
  const result = checkArchive({ resourceType: 'Bundle', entry: [{ resource: edition }] }, 'dist/examples/catalog.bundle.json')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /catalog.bundle.json/)
})
