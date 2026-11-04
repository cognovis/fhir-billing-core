import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { filesBelow, prohibitedMatch } from './prohibited-content.mjs'

const scanned = [
  ...['types', 'rules', 'engine'].flatMap((unit) => filesBelow(`packages/${unit}`)
    .filter((path) => !path.includes('/dist/') && !path.includes('/node_modules/') && !path.endsWith('.tsbuildinfo'))),
  ...filesBelow('input/fsh'),
  ...filesBelow('fixtures'),
]

describe('prohibited release content', () => {
  it('finds no prohibited content in the package sources and repository inputs', () => {
    const matches = scanned.flatMap((file) => {
      const match = prohibitedMatch(file, readFileSync(file, 'utf8'))
      return match === undefined ? [] : [`${file}:${match.lineNumber}: ${match.pattern} in "${match.line.trim()}"`]
    })
    assert.deepEqual(matches, [], 'Core is jurisdiction-neutral (ADR-001): pass a country code system or canonical in as host input (CODING_STANDARDS.md rule 3); never add it to package sources.')
  })

  it('reports the matching line, as the 0.24.0 false positive in a carrier comment showed', () => {
    const match = prohibitedMatch('packages/rules/src/carrier.ts', 'const a = 1\n  // `factSources` is optional; a payload without it\n')
    assert.deepEqual(match, {
      pattern: /(?:source|catalog).*(?:load|download|fetch)/i,
      line: '  // `factSources` is optional; a payload without it',
      lineNumber: 2,
    })
  })
})
