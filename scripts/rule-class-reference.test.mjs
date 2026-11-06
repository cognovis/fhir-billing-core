import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'bun:test'
import { README_FILE, SCHEMA_FILE, renderRuleClassReference, withRuleClassReference } from './rule-class-reference.mjs'

const schema = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))

test('the README rule-class reference is the one the schema generates', () => {
  const readme = readFileSync(README_FILE, 'utf8')
  assert.equal(withRuleClassReference(readme, renderRuleClassReference(schema)), readme, 'run bun scripts/rule-class-reference.mjs')
})

test('the reference names every rule class, its parameters and an example', () => {
  const rendered = renderRuleClassReference(schema)
  for (const [ruleClass, definition] of Object.entries(schema.$defs.ruleClassParameters)) {
    assert.ok(rendered.includes(`### \`${ruleClass}\``), ruleClass)
    assert.ok(rendered.includes(`"class": "${ruleClass}"`), `${ruleClass} example`)
    for (const name of definition.required) assert.ok(rendered.includes(`| \`${name}\` | yes |`), `${ruleClass} ${name}`)
  }
})

test('a README without the markers is refused', () => {
  assert.throws(() => withRuleClassReference('# README\n', 'x'), /markers/)
})
