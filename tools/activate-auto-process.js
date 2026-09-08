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

function ask(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const suffix = defaultValue ? ` [${defaultValue}]` : '';

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      const value = String(answer || '').trim();
      resolve(value || defaultValue);
    });
  });
}

function setSecrets(values) {
  const temp = path.join(
    os.tmpdir(),
    `ldm-activate-${crypto.randomBytes(8).toString('hex')}.env`
  );

  const body =
    Object.entries(values)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\n') + '\n';

  fs.writeFileSync(temp, body, 'utf8');

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
}

function validatePath(value, label, optional = false) {
  const v = String(value || '').trim();

  if (!v && optional) return '';
  if (!v) throw new Error(`${label} wajib diisi.`);

  if (!/^[A-Za-z0-9_$.[\]-]+$/.test(v)) {
    throw new Error(
      `${label} hanya boleh berisi nama field/path JSON sederhana.`
    );
  }

  return v;
}

(async () => {
  console.log('');
  console.log(
    'LocDailyMar V28.1.6 - ACTIVATE LYNK AUTO PROCESS'
  );
  console.log(
    'Jalankan hanya setelah satu payload webhook Lynk asli sudah dicapture dan diperiksa.'
  );
  console.log('');

  const confirm = (
    await ask('Ketik AKTIFKAN untuk melanjutkan')
  ).toUpperCase();

  if (confirm !== 'AKTIFKAN') {
    console.log(
      'Dibatalkan. Tidak ada secret yang diubah.'
    );
    return;
  }

  const transactionPath = validatePath(
    await ask('JSON path Transaction ID'),
    'Transaction ID path'
  );

  const statusPath = validatePath(
    await ask('JSON path Status'),
    'Status path'
  );

  const amountPath = validatePath(
    await ask('JSON path Amount'),
    'Amount path'
  );

  const emailPath = validatePath(
    await ask('JSON path Email customer'),
    'Email path'
  );

  const productPath = validatePath(
    await ask('JSON path Product, boleh kosong'),
    'Product path',
    true
  );

  const successValues = await ask(
    'Nilai status sukses dipisah koma',
    'success,paid,settlement,completed'
  );

  const values = {
    LYNK_AUTO_PROCESS: 'true',
    LYNK_WEBHOOK_TRANSACTION_ID_PATH:
      transactionPath,
    LYNK_WEBHOOK_STATUS_PATH: statusPath,
    LYNK_WEBHOOK_AMOUNT_PATH: amountPath,
    LYNK_WEBHOOK_EMAIL_PATH: emailPath,
    LYNK_WEBHOOK_SUCCESS_VALUES: successValues
  };

  if (productPath) {
    values.LYNK_WEBHOOK_PRODUCT_PATH = productPath;
  }

  setSecrets(values);

  console.log('');
  console.log(
    'LYNK_AUTO_PROCESS=true sudah disimpan.'
  );
  console.log(
    'Mapping webhook juga sudah disimpan.'
  );
})().catch((err) => {
  console.error(
    'AKTIVASI GAGAL: ' + (err.message || err)
  );
  process.exitCode = 1;
});
