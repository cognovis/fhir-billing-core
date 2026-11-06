import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ENGINE_PACKAGE_DIRECTORIES } from './engine-manifest-guard.mjs'
import { packageReadmeViolations, readmeExample } from './package-readme.mjs'

const packages = ENGINE_PACKAGE_DIRECTORIES.map((directory) => ({
  directory,
  name: JSON.parse(readFileSync(`${directory}/package.json`, 'utf8')).name,
}))

describe('package READMEs', () => {
  for (const { directory, name } of packages) {
    it(`${name} packs a README.md`, () => {
      // --ignore-scripts skips the prepack build: the file list does not depend on it.
      const output = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: directory, encoding: 'utf8' }))
      assert.ok(output[0].files.some((file) => file.path === 'README.md'), `${name} tarball lists no README.md`)
    })

    it(`${name} README states the anonymous install, license and a runnable example`, () => {
      const readme = readFileSync(`${directory}/README.md`, 'utf8')
      assert.deepEqual(packageReadmeViolations(name, readme), [])
    })
  }

  it('refuses a README without install, license, example or with private references', () => {
    const violations = packageReadmeViolations('@cognovis/fhir-billing-types', 'See git.cognovis.de and the cognovis Health Platform guide.\n')
    assert.deepEqual(violations, [
      'missing the scope registry line @cognovis:registry=https://npm.cognovis.de',
      'missing the install command npm install @cognovis/fhir-billing-types',
      'missing the license Apache-2.0',
      'missing the licensor cognovis GmbH',
      'missing exactly one ```js example block',
      'line 1 names a private reference: git.cognovis.de',
      'line 1 names a private reference: Health Platform',
    ])
  })

  it('refuses a README that asks for a registry token', () => {
    const violations = packageReadmeViolations('@cognovis/fhir-billing-types', '//npm.cognovis.de/:_authToken=x\n')
    assert.ok(violations.includes('line 1 names a private reference: _authToken'))
  })

  it('extracts the one js example block', () => {
    assert.equal(readmeExample('text\n\n```js\nconsole.log(1)\n```\n\n```sh\nls\n```\n'), 'console.log(1)\n')
    assert.equal(readmeExample('```js\na\n```\n```js\nb\n```\n'), undefined)
  })
})
