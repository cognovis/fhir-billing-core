import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const artifactKindSystem = 'https://fhir.cognovis.de/billing-core/sid/artifact-kind'

function assertExample(resource, location) {
  if (resource?.resourceType === 'Bundle') {
    for (const [index, entry] of (resource.entry ?? []).entries()) {
      assertExample(entry.resource, `${location}#entry[${index}]`)
    }
  }
  if (resource?.resourceType !== 'Library') return
  const isCatalogEdition = resource.identifier?.some(({ system, value }) =>
    system === artifactKindSystem && value === 'catalog-edition')
  if (isCatalogEdition && (resource.status !== 'draft' || resource.experimental !== true)) {
    throw new Error(`${location}: catalog-edition examples must be draft and experimental`)
  }
}

// The Core IG and npm units ship demonstration resources, never runtime catalogs.
export function assertPackedCatalogExamples(archive) {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim().split('\n').filter((entry) => entry.endsWith('.json'))
  for (const entry of entries) {
    const resource = JSON.parse(execFileSync('tar', ['-xOzf', archive, entry], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    }))
    assertExample(resource, `${archive}:${entry}`)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const archives = process.argv.slice(2)
  if (archives.length === 0) throw new Error('usage: bun scripts/catalog-example-guard.mjs <package.tgz> [...]')
  for (const archive of archives) assertPackedCatalogExamples(archive)
  console.log(`catalog-edition example guard passed: ${archives.length} archive(s)`)
}
