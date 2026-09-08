'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const DEFAULT_ORIGIN = 'https://soukyy522.github.io';
const DEFAULT_PUBLIC_URL = 'https://soukyy522.github.io/ldm-store.com';
const DEFAULT_WA = '6287874352468';

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'license-authority-v2');

const FUNCTIONS = [
  'ldm-license-v2',
  'ldm-license-admin-v2',
  'ldm-public-checkout-v2',
  'ldm-lynk-order',
  'ldm-lynk-webhook'
];

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

function secretExists(name) {
  const result = runSupabase(
    ['secrets', 'list', '--project-ref', PROJECT_REF],
    {
      cwd: AUTH_DIR,
      capture: true,
      echo: false
    }
  );

  const plain = `${result.stdout}\n${result.stderr}`;
  return plain.toUpperCase().includes(String(name).toUpperCase());
}

function writeTempEnv(values, prefix) {
  const file = path.join(
    os.tmpdir(),
    `${prefix}-${crypto.randomBytes(8).toString('hex')}.env`
  );

  const body =
    Object.entries(values)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('\n') + '\n';

  fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
  return file;
}

function setSecrets(values) {
  const file = writeTempEnv(values, 'ldm-secrets');

  try {
    runSupabase(
      [
        'secrets',
        'set',
        '--env-file',
        file,
        '--project-ref',
        PROJECT_REF
      ],
      { cwd: AUTH_DIR }
    );
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (_) {}
  }
}

function validateOrigin(value) {
  const u = new URL(value);

  if (u.protocol !== 'https:') {
    throw new Error('Allowed Origin wajib menggunakan https://');
  }

  return u.origin;
}

function validatePublicUrl(value) {
  const u = new URL(value);

  if (u.protocol !== 'https:') {
    throw new Error('Public App URL wajib menggunakan https://');
  }

  return value.replace(/\/+$/, '');
}

function validateWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!/^62\d{7,15}$/.test(digits)) {
    throw new Error(
      'WhatsApp Support harus format Indonesia, contoh 6287874352468.'
    );
  }

  return digits;
}

function assertProjectFiles() {
  if (!fs.existsSync(AUTH_DIR)) {
    throw new Error(`Folder tidak ditemukan: ${AUTH_DIR}`);
  }

  for (const fn of FUNCTIONS) {
    const indexFile = path.join(
      AUTH_DIR,
      'supabase',
      'functions',
      fn,
      'index.ts'
    );

    if (!fs.existsSync(indexFile)) {
      throw new Error(`Edge Function tidak lengkap: ${indexFile}`);
    }
  }
}

async function main() {
  console.log('');
  console.log('LocDailyMar V28.1.7 - LYNK AUTO PROCESS HARDENING');
  console.log('Project Ref: ' + PROJECT_REF);
  console.log('');
  console.log(
    'V28.1.7 tidak menjalankan "supabase projects list" dan tidak membutuhkan "supabase link".'
  );
  console.log(
    'Semua operasi langsung memakai --project-ref agar tidak muncul warning project ref lokal.'
  );
  console.log('');

  assertProjectFiles();

  const sqlOk = (
    await ask(
      'Ketik YA jika SQL-15 V28 dan SQL-16 V28.1 sudah dijalankan pada License Authority'
    )
  ).toUpperCase();

  if (sqlOk !== 'YA') {
    console.log(
      'Deploy dibatalkan. Jalankan SQL-15 lalu SQL-16 terlebih dahulu.'
    );
    process.exitCode = 2;
    return;
  }

  let newToken = null;
  let tokenExists = false;

  console.log('Memeriksa akses project dan secret Supabase...');

  try {
    tokenExists = secretExists('LYNK_WEBHOOK_TOKEN');
    console.log(
      'Akses project Supabase berhasil diverifikasi menggunakan --project-ref.'
    );
  } catch (err) {
    throw new Error(
      'Tidak dapat mengakses project Supabase ' +
        PROJECT_REF +
        '. Pastikan sudah login dengan perintah:' +
        os.EOL +
        'npx.cmd --yes supabase login' +
        os.EOL +
        os.EOL +
        (err.message || err)
    );
  }

  if (!tokenExists) {
    console.log(
      'LYNK_WEBHOOK_TOKEN belum ada. Membuat token stabil pertama kali...'
    );

    newToken = crypto.randomBytes(32).toString('hex');

    setSecrets({
      LYNK_WEBHOOK_TOKEN: newToken,
      LYNK_AUTO_PROCESS: 'true',
      LYNK_ASSUME_SUCCESS_WEBHOOK: 'true',
      LYNK_WEBHOOK_SUCCESS_VALUES:
        'success,successful,paid,settlement,completed,complete,payment_success,payment_successful'
    });

    console.log('Secret awal sudah dikirim ke Supabase.');

    try {
      if (secretExists('LYNK_WEBHOOK_TOKEN')) {
        console.log(
          'LYNK_WEBHOOK_TOKEN terdeteksi pada secrets list.'
        );
      } else {
        console.log(
          'PERINGATAN: secrets list belum menampilkan token, tetapi secrets set selesai tanpa error.'
        );
      }
    } catch (_) {
      console.log(
        'PERINGATAN: verifikasi secrets list tidak tersedia. Token baru tetap ditampilkan di akhir deploy.'
      );
    }
  } else {
    console.log(
      'LYNK_WEBHOOK_TOKEN sudah ada. Token dipertahankan dan TIDAK dirotasi.'
    );
  }

  console.log('Mengaktifkan Lynk Auto Process V28.1.7...');
  setSecrets({
    LYNK_AUTO_PROCESS: 'true',
    LYNK_ASSUME_SUCCESS_WEBHOOK: 'true',
    LYNK_WEBHOOK_SUCCESS_VALUES: 'success,successful,paid,settlement,completed,complete,payment_success,payment_successful'
  });

  const origin = validateOrigin(
    await ask('Allowed Origin', DEFAULT_ORIGIN)
  );

  const publicUrl = validatePublicUrl(
    await ask('Public App URL', DEFAULT_PUBLIC_URL)
  );

  const supportWa = validateWhatsApp(
    await ask('WhatsApp Support', DEFAULT_WA)
  );

  console.log('');
  console.log('Menyimpan konfigurasi runtime...');

  setSecrets({
    LDM2_ALLOWED_ORIGINS: origin,
    LDM2_CHECKOUT_ALLOWED_ORIGINS: origin,
    LDM2_ADMIN_ALLOWED_ORIGINS: origin,
    LDM2_ALLOW_NULL_ORIGIN: 'false',
    LDM_APP_PUBLIC_URL: publicUrl,
    LDM_GUIDE_URL: `${publicUrl}/panduan.html`,
    LDM_SUPPORT_WHATSAPP: supportWa
  });

  console.log('');
  console.log('Deploy Edge Functions...');

  for (const fn of FUNCTIONS) {
    console.log('');
    console.log('>>> Deploy ' + fn);

    runSupabase(
      [
        'functions',
        'deploy',
        fn,
        '--project-ref',
        PROJECT_REF
      ],
      { cwd: AUTH_DIR }
    );
  }

  console.log('');
  console.log(
    '============================================================'
  );
  console.log('DEPLOY SELESAI');
  console.log(
    '============================================================'
  );
  console.log(
    'LYNK_WEBHOOK_TOKEN tidak diubah jika sebelumnya sudah ada.'
  );
  console.log(
    'LYNK_AUTO_PROCESS dipastikan true oleh V28.1.7.'
  );

  if (newToken) {
    const webhookUrl =
      `https://${PROJECT_REF}.supabase.co/functions/v1/` +
      `ldm-lynk-webhook?token=${newToken}`;

    console.log('');
    console.log('WEBHOOK URL BARU UNTUK LYNK.ID:');
    console.log(webhookUrl);
    console.log('');
    console.log(
      'Copy URL lengkap di atas dan pasang pada dashboard Lynk.id.'
    );
    console.log(
      'Jangan simpan token tersebut di GitHub atau file frontend.'
    );
    console.log(
      'LYNK_AUTO_PROCESS sudah true. Matching tetap memakai validasi status + nominal + kandidat order unik.'
    );
  } else {
    console.log('');
    console.log(
      'Gunakan URL webhook yang sudah terpasang pada Lynk.id.'
    );
    console.log(
      'Jika token lama hilang/tidak cocok, gunakan ROTATE-WEBHOOK-TOKEN.cmd.'
    );
  }
}

main().catch((err) => {
  console.error('');
  console.error('DEPLOY GAGAL:');
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
