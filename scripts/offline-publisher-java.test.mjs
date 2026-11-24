import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const SHIM = 'scripts/offline-publisher-bin/java'
const FLAG = '-XX:-UseBASE64Intrinsics'
const TX = 'https://tx.health-samurai.io/fhir'

function shimEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  if (!Object.hasOwn(extra, 'JAVA_TOOL_OPTIONS')) delete env.JAVA_TOOL_OPTIONS
  return env
}

function recordedArgs(args, envExtra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'publisher-java-'))
  const recorder = join(dir, 'java')
  const log = join(dir, 'argv')
  writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`)
  chmodSync(recorder, 0o755)
  try {
    const result = spawnSync(SHIM, args, {
      env: shimEnv({ PUBLISHER_JAVA: recorder, ...envExtra }),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return readFileSync(log, 'utf8').split('\n').filter(Boolean)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('offline Publisher java shim', () => {
  it('passes -XX:-UseBASE64Intrinsics on every exec of the real java', () => {
    const source = readFileSync(SHIM, 'utf8')
    const execLines = source.split('\n').filter((line) => /exec "\$PUBLISHER_JAVA"/.test(line))
    assert.equal(execLines.length, 2)
    for (const line of execLines) {
      assert.ok(line.includes('"$JAVA4SHELL_MITIGATION"'), `exec path missing JAVA4SHELL_MITIGATION: ${line}`)
    }
    assert.match(source, /CVE-2026-114938/)
    assert.match(source, /21\.0\.13\.1/)
  })

  it('injects the flag on a non-Publisher probe', () => {
    const args = recordedArgs(['-XX:+PrintFlagsFinal', '-version'])
    assert.equal(args[0], FLAG)
    assert.deepEqual(args.slice(1), ['-XX:+PrintFlagsFinal', '-version'])
  })

  it('injects the flag on a Publisher invocation that still needs -tx', () => {
    const args = recordedArgs(['-jar', 'input-cache/publisher.jar', '-ig', '.'])
    assert.equal(args[0], FLAG)
    assert.equal(args[1], '-Xmx8g')
    assert.ok(args.includes('-tx'))
    assert.ok(args.includes(TX))
  })

  it('injects the flag on a Publisher invocation that already pins -tx', () => {
    const args = recordedArgs(['-jar', './input-cache/publisher.jar', '-tx', TX])
    assert.equal(args[0], FLAG)
    assert.equal(args[1], '-Xmx8g')
    assert.deepEqual(args.slice(-2), ['-tx', TX])
  })

  it('injects the flag on the headless exec path', () => {
    const args = recordedArgs(['-jar', 'input-cache/publisher.jar'], {
      JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true',
    })
    assert.equal(args[0], FLAG)
    assert.ok(args.includes('-Djava.awt.headless=true'))
    assert.ok(args.includes('-Dapple.awt.UIElement=true'))
  })

  it('still fakes java -version for fhirscripts without execing the real JVM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'publisher-java-version-'))
    const recorder = join(dir, 'java')
    const log = join(dir, 'argv')
    writeFileSync(recorder, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`)
    chmodSync(recorder, 0o755)
    try {
      const result = spawnSync(SHIM, ['-version'], {
        env: shimEnv({ PUBLISHER_JAVA: recorder }),
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stderr, /openjdk version "17"/)
      assert.throws(() => readFileSync(log, 'utf8'), /ENOENT/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('makes a real JVM report UseBASE64Intrinsics = false', (t) => {
    let realJava = ''
    try {
      realJava = execFileSync('/bin/sh', ['-c', 'command -v java'], { encoding: 'utf8' }).trim()
    } catch {
      t.skip('no java on PATH')
      return
    }
    if (!realJava) {
      t.skip('no java on PATH')
      return
    }
    const output = execFileSync(SHIM, ['-XX:+PrintFlagsFinal', '-version'], {
      env: shimEnv({ PUBLISHER_JAVA: realJava }),
      encoding: 'utf8',
    })
    assert.match(output, /UseBASE64Intrinsics\s+= false/)
  })
})
