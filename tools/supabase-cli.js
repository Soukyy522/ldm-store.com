'use strict';

const os = require('os');
const { spawnSync } = require('child_process');

function cleanNpmNoise(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => {
      const s = line.trim();
      if (/^npm (notice|warn)\b/i.test(s)) return false;
      if (/^\(node:\d+\) \[DEP0190\] DeprecationWarning:/i.test(s)) return false;
      if (/^\(Use `node --trace-deprecation/i.test(s)) return false;
      return true;
    })
    .join(os.EOL)
    .trim();
}

function quoteCmdArg(value) {
  const s = String(value);
  if (/^[A-Za-z0-9_./:\\=@,+-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function runSupabase(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const capture = options.capture === true;
  const echo = options.echo !== false;

  let result;

  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    const command = ['npx.cmd', '--yes', 'supabase', ...args]
      .map(quoteCmdArg)
      .join(' ');

    result = spawnSync(
      comspec,
      ['/d', '/s', '/c', command],
      {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['inherit', 'pipe', 'pipe']
      }
    );
  } else {
    result = spawnSync(
      'npx',
      ['--yes', 'supabase', ...args],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe']
      }
    );
  }

  if (result.error) {
    throw new Error('Gagal menjalankan Supabase CLI: ' + result.error.message);
  }

  const stdout = cleanNpmNoise(result.stdout);
  const stderr = cleanNpmNoise(result.stderr);

  if (!capture && echo) {
    if (stdout) process.stdout.write(stdout + os.EOL);
    if (stderr) process.stderr.write(stderr + os.EOL);
  }

  if (result.status !== 0) {
    const details = [stdout, stderr].filter(Boolean).join(os.EOL);
    throw new Error(
      'Supabase CLI gagal dengan exit code ' + result.status + '.' + os.EOL +
      'Perintah: supabase ' + args.join(' ') +
      (details ? os.EOL + details : '')
    );
  }

  return { stdout, stderr };
}

module.exports = {
  cleanNpmNoise,
  runSupabase
};
