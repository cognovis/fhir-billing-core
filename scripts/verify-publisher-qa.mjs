import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const qa = JSON.parse(readFileSync('output/qa.json', 'utf8'))
if (qa.errs !== 0) throw new Error(`IG Publisher QA has ${qa.errs} error(s).`)

const manifest = JSON.parse(execFileSync('tar', ['-xOzf', 'output/package.tgz', 'package/package.json'], { encoding: 'utf8' }))
const expectedVersion = readFileSync('VERSION', 'utf8').trim()
if (manifest.name !== 'de.cognovis.fhir.billing.core' || manifest.version !== expectedVersion) {
  throw new Error(`Unexpected FHIR package identity: ${manifest.name}@${manifest.version}, expected de.cognovis.fhir.billing.core@${expectedVersion}`)
}
console.log(`publisher QA passed: ${qa.warnings} warning(s), ${qa.hints} hint(s), package=${manifest.name}@${manifest.version}`)
