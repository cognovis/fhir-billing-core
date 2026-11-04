import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The engine packages are Apache-2.0 and stand alone: a partner ships them inside its own product, so
 * none of them may pull in a cognovis SDK, whose license and runtime (FHIR server, client) the partner
 * does not take on. The only cognovis packages an engine manifest may name are the engine packages
 * themselves. `npm test` runs this guard through its test, and CI runs the command below directly.
 */
export const ENGINE_PACKAGE_DIRECTORIES = ['packages/types', 'packages/rules', 'packages/engine']

/** The only cognovis packages an engine manifest or the tree of an engine consumer may contain. */
export const ENGINE_PACKAGES = ['@cognovis/fhir-billing-types', '@cognovis/fhir-billing-rules', '@cognovis/fhir-billing-engine']

const allowed = new Set(ENGINE_PACKAGES)
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies', 'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies']
const LICENSE = 'Apache-2.0'

/**
 * The package an npm alias specifier (`npm:<name>@<range>`, prefix in any case as npm accepts it)
 * installs; undefined for any other specifier.
 */
function aliasTarget(specifier) {
  if (typeof specifier !== 'string' || specifier.slice(0, 4).toLowerCase() !== 'npm:') return undefined
  const target = specifier.slice(4).trim()
  const versionAt = target.indexOf('@', 1)
  return versionAt === -1 ? target : target.slice(0, versionAt)
}

const forbidden = (name) => name.startsWith('@cognovis/') && !allowed.has(name)

/** Every rule the manifest breaks, one message per field and package; empty when it passes. */
export function engineManifestViolations(manifest) {
  const violations = []
  for (const field of DEPENDENCY_FIELDS) {
    const declared = manifest[field]
    const entries = Array.isArray(declared) ? declared.map((name) => [name, undefined]) : Object.entries(declared ?? {})
    for (const [name, specifier] of entries) {
      // An alias installs its target under the key's name, so both the target and the name are checked.
      const target = aliasTarget(specifier) ?? name
      if (forbidden(target)) violations.push(target === name ? `${field} declares ${name}` : `${field} declares ${target} as ${name}`)
      else if (forbidden(name)) violations.push(`${field} declares ${name}`)
    }
  }
  if (manifest.license !== LICENSE) violations.push(`license is ${manifest.license ?? 'missing'}, not ${LICENSE}`)
  return violations
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = ENGINE_PACKAGE_DIRECTORIES.flatMap((directory) => {
    const path = `${directory}/package.json`
    return engineManifestViolations(JSON.parse(readFileSync(path, 'utf8'))).map((violation) => `${path}: ${violation}`)
  })
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`engine manifests pass: ${ENGINE_PACKAGE_DIRECTORIES.length} Apache-2.0 packages without a cognovis SDK dependency`)
}
