import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const forbiddenHost = ['tx', 'fhir', 'org'].join('.')
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
const matches = []
for (const path of tracked) {
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (content.toLowerCase().includes(forbiddenHost)) matches.push(path)
}
if (matches.length > 0) throw new Error(`Forbidden terminology host appears in tracked files: ${matches.join(', ')}`)

const pipeline = readFileSync('fhirscripts.config.yaml', 'utf8')
const adapter = readFileSync('scripts/offline-publisher-bin/java', 'utf8')
if (!pipeline.includes('scripts/offline-publisher-bin')) throw new Error('Publisher pipeline does not select the offline adapter.')
const requiredTx = 'https://tx.health-samurai.io/fhir'
if (!adapter.includes(`-tx "$PUBLISHER_TX"`) || !adapter.includes(requiredTx)) {
  throw new Error(`Publisher adapter does not pin the terminology server to ${requiredTx}.`)
}
console.log(`terminology policy passed: ${tracked.length} files scanned, tx pinned to ${requiredTx}`)
