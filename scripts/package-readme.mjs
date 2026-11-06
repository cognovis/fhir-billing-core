import { prohibitedMatch } from './prohibited-content.mjs'

/**
 * The README each engine package ships in its npm tarball is public: fhir.cognovis.de renders it on the
 * package's SDK page (cognovis/fhir-billing-core#30). It states the anonymous install, the license and
 * one runnable `js` example, and names nothing private: no private repository or guide, internal host,
 * internal tooling or registry token. `package-readme.test.mjs` applies these rules on every `npm test`,
 * and `verify-packed-portability.mjs` runs each example against the packed archives.
 */
export const SCOPE_REGISTRY_LINE = '@cognovis:registry=https://npm.cognovis.de'

const privateReferences = [
  'git.cognovis.de',
  'Health Platform',
  'cognovis/chp',
  'fhir-management',
  'fhir-foundation',
  'workbench',
  'ccore',
  'MIRA',
  '_authToken',
]

/** The content of the one fenced `js` block of the README; undefined when it has none or several. */
export function readmeExample(readme) {
  const blocks = [...readme.matchAll(/^```js\n([\s\S]*?)^```$/gm)]
  return blocks.length === 1 ? blocks[0][1] : undefined
}

/** Every rule the README of package `name` breaks; empty when it passes. */
export function packageReadmeViolations(name, readme) {
  const violations = []
  if (!readme.includes(SCOPE_REGISTRY_LINE)) violations.push(`missing the scope registry line ${SCOPE_REGISTRY_LINE}`)
  if (!readme.includes(`npm install ${name}`)) violations.push(`missing the install command npm install ${name}`)
  if (!readme.includes('Apache-2.0')) violations.push('missing the license Apache-2.0')
  if (!readme.includes('cognovis GmbH')) violations.push('missing the licensor cognovis GmbH')
  if (readmeExample(readme) === undefined) violations.push('missing exactly one ```js example block')
  readme.split('\n').forEach((line, index) => {
    for (const reference of privateReferences) {
      if (line.includes(reference)) violations.push(`line ${index + 1} names a private reference: ${reference}`)
    }
  })
  const prohibited = prohibitedMatch('README.md', readme)
  if (prohibited !== undefined) violations.push(`line ${prohibited.lineNumber} matches prohibited content ${prohibited.pattern}`)
  return violations
}
