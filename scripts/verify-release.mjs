import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertFshGeneratedFresh } from './fsh-source-fingerprint.mjs'
import { ENGINE_PACKAGE_DIRECTORIES, engineManifestViolations } from './engine-manifest-guard.mjs'
import { filesBelow, prohibitedMatch } from './prohibited-content.mjs'
import { assertPackedCatalogExamples } from './catalog-example-guard.mjs'
import { assertIgDefinitions } from './ig-contract.mjs'
import { fhirExamples } from './fhir-examples.mjs'

const packageDirectories = ENGINE_PACKAGE_DIRECTORIES
// The rule-set JSON Schema ships in the rules archive; the release workflow attaches that copy to the GitHub release.
const RULE_SET_SCHEMA_ENTRY = 'schema/billing-rule-set.schema.json'
const releaseVersion = readFileSync('VERSION', 'utf8').trim()
const privateRegistry = 'https://npm.cognovis.de'
const workspaceManifest = JSON.parse(readFileSync('package.json', 'utf8'))
if (workspaceManifest.version !== releaseVersion) {
  throw new Error(`workspace package.json version ${workspaceManifest.version} does not match VERSION ${releaseVersion}`)
}

const expectedDependencies = {
  '@cognovis/fhir-billing-types': [],
  '@cognovis/fhir-billing-rules': ['@cognovis/fhir-billing-types'],
  '@cognovis/fhir-billing-engine': ['@cognovis/fhir-billing-rules', '@cognovis/fhir-billing-types'],
}
const expectedDependencyVersions = {
  '@cognovis/fhir-billing-rules': { '@cognovis/fhir-billing-types': releaseVersion },
  '@cognovis/fhir-billing-engine': {
    '@cognovis/fhir-billing-rules': releaseVersion,
    '@cognovis/fhir-billing-types': releaseVersion,
  },
}
for (const directory of ['input/fsh', 'fixtures']) {
  for (const file of filesBelow(directory)) {
    const match = prohibitedMatch(file, readFileSync(file, 'utf8'))
    if (match) throw new Error(`Prohibited repository content ${match.pattern} in ${file}:${match.lineNumber}`)
  }
}

for (const directory of packageDirectories) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (manifest.version !== releaseVersion) throw new Error(`${manifest.name} metadata is not release-ready.`)
  const manifestViolations = engineManifestViolations(manifest)
  if (manifestViolations.length > 0) throw new Error(`${manifest.name} must stay Apache-2.0 without a cognovis SDK: ${manifestViolations.join('; ')}`)
  if (manifest.publishConfig?.registry !== privateRegistry || manifest.publishConfig?.access !== 'public') {
    throw new Error(`${manifest.name} must publish publicly to ${privateRegistry}.`)
  }
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort()
  if (JSON.stringify(dependencies) !== JSON.stringify(expectedDependencies[manifest.name])) throw new Error(`${manifest.name} dependency direction changed.`)
  const expectedVersions = expectedDependencyVersions[manifest.name] ?? {}
  for (const [name, version] of Object.entries(expectedVersions)) {
    if (manifest.dependencies?.[name] !== version) throw new Error(`${manifest.name} must pin ${name}@${version}.`)
  }
  if (!filesBelow(directory).some((path) => path.endsWith('/NOTICE'))) throw new Error(`${manifest.name} NOTICE is missing.`)
  for (const file of filesBelow(directory).filter((path) => !path.includes('/dist/') && !path.endsWith('.tsbuildinfo'))) {
    const match = prohibitedMatch(file, readFileSync(file, 'utf8'))
    if (match) throw new Error(`Prohibited package content ${match.pattern} in ${file}:${match.lineNumber}`)
  }
}

const packDirectory = mkdtempSync(join(tmpdir(), 'fhir-billing-core-packs-'))
const localTarballs = new Map()
for (const directory of packageDirectories) {
  const output = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], { cwd: directory, encoding: 'utf8' }))
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0]
  const filename = packed?.filename
  if (!filename) throw new Error(`npm pack did not return a tarball for ${directory}`)
  const tarball = join(packDirectory, filename)
  assertPackedCatalogExamples(tarball)
  localTarballs.set(directory, tarball)
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  if (!listing.includes('package/dist/index.js') || !listing.includes('package/dist/index.d.ts') || !listing.includes('package/NOTICE')) {
    throw new Error(`Tarball surface is incomplete for ${directory}`)
  }
  if (directory === 'packages/rules' && !listing.includes(`package/${RULE_SET_SCHEMA_ENTRY}`)) throw new Error(`Tarball of ${directory} lacks ${RULE_SET_SCHEMA_ENTRY}.`)
  for (const entry of listing.trim().split('\n').filter(Boolean)) {
    if (entry.endsWith('/')) continue
    const content = execFileSync('tar', ['-xOzf', tarball, entry], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
    const match = prohibitedMatch(`${directory}/${entry.replace(/^package\//, '')}`, content)
    if (match) throw new Error(`Prohibited content ${match.pattern} in ${filename}:${entry}:${match.lineNumber}`)
  }
}

if (process.argv.includes('--published')) {
  const publishedDirectory = mkdtempSync(join(tmpdir(), 'fhir-billing-core-published-'))
  for (const directory of packageDirectories) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const specifier = `${manifest.name}@${releaseVersion}`
    let metadata
    let packed
    try {
      metadata = JSON.parse(execFileSync('npm', ['view', specifier, '--json', `--registry=${privateRegistry}`], { encoding: 'utf8' }))
      packed = JSON.parse(execFileSync('npm', ['pack', specifier, '--json', '--pack-destination', publishedDirectory, `--registry=${privateRegistry}`], { encoding: 'utf8' }))
    } catch (error) {
      throw new Error(`Authenticated registry verification failed for ${specifier}.`, { cause: error })
    }
    if (metadata.version !== releaseVersion || typeof metadata.dist?.tarball !== 'string' || !metadata.dist.tarball.startsWith(privateRegistry)) {
      throw new Error(`Authenticated metadata or tarball location is invalid for ${specifier}.`)
    }
    if (!Array.isArray(packed) || packed[0]?.filename === undefined) throw new Error(`Authenticated tarball retrieval failed for ${specifier}.`)
    const publishedTarball = join(publishedDirectory, packed[0].filename)
    const publishedSha1 = createHash('sha1').update(readFileSync(publishedTarball)).digest('hex')
    if (publishedSha1 !== metadata.dist.shasum) throw new Error(`Published tarball digest does not match metadata for ${specifier}.`)
    const localTarball = localTarballs.get(directory)
    const localListing = execFileSync('tar', ['-tzf', localTarball], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    const publishedListing = execFileSync('tar', ['-tzf', publishedTarball], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
    if (JSON.stringify(publishedListing) !== JSON.stringify(localListing)) throw new Error(`Published tarball surface differs from the local candidate for ${specifier}.`)
    for (const entry of publishedListing.filter((item) => !item.endsWith('/'))) {
      const localContent = execFileSync('tar', ['-xOzf', localTarball, entry])
      const publishedContent = execFileSync('tar', ['-xOzf', publishedTarball, entry])
      if (!localContent.equals(publishedContent)) throw new Error(`Published tarball content differs at ${specifier}:${entry}.`)
    }
    const encodedName = encodeURIComponent(manifest.name)
    for (const url of [`${privateRegistry}/${encodedName}`, metadata.dist.tarball]) {
      const anonymousStatus = execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' })
      if (manifest.publishConfig?.access === 'public') {
        if (anonymousStatus !== '200') throw new Error(`Anonymous registry access returned ${anonymousStatus} for public package ${url}.`)
      } else if (anonymousStatus !== '401' && anonymousStatus !== '403') {
        throw new Error(`Anonymous registry access returned ${anonymousStatus} for ${url}.`)
      }
    }
  }
}

assertFshGeneratedFresh()
const generated = readdirSync('fsh-generated/resources')
assertIgDefinitions(fhirExamples(), generated.filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join('fsh-generated/resources', file), 'utf8'))))
if (!generated.some((file) => file === 'CodeSystem-billing-reason.json')) throw new Error('FHIR reason hierarchy was not generated.')
console.log(`release verification passed: ${packageDirectories.length} npm tarballs and ${generated.length} FHIR resources${process.argv.includes('--published') ? ', private registry responses verified' : ''}`)
