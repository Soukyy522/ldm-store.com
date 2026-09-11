'use strict';

const path=require('path');
const {runSupabase}=require('./supabase-cli');

const PROJECT_REF='vplweadbeujidsoponrl';
const ROOT=path.resolve(__dirname,'..');
const AUTH_DIR=path.join(ROOT,'license-authority-v2');

try{
  console.log('');
  console.log('LocDailyMar V28.1.9.4 - DEPLOY RESEND RETRY FORCE FIX');
  console.log('');
  console.log('Deploy ldm-resend-test.');
  console.log('Shared ldm-license-delivery.ts ikut dibundle.');
  console.log('Database dan secret tidak diubah.');
  console.log('');

  runSupabase(
    ['functions','deploy','ldm-resend-test','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('Deploy ldm-lynk-webhook agar delivery otomatis memakai shared terbaru.');
  runSupabase(
    ['functions','deploy','ldm-lynk-webhook','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('DEPLOY SELESAI.');
  console.log('Jalankan CHECK-RESEND.cmd lalu RETRY-PAID-EMAIL.cmd.');
}catch(e){
  console.error('');
  console.error('DEPLOY GAGAL: '+(e.message||e));
  process.exitCode=1;
}
