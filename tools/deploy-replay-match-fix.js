'use strict';

const path = require('path');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'license-authority-v2');

try {
  console.log('');
  console.log('LocDailyMar V28.1.7.2 - DEPLOY REPLAY MATCH FIX');
  console.log('Project Ref: ' + PROJECT_REF);
  console.log('');
  console.log('Deploy hanya ldm-lynk-webhook.');
  console.log('Shared ldm-lynk-operations.ts ikut dibundle otomatis.');
  console.log('Secret/token tidak diubah.');
  console.log('');

  runSupabase(
    ['functions', 'deploy', 'ldm-lynk-webhook', '--project-ref', PROJECT_REF],
    { cwd: AUTH_DIR }
  );

  console.log('');
  console.log('DEPLOY REPLAY MATCH FIX SELESAI.');
  console.log('Jalankan CHECK-LYNK-AUTO-READY.cmd lalu replay event lama.');
} catch (err) {
  console.error('');
  console.error('DEPLOY GAGAL: ' + (err.message || err));
  process.exitCode = 1;
}
