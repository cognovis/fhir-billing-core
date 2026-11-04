// Release-path hardening rules for the GitHub Actions workflows (CODING_STANDARDS.md, "Security").
// `bun scripts/workflow-hardening.mjs` checks every workflow; scripts/workflow-hardening.test.mjs runs
// the same check in `npm test` and proves it on the release workflow this repository used to ship.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PIPED_INSTALLER = /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/
// Commands that execute repository or dependency code. `npm view` only reads registry metadata, and
// `uv tool install --no-build` installs a prebuilt wheel without running a build backend.
const RUNS_BUILD_CODE = /\b(npm\s+(ci|install|i|test|run|pack|exec)|npx|bun|node|tsc)\b/

function runsBuildCode(run) {
  if (RUNS_BUILD_CODE.test(run)) return true
  // Each `uv tool install` command, its continuation lines joined and split at shell command separators, needs the exact `--no-build` flag.
  const commands = run.replace(/\\\n/g, ' ').split(/\n|;|&&|\|\|?/)
  return commands.some((command) => /\buv\s+tool\s+install\b/.test(command) && !/(^|\s)--no-build(\s|$)/.test(command))
}
const SHA_PIN = /@[0-9a-f]{40}$/

function steps(job) {
  return Array.isArray(job?.steps) ? job.steps : []
}

/**
 * The violations of one workflow:
 * - no `run:` pipes a downloaded script into a shell;
 * - a job that reads a repository secret runs no build or dependency code and no local action;
 * - every `actions/checkout` in a job that reads a secret or may write contents sets `persist-credentials: false`;
 * - every action outside the `actions/` organisation is pinned by a full commit SHA;
 * - NPM_TOKEN is bound to steps only, each after a step that ran `sha256sum --check` on the archives.
 */
export function workflowViolations(name, text) {
  const workflow = Bun.YAML.parse(text)
  const violations = []
  const writesByDefault = workflow?.permissions === 'write-all' || workflow?.permissions?.contents === 'write'
  // A workflow-level `env` secret reaches every job.
  const everyJobHoldsSecret = JSON.stringify(workflow?.env ?? {}).includes('secrets.')
  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    const where = `${name} job ${jobName}`
    const holdsSecret = everyJobHoldsSecret || JSON.stringify(job).includes('secrets.')
    const writes = job?.permissions === undefined ? writesByDefault : job.permissions === 'write-all' || job.permissions?.contents === 'write'
    if (JSON.stringify([workflow?.env ?? {}, job?.env ?? {}]).includes('secrets.NPM_TOKEN')) {
      violations.push(`${where}: NPM_TOKEN is bound for the whole job or workflow; bind it to the publish step only`)
    }
    // Only a check in an earlier, finished step counts: within one step the publish may run first.
    let hashesChecked = false
    for (const step of steps(job)) {
      const label = step.name ?? step.uses ?? String(step.run ?? 'step').trim()
      if (typeof step.run === 'string' && PIPED_INSTALLER.test(step.run)) violations.push(`${where}: "${label}" pipes a download into a shell`)
      if (holdsSecret && typeof step.run === 'string' && runsBuildCode(step.run)) violations.push(`${where}: "${label}" runs build or dependency code in a job that reads a secret`)
      if (JSON.stringify(step).includes('secrets.NPM_TOKEN') && !hashesChecked) violations.push(`${where}: "${label}" publishes before a sha256sum --check of the archives`)
      if (typeof step.run === 'string' && /\bsha256sum\s+--check\b/.test(step.run)) hashesChecked = true
      if (holdsSecret && typeof step.uses === 'string' && step.uses.startsWith('./')) violations.push(`${where}: ${step.uses} runs repository code in a job that reads a secret`)
      if (typeof step.uses === 'string') {
        if (!step.uses.startsWith('actions/') && !step.uses.startsWith('./') && !SHA_PIN.test(step.uses)) violations.push(`${where}: ${step.uses} is not pinned by a commit SHA`)
        if (step.uses.startsWith('actions/checkout@') && (holdsSecret || writes) && step.with?.['persist-credentials'] !== false) {
          violations.push(`${where}: actions/checkout keeps its token in .git/config; set persist-credentials: false`)
        }
      }
    }
  }
  return violations
}

export function repositoryWorkflowViolations(directory = '.github/workflows') {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .flatMap((file) => workflowViolations(file, readFileSync(join(directory, file), 'utf8')))
}

if (import.meta.main) {
  const violations = repositoryWorkflowViolations()
  for (const violation of violations) console.error(violation)
  process.exit(violations.length === 0 ? 0 : 1)
}
