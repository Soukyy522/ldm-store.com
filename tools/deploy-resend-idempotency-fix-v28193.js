'use strict';

const path=require('path');
const {runSupabase}=require('./supabase-cli');

const PROJECT_REF='vplweadbeujidsoponrl';
const ROOT=path.resolve(__dirname,'..');
const AUTH_DIR=path.join(ROOT,'license-authority-v2');

try{
  console.log('');
  console.log('LocDailyMar V28.1.9.3 - DEPLOY RESEND TEST IDEMPOTENCY FIX');
  console.log('');
  console.log('Deploy hanya function ldm-resend-test.');
  console.log('RESEND_API_KEY tidak diubah.');
  console.log('Lynk webhook tidak diubah.');
  console.log('Database tidak diubah.');
  console.log('');

  runSupabase(
    ['functions','deploy','ldm-resend-test','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('DEPLOY SELESAI.');
  console.log('Sekarang jalankan TEST-RESEND-EMAIL.cmd lagi.');
}catch(e){
  console.error('');
  console.error('DEPLOY GAGAL: '+(e.message||e));
  process.exitCode=1;
}
