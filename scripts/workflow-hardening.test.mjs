import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { repositoryWorkflowViolations, workflowViolations } from './workflow-hardening.mjs'

// The shape of the release workflow before cognovis/fhir-billing-core#165: one job that installed uv by
// piping its installer into sh, ran the tests and the packed consumers, and held the publish token.
const SINGLE_JOB_RELEASE = `
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Install ccore
        env:
          UV_INDEX_COGNOVIS_PASSWORD: \${{ secrets.PACKAGE_REGISTRY_READ_TOKEN }}
        run: |
          curl -LsSf https://astral.sh/uv/install.sh | sh
      - uses: oven-sh/setup-bun@v2
      - name: Install and test
        run: |
          npm ci
          npm test
      - name: Verify the exact packed compatibility matrix
        run: node scripts/verify-packed-portability.mjs
      - name: Publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: ccore release publish-npm "$SDK_TARBALL"
`

describe('workflow hardening', () => {
  it('finds every release-path rule the single-job release workflow broke', () => {
    assert.deepEqual(workflowViolations('release.yml', SINGLE_JOB_RELEASE), [
      'release.yml job release: actions/checkout keeps its token in .git/config; set persist-credentials: false',
      'release.yml job release: "Install ccore" pipes a download into a shell',
      'release.yml job release: oven-sh/setup-bun@v2 is not pinned by a commit SHA',
      'release.yml job release: "Install and test" runs build or dependency code in a job that reads a secret',
      'release.yml job release: "Verify the exact packed compatibility matrix" runs build or dependency code in a job that reads a secret',
      'release.yml job release: "Publish" publishes before a sha256sum --check of the archives',
    ])
  })

  it('accepts a secret-free build job and a publish job that only reads registry metadata', () => {
    const split = `
permissions:
  contents: read
jobs:
  build:
    steps:
      - uses: actions/checkout@v5
      - run: npm ci && npm test
  publish:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: astral-sh/setup-uv@07a047e608db84b3d8c06cd9a7c7dcc9c355c18e
      - run: printf '%s  %s\\n' "$SDK_SHA256" "$SDK_TARBALL" | sha256sum --check --strict
      - env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: npm view @cognovis/fhir-billing-sdk dist-tags --json && ccore release publish-npm "$SDK_TARBALL"
`
    assert.deepEqual(workflowViolations('release.yml', split), [])
  })

  it('treats a workflow-level secret as held by every job, and a source build of a tool as build code', () => {
    const inherited = `
env:
  NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
jobs:
  build:
    steps:
      - run: npm ci
      - run: uv tool install --force cognovis-core-tools
      - run: uv tool install --no-build cognovis-core-tools
`
    assert.deepEqual(workflowViolations('release.yml', inherited), [
      'release.yml job build: NPM_TOKEN is bound for the whole job or workflow; bind it to the publish step only',
      'release.yml job build: "npm ci" runs build or dependency code in a job that reads a secret',
      'release.yml job build: "uv tool install --force cognovis-core-tools" runs build or dependency code in a job that reads a secret',
    ])
  })

  it('finds a local action in a job that reads a secret', () => {
    const local = `
jobs:
  publish:
    steps:
      - uses: ./.github/actions/build
      - run: printf '%s  %s\\n' "$SDK_SHA256" "$SDK_TARBALL" | sha256sum --check --strict
      - env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: ccore release publish-npm "$SDK_TARBALL"
`
    assert.deepEqual(workflowViolations('release.yml', local), [
      'release.yml job publish: ./.github/actions/build runs repository code in a job that reads a secret',
    ])
  })

  it('judges each uv tool install on its own exact --no-build flag', () => {
    const installs = `
jobs:
  publish:
    steps:
      - name: Isolation only
        env:
          UV_INDEX_COGNOVIS_PASSWORD: \${{ secrets.PACKAGE_REGISTRY_READ_TOKEN }}
        run: uv tool install --no-build-isolation cognovis-core-tools
      - name: One safe, one source build
        run: |
          uv tool install \\
            --no-build \\
            cognovis-core-tools
          uv tool install other-tool
      - name: Chained on one line
        run: uv tool install --no-build first && uv tool install second; uv tool install --no-build third
`
    assert.deepEqual(workflowViolations('release.yml', installs), [
      'release.yml job publish: "Isolation only" runs build or dependency code in a job that reads a secret',
      'release.yml job publish: "One safe, one source build" runs build or dependency code in a job that reads a secret',
      'release.yml job publish: "Chained on one line" runs build or dependency code in a job that reads a secret',
    ])
  })

  it('requires the hash check in an earlier step and NPM_TOKEN bound to steps only', () => {
    const sameStep = `
jobs:
  publish:
    steps:
      - name: Publish then check
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: |
          ccore release publish-npm "$SDK_TARBALL"
          printf '%s  %s\\n' "$SDK_SHA256" "$SDK_TARBALL" | sha256sum --check --strict
`
    assert.deepEqual(workflowViolations('release.yml', sameStep), [
      'release.yml job publish: "Publish then check" publishes before a sha256sum --check of the archives',
    ])
    const inherited = `
jobs:
  publish:
    env:
      NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
    steps:
      - run: printf '%s  %s\\n' "$SDK_SHA256" "$SDK_TARBALL" | sha256sum --check --strict
      - run: ccore release publish-npm "$SDK_TARBALL"
`
    assert.deepEqual(workflowViolations('release.yml', inherited), [
      'release.yml job publish: NPM_TOKEN is bound for the whole job or workflow; bind it to the publish step only',
    ])
  })

  it('holds for the workflows of this repository', () => {
    assert.deepEqual(repositoryWorkflowViolations(), [])
  })
})
