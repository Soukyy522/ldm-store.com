'use strict';

const https = require('https');
const path = require('path');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'license-authority-v2');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'user-agent': 'LocDailyMar-V28.1.6-HealthCheck'
          }
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              body
            })
          );
        }
      )
      .on('error', reject);
  });
}

(async () => {
  console.log(
    'LocDailyMar V28.1.6 - LYNK WEBHOOK CHECK'
  );
  console.log('');

  try {
    const result = runSupabase(
      [
        'secrets',
        'list',
        '--project-ref',
        PROJECT_REF
      ],
      {
        cwd: AUTH_DIR,
        capture: true,
        echo: false
      }
    );

    const list = `${result.stdout}\n${result.stderr}`;

    console.log('Secret names:');
    console.log(
      '- LYNK_WEBHOOK_TOKEN: ' +
        (/\bLYNK_WEBHOOK_TOKEN\b/i.test(list)
          ? 'ADA'
          : 'TIDAK ADA')
    );
    console.log(
      '- LYNK_AUTO_PROCESS: ' +
        (/\bLYNK_AUTO_PROCESS\b/i.test(list)
          ? 'ADA'
          : 'TIDAK ADA')
    );
    console.log('');
  } catch (err) {
    console.log(
      'Tidak dapat membaca secrets list: ' +
        (err.message || err)
    );
    console.log('');
  }

  const url =
    `https://${PROJECT_REF}.supabase.co/functions/v1/` +
    'ldm-lynk-webhook';

  const response = await get(url);

  console.log('GET ' + url);
  console.log('HTTP ' + response.status);
  console.log(response.body);
})().catch((err) => {
  console.error(
    'CHECK GAGAL: ' + (err.message || err)
  );
  process.exitCode = 1;
});
