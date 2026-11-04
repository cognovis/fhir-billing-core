// Packed-consumer proof for the three engine npm units. `npm run verify` runs this script with `node`:
// the Node consumer executes through process.execPath and the Bun consumer through the `bun` binary,
// so both runtimes load the same packed archives.
//
// The consumer installs the three archives and nothing else. It proves what a partner relies on when it
// ships the engine inside its own product: the archives install without any cognovis SDK, every
// cognovis package in the tree is one of the three, the public types typecheck from the package roots,
// and the engine decides and refuses a synthetic case identically in both runtimes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_PACKAGE_DIRECTORIES, ENGINE_PACKAGES } from './engine-manifest-guard.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// CI supplies the exact archive set it will publish, in types/rules/engine order.
const suppliedTarballs = process.argv.slice(2)
if (suppliedTarballs.length !== 0 && suppliedTarballs.length !== ENGINE_PACKAGE_DIRECTORIES.length) {
  throw new Error('Supply exactly three packed archives in types/rules/engine order, or none to pack locally')
}
const tarballs = suppliedTarballs.map((path) => resolve(path))
if (tarballs.length === 0) {
  const packDirectory = mkdtempSync(join(tmpdir(), 'fhir-billing-core-packs-'))
  for (const directory of ENGINE_PACKAGE_DIRECTORIES) {
    const output = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDirectory], { cwd: resolve(repository, directory), encoding: 'utf8' }))
    const packed = Array.isArray(output) ? output[0] : Object.values(output)[0]
    if (!packed?.filename) throw new Error(`Unable to pack ${directory}`)
    tarballs.push(join(packDirectory, packed.filename))
  }
}
console.log(JSON.stringify({ packedArchives: tarballs.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) }))

const scratch = mkdtempSync(join(tmpdir(), 'fhir-billing-core-consumer-'))
writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}\n')
// The archives depend only on each other, so the consumer needs no registry: offline, any dependency
// that is not one of the archives fails the install instead of resolving from a cache or registry.
execFileSync('npm', ['install', '--ignore-scripts', '--no-package-lock', '--offline', ...tarballs], { cwd: scratch, stdio: 'pipe' })

// Every installed package of the tree, nested and bundled installations included, by the name its own
// manifest declares (an alias directory name is not trusted), with its path relative to the consumer.
function installedPackages(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith('.')) return []
    const path = join(directory, entry.name)
    if (entry.name.startsWith('@')) return installedPackages(path)
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    const nested = existsSync(join(path, 'node_modules')) ? installedPackages(join(path, 'node_modules')) : []
    return [{ name: manifest.name, path: relative(scratch, path) }, ...nested]
  })
}
const installed = installedPackages(join(scratch, 'node_modules'))
const foreign = installed.filter((entry) => !ENGINE_PACKAGES.includes(entry.name))
if (foreign.length > 0) {
  throw new Error(`packed consumer installed packages beyond the three engine units: ${foreign.map((entry) => `${entry.name} (${entry.path})`).join(', ')}`)
}
const missing = ENGINE_PACKAGES.filter((name) => !installed.some((entry) => entry.name === name))
if (missing.length > 0) throw new Error(`packed consumer is missing engine units: ${missing.join(', ')}`)

// Public types a consumer needs to build inputs and read results, imported from the package roots.
writeFileSync(join(scratch, 'consumer.ts'), `import type { AdmissionState, BillingCase, BillingLine, BillingRuleSet } from '@cognovis/fhir-billing-types'
import { BillingInputError, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
const line: BillingLine = { id: 'a', code: { system: 'https://example.invalid/synthetic', code: 'SYN-1' }, quantity: 1, unitPriceUnknown: true }
const billingCase: BillingCase = { id: 'case', asOf: '2026-01-01', lines: [line], facts: {} }
const admission: AdmissionState | undefined = undefined
const ruleSet: BillingRuleSet | undefined = undefined
export const surface = [billingCase, admission, ruleSet, BillingInputError, defineBillingRuleSet, compileRuleSet, evaluateBillingCase]
`)
writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', skipLibCheck: false, types: [] }, files: ['consumer.ts'] }))
execFileSync(process.execPath, [resolve(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: scratch, stdio: 'pipe' })

writeFileSync(join(scratch, 'runner.mjs'), `import { BillingInputError, defineBillingRuleSet } from '@cognovis/fhir-billing-rules'
import { compileRuleSet, evaluateBillingCase } from '@cognovis/fhir-billing-engine'
import { BILLING_REASON_CODES } from '@cognovis/fhir-billing-types'
const SYSTEM = 'https://example.invalid/synthetic'
const state = { availability: 'available', completeness: 'complete', entitled: true, compatible: true, digestMatches: true }
const admission = { status: 'admitted', catalog: { edition: 'synthetic', digest: 'sha256:catalog', ...state }, ruleSet: { edition: 'synthetic-rules', digest: 'sha256:rules', ...state } }
const compiled = compileRuleSet(defineBillingRuleSet({ schemaVersion: 2, semanticMajor: 4, id: 'synthetic-rules', rules: [
  { id: 'limit', class: 'quantity-limit', mustUnderstand: true, effect: 'reject', priority: 1, parameters: { selector: { system: SYSTEM, codes: ['SYN-1'] }, maximum: 1 } },
] }), admission)
const line = (quantity) => ({ id: 'a', code: { system: SYSTEM, code: 'SYN-1' }, quantity, unitPriceUnknown: true })
const decide = (quantity) => evaluateBillingCase(compiled, { id: 'case', asOf: '2026-01-01', lines: [line(quantity)], facts: {} }).outcome
let refusal = 'none'
try { evaluateBillingCase(compiled, { id: 'case', asOf: '2026-01-01', lines: [{ id: 'a', code: { system: SYSTEM, code: 'SYN-1' }, quantity: 1 }], facts: {} }) }
catch (error) { refusal = error instanceof BillingInputError ? 'BillingInputError' : String(error) }
console.log(JSON.stringify({ accepted: decide(1), rejected: decide(2), refusal, reasonCodes: BILLING_REASON_CODES.length > 0 }))
`)
const expected = JSON.stringify({ accepted: 'accepted', rejected: 'rejected', refusal: 'BillingInputError', reasonCodes: true })
for (const [runtime, command] of [['node', process.execPath], ['bun', 'bun']]) {
  const output = execFileSync(command, ['runner.mjs'], { cwd: scratch, encoding: 'utf8' }).trim()
  if (output !== expected) throw new Error(`${runtime} packed consumer decided ${output}, expected ${expected}`)
}
console.log(`packed portability passed: ${tarballs.length} archives, no cognovis SDK installed, decisions identical in node and bun`)
