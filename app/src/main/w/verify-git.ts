// Does `isomorphic-git` survive OUR build, not just Node's?
//
// D34 chose it on structural grounds and recorded a caveat: "library
// maintenance status and API completeness change faster than my knowledge of
// them". The registry answers maintenance — 474 releases, 41 this year, last
// one yesterday. This answers the other half, in the environment that counts:
// electron-vite bundles main to CJS and Electron supplies its own Node, and a
// pure-JS library is only pure-JS until a bundler disagrees.
//
// Kept rather than deleted because the question comes back on every Electron
// upgrade, and it costs one env var to re-ask.

import git from 'isomorphic-git'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function verifyGit(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), 'tephra-git-electron-'))
  const say = (name: string, ok: boolean, detail = ''): boolean => {
    console.log(`VERIFY-GIT ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
    return ok
  }
  const author = { name: 'Tephra', email: 'tephra@localhost' }
  let all = true

  try {
    await git.init({ fs, dir, defaultBranch: 'main' })
    all = say('init', fs.existsSync(join(dir, '.git', 'HEAD'))) && all

    const rel = 'notebook.stream/2026/08/2026-08-22.md'
    await mkdir(join(dir, 'notebook.stream', '2026', '08'), { recursive: true })
    await writeFile(join(dir, rel), 'A paragraph written from the main process.\n')
    await git.add({ fs, dir, filepath: rel })
    const oid = await git.commit({ fs, dir, author, message: 'from Electron' })
    all = say('commit', oid.length === 40, oid.slice(0, 8)) && all

    const blob = new TextDecoder().decode((await git.readBlob({ fs, dir, oid, filepath: rel })).blob)
    all = say('read a blob', blob.includes('from the main process')) && all

    // THE acceptance test (D34): a repository only Tephra can read defeats the
    // entire reason git was chosen over a store of our own.
    let readable = false
    let detail = ''
    try {
      execFileSync('git', ['-C', dir, 'fsck', '--strict'], { encoding: 'utf8' })
      detail = execFileSync('git', ['-C', dir, 'log', '--oneline'], { encoding: 'utf8' }).trim()
      readable = detail.includes('from Electron')
    } catch (err) {
      detail = String(err).slice(0, 120)
    }
    all = say('standard git reads it', readable, detail) && all

    // Interop runs BOTH ways. A notebook is a visible directory (D5) that its
    // owner may reasonably run git in themselves, so "we can read what the git
    // binary wrote" is as load-bearing as the reverse.
    const sh = (...args: string[]): string =>
      execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
    try {
      all = say('working tree clean after our commit', sh('status', '--porcelain') === '') && all

      await writeFile(join(dir, rel), 'Edited by hand and committed with the git binary.\n')
      sh('add', rel)
      execFileSync(
        'git',
        ['-C', dir, '-c', 'user.name=Human', '-c', 'user.email=h@localhost', 'commit', '-m', 'By hand'],
        { encoding: 'utf8' },
      )
      const log = await git.log({ fs, dir })
      all = say('we read a commit made by the git binary', log.length === 2 && log[0]?.commit.message.startsWith('By hand') === true) && all

      const theirs = new TextDecoder().decode(
        (await git.readBlob({ fs, dir, oid: log[0]?.oid ?? '', filepath: rel })).blob,
      )
      all = say('we read a blob written by the git binary', theirs.includes('with the git binary')) && all

      // Recovery: the thing the whole milestone is for.
      const recovered = new TextDecoder().decode((await git.readBlob({ fs, dir, oid, filepath: rel })).blob)
      all = say('earlier text recoverable after being overwritten', recovered.includes('from the main process')) && all

      // And the machine-local directory must never be committed (D7).
      await writeFile(join(dir, '.gitignore'), '.tephra/\n')
      await mkdir(join(dir, '.tephra'), { recursive: true })
      await writeFile(join(dir, '.tephra', 'wal'), 'machine-local')
      all = say('.tephra/ is ignored', await git.isIgnored({ fs, dir, filepath: '.tephra/wal' })) && all
    } catch (err) {
      all = say('interop', false, err instanceof Error ? err.message : String(err))
    }
  } catch (err) {
    all = say('threw', false, err instanceof Error ? err.message : String(err))
  }

  console.log(`VERIFY-GIT ${all ? 'ALL PASS' : 'FAILED'}`)
  return all
}
