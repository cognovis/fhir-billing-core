import { readdirSync, statSync } from 'node:fs'

/**
 * Content the release must not ship: practice-specific canonicals, real fee-schedule names, Polaris
 * imports and source download code. `verify-release.mjs` applies these to the repository inputs, the
 * package sources and the packed tarballs; `prohibited-content.test.mjs` applies them to the package
 * sources and repository inputs on every `npm test`, so a match fails before publication.
 */
export const prohibitedContent = [
  /fhir\.cognovis\.de\/praxis/i,
  /(?<![\p{L}\p{N}_])(?:ebm|hzv|goae|goä|goz|tardoc|tarmed)(?![\p{L}\p{N}_])/iu,
  /@polaris\//i,
  /(?:source|catalog).*(?:load|download|fetch)/i,
]

/** The files below `directory`, as `/`-separated paths on every platform so path filters match. */
export function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return filesBelow(path)
    return statSync(path).isFile() ? [path] : []
  })
}

/**
 * The first prohibited pattern a line of the file at `path` matches, with that line and its 1-based number; undefined when none matches. No pattern spans a line break, so
 * matching per line finds what matching the whole text finds.
 */
export function prohibitedMatch(path, content) {
  const lines = content.split('\n')
  for (const pattern of prohibitedContent) {
    const index = lines.findIndex((line) => pattern.test(line))
    if (index !== -1) return { pattern, line: lines[index], lineNumber: index + 1 }
  }
  return undefined
}
