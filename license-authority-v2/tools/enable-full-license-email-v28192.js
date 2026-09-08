'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const readline=require('readline');
const {runSupabase}=require('./supabase-cli');

const PROJECT_REF='vplweadbeujidsoponrl';
const ROOT=path.resolve(__dirname,'..');
const AUTH_DIR=path.join(ROOT,'license-authority-v2');

function ask(q){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  return new Promise(r=>rl.question(q+': ',a=>{rl.close();r(String(a||'').trim())}));
}

function setSecret(){
  const f=path.join(os.tmpdir(),`ldm-full-license-email-${crypto.randomBytes(6).toString('hex')}.env`);
  fs.writeFileSync(f,'LDM_RESEND_INCLUDE_SECRETS=true\n','utf8');
  try{
    runSupabase(['secrets','set','--env-file',f,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR});
  }finally{
    try{fs.unlinkSync(f)}catch(_){}
  }
}

(async()=>{
  console.log('');
  console.log('LocDailyMar V28.1.9.2 - FULL LICENSE DATA EMAIL');
  console.log('');
  console.log('Email pembayaran akan menampilkan secara lengkap:');
  console.log('- License Key');
  console.log('- Store Code');
  console.log('- Store UUID');
  console.log('- Network ID');
  console.log('- Order ID / Payment ID / License ID');
  console.log('- Paket, periode, nominal, masa berlaku, Owner, dan toko');
  console.log('');
  console.log('Password Owner, OTP, dan token rahasia TIDAK dikirim.');
  console.log('');

  const confirm=(await ask('Ketik AKTIFKAN untuk mengaktifkan email data lisensi lengkap')).toUpperCase();
  if(confirm!=='AKTIFKAN'){
    console.log('Dibatalkan.');
    return;
  }

  setSecret();

  console.log('');
  console.log('Deploy ldm-lynk-webhook...');
  runSupabase(
    ['functions','deploy','ldm-lynk-webhook','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('Deploy ldm-license-v2...');
  runSupabase(
    ['functions','deploy','ldm-license-v2','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('SELESAI.');
  console.log('LDM_RESEND_INCLUDE_SECRETS=true');
  console.log('Jalankan CHECK-RESEND.cmd.');
  console.log('Target: include_secrets = true');
  console.log('');
  console.log('Untuk menguji email transaksi tanpa membayar lagi, gunakan RETRY-PAID-EMAIL.cmd pada order PAID.');
})().catch(e=>{
  console.error('');
  console.error('GAGAL: '+(e.message||e));
  process.exitCode=1;
});
