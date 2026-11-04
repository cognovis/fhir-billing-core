import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The IG build (npm run fhir:publisher, i.e. cognovis-fhir ig build) records the
// fingerprint of the SUSHI sources it consumed; the fsh-generated consumers refuse
// output that does not carry the fingerprint of the current sources.
export const resourceDirectory = 'fsh-generated/resources'
export const fingerprintPath = 'fsh-generated/source-fingerprint.json'
const rebuildHint = 'run "npm run fhir:publisher" (cognovis-fhir ig build) to produce the IG build output first; in a fresh checkout without the Publisher binary, run "fhirscripts install --config-file" before it.'

function sourceFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

export function computeSourceFingerprint() {
  const sources = ['sushi-config.yaml', ...sourceFiles('input/fsh')].sort()
  const hash = createHash('sha256')
  for (const path of sources) {
    hash.update(`${path}\0`)
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return { algorithm: 'sha256', sources, digest: hash.digest('hex') }
}

export function recordSourceFingerprint() {
  if (!existsSync(resourceDirectory) || !statSync(resourceDirectory).isDirectory()) throw new Error(`${resourceDirectory} is missing; the fingerprint is recorded only after SUSHI ran.`)
  writeFileSync(fingerprintPath, `${JSON.stringify(computeSourceFingerprint(), null, 2)}\n`)
}

export function assertFshGeneratedFresh() {
  if (!existsSync(resourceDirectory)) throw new Error(`${resourceDirectory} is missing; ${rebuildHint}`)
  if (!existsSync(fingerprintPath)) throw new Error(`${fingerprintPath} is missing; ${rebuildHint}`)
  const recorded = JSON.parse(readFileSync(fingerprintPath, 'utf8'))
  const current = computeSourceFingerprint()
  if (recorded.algorithm !== current.algorithm || recorded.digest !== current.digest) {
    throw new Error(`fsh-generated/ is stale: sushi-config.yaml or input/fsh changed since the last IG build; ${rebuildHint}`)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const mode = process.argv[2]
  if (mode === 'record') recordSourceFingerprint()
  else if (mode === 'check') assertFshGeneratedFresh()
  else throw new Error('usage: bun scripts/fsh-source-fingerprint.mjs record|check')
  console.log(`fsh source fingerprint ${mode === 'record' ? 'recorded' : 'verified'}: ${computeSourceFingerprint().digest}`)
}
