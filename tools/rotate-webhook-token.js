'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'license-authority-v2');

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

(async () => {
  console.log(
    'LocDailyMar V28.1.6 - ROTATE LYNK WEBHOOK TOKEN'
  );
  console.log(
    'Gunakan hanya jika token hilang, bocor, atau URL webhook tidak cocok.'
  );
  console.log('');

  const confirm = (
    await ask('Ketik ROTATE untuk mengganti token')
  ).toUpperCase();

  if (confirm !== 'ROTATE') {
    console.log('Dibatalkan. Token tidak diubah.');
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');

  const temp = path.join(
    os.tmpdir(),
    `ldm-rotate-${crypto.randomBytes(8).toString('hex')}.env`
  );

  fs.writeFileSync(
    temp,
    `LYNK_WEBHOOK_TOKEN=${token}\n`,
    'utf8'
  );

  try {
    runSupabase(
      [
        'secrets',
        'set',
        '--env-file',
        temp,
        '--project-ref',
        PROJECT_REF
      ],
      { cwd: AUTH_DIR }
    );
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (_) {}
  }

  console.log('');
  console.log('WEBHOOK URL BARU:');
  console.log(
    `https://${PROJECT_REF}.supabase.co/functions/v1/` +
      `ldm-lynk-webhook?token=${token}`
  );
  console.log('');
  console.log(
    'Ganti URL webhook lama pada dashboard Lynk.id dengan URL baru di atas.'
  );
  console.log(
    'LYNK_AUTO_PROCESS tidak diubah oleh script rotate ini.'
  );
})().catch((err) => {
  console.error(
    'ROTATE GAGAL: ' + (err.message || err)
  );
  process.exitCode = 1;
});
