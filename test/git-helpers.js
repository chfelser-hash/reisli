// Hilfen für Tests mit Git: ein lokales Repo als «GitHub» (origin) und ein Klon wie auf der NAS
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.org' } }).trim();

/** «origin» mit den Versionen (je Commit + Tag) und ein Klon, der auf der ersten Version steht */
export function makeRepos(versions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reisli-upd-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const clone = path.join(dir, 'nas');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, work);
  let log = '# Änderungen\n';
  for (const [i, v] of versions.entries()) {
    log = log.replace('# Änderungen\n', `# Änderungen\n\n## ${v} – 2030-01-0${i + 1}\n- Änderung in ${v}\n`);
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ version: v }));
    fs.writeFileSync(path.join(work, 'CHANGELOG.md'), log);
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', v);
    git(work, 'tag', 'v' + v);
    if (i === 0) {
      git(work, 'push', '-q', 'origin', 'HEAD:main', '--tags');
      git(dir, 'clone', '-q', origin, clone);
    }
  }
  git(work, 'push', '-q', 'origin', 'HEAD:main', '--tags');
  const version = () => JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8')).version;
  return { dir, clone, version, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

