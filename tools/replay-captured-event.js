'use strict';

const readline = require('readline');
const https = require('https');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const ENDPOINT =
  `https://${PROJECT_REF}.supabase.co/functions/v1/ldm-lynk-webhook`;

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question + ': ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function normalizeTokenInput(input) {
  let value = String(input || '').trim();

  // Hapus quote jika user paste "TOKEN" atau 'TOKEN'.
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
     (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }

  // Izinkan user paste URL webhook lengkap.
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const token = url.searchParams.get('token') || '';
      return {
        token: token.trim(),
        source: 'webhook_url'
      };
    } catch (_) {
      return { token: '', source: 'invalid_url' };
    }
  }

  // Izinkan paste ?token=xxxxx / token=xxxxx.
  const prefixed = value.match(/^(?:\?|\&)?token=(.+)$/i);
  if (prefixed) {
    value = prefixed[1].split('&')[0].trim();
  }

  return {
    token: value,
    source: 'raw_token'
  };
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));

    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': data.length,
        'user-agent': 'LocDailyMar-V28.1.7.1-Replay'
      }
    }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => out += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(out || '{}');
        } catch (_) {
          parsed = { raw: out };
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('LocDailyMar V28.1.7.1 - REPLAY CAPTURED LYNK EVENT');
  console.log('');
  console.log('Input token sekarang boleh berupa:');
  console.log('- token mentah');
  console.log('- ?token=...');
  console.log('- token=...');
  console.log('- URL webhook Lynk.id lengkap');
  console.log('');
  console.log('Token tidak dicetak kembali ke terminal.');
  console.log('');

  const eventKey = await ask(
    'Event Key dari public.ldm2_lynk_events'
  );

  if (!eventKey) {
    throw new Error('Event Key wajib diisi.');
  }

  const input = await ask(
    'Paste token ATAU URL webhook Lynk.id yang saat ini aktif'
  );

  const normalized = normalizeTokenInput(input);
  const token = normalized.token;

  if (!token || token.length < 32) {
    throw new Error(
      'Token tidak ditemukan/terlalu pendek. ' +
      'Jika memakai URL, pastikan URL memiliki ?token=...'
    );
  }

  const confirm = (
    await ask('Ketik REPLAY untuk memproses ulang event ini')
  ).toUpperCase();

  if (confirm !== 'REPLAY') {
    console.log('Dibatalkan.');
    return;
  }

  const replayUrl =
    `${ENDPOINT}?token=${encodeURIComponent(token)}&mode=replay`;

  const result = await postJson(
    replayUrl,
    { event_key: eventKey }
  );

  console.log('');
  console.log('HTTP', result.status);
  console.log(JSON.stringify(result.data, null, 2));

  if (result.status === 401) {
    console.log('');
    console.log('DIAGNOSIS: token yang dimasukkan TIDAK sama dengan');
    console.log('LYNK_WEBHOOK_TOKEN yang aktif di Supabase.');
    console.log('');
    console.log('Ini bukan error event_key dan bukan error auto_process.');
    console.log('Jika token saat ini sudah tidak diketahui, lakukan ROTATE');
    console.log('sekali, update URL webhook Lynk.id, lalu replay memakai');
    console.log('token baru yang sama.');
    process.exitCode = 2;
    return;
  }

  if (
    result.status < 200 ||
    result.status >= 300 ||
    result.data?.ok === false
  ) {
    process.exitCode = 2;
    return;
  }

  console.log('');
  console.log('REPLAY diterima oleh endpoint.');
})().catch((error) => {
  console.error('');
  console.error(
    'REPLAY GAGAL: ' + (error.message || error)
  );
  process.exitCode = 1;
});
