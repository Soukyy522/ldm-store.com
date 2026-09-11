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

function setSecrets(){
  const f=path.join(os.tmpdir(),`ldm-resend-test-mode-${crypto.randomBytes(6).toString('hex')}.env`);
  fs.writeFileSync(f,[
    'LDM_RESEND_MODE=test',
    'LDM_RESEND_FROM=LocDailyMar <onboarding@resend.dev>',
    'LDM_RESEND_INCLUDE_SECRETS=true',
    ''
  ].join('\n'),'utf8');

  try{
    runSupabase(
      ['secrets','set','--env-file',f,'--project-ref',PROJECT_REF],
      {cwd:AUTH_DIR}
    );
  }finally{
    try{fs.unlinkSync(f)}catch(_){}
  }
}

(async()=>{
  console.log('');
  console.log('LocDailyMar V28.1.9.3 - SWITCH RESEND TO TEST MODE');
  console.log('');
  console.log('Ini akan mengatur:');
  console.log('LDM_RESEND_MODE=test');
  console.log('LDM_RESEND_FROM=LocDailyMar <onboarding@resend.dev>');
  console.log('LDM_RESEND_INCLUDE_SECRETS=true');
  console.log('');
  console.log('RESEND_API_KEY dan LDM_RESEND_TEST_TO tidak diubah.');
  console.log('');

  const c=(await ask('Ketik TEST untuk melanjutkan')).toUpperCase();
  if(c!=='TEST'){
    console.log('Dibatalkan.');
    return;
  }

  setSecrets();

  console.log('');
  console.log('Mode test aktif.');
  console.log('Jalankan CHECK-RESEND.cmd lalu TEST-RESEND-EMAIL.cmd.');
})().catch(e=>{
  console.error('');
  console.error('GAGAL: '+(e.message||e));
  process.exitCode=1;
});
