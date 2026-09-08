'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF = 'vplweadbeujidsoponrl';
const DEFAULT_ORIGIN = 'https://soukyy522.github.io';
const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, 'license-authority-v2');

function ask(question, defaultValue=''){
  const rl = readline.createInterface({input:process.stdin,output:process.stdout});
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise(resolve=>{
    rl.question(`${question}${suffix}: `, answer=>{
      rl.close();
      const v=String(answer||'').trim();
      resolve(v||defaultValue);
    });
  });
}

function setSecret(values){
  const temp=path.join(os.tmpdir(),`ldm-v2818-${crypto.randomBytes(6).toString('hex')}.env`);
  fs.writeFileSync(temp,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n','utf8');
  try{
    runSupabase(['secrets','set','--env-file',temp,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR});
  }finally{
    try{fs.unlinkSync(temp)}catch(_){}
  }
}

(async()=>{
  console.log('');
  console.log('LocDailyMar V28.1.8 - LEGACY LIFETIME + OWNER VAULT');
  console.log('Project Ref: '+PROJECT_REF);
  console.log('');

  const sqlOk=(await ask('Ketik YA jika SQL-17 V28.1.8 sudah dijalankan pada License Authority')).toUpperCase();
  if(sqlOk!=='YA'){
    console.log('Deploy dibatalkan. Jalankan SQL-17 terlebih dahulu.');
    process.exitCode=2;
    return;
  }

  const origin=await ask('Allowed Origin',DEFAULT_ORIGIN);
  if(!/^https:\/\//i.test(origin))throw new Error('Allowed Origin wajib https://');

  console.log('');
  console.log('Memastikan CORS License V2...');
  setSecret({
    LDM2_ALLOWED_ORIGINS:origin,
    LDM2_ALLOW_NULL_ORIGIN:'false'
  });

  console.log('');
  console.log('Memeriksa secret Owner Vault...');
  const secretResult=runSupabase(
    ['secrets','list','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR,capture:true,echo:false}
  );
  const list=`${secretResult.stdout}\n${secretResult.stderr}`;
  const required=['LDM_APP_SUPABASE_URL','LDM_APP_SERVICE_ROLE_KEY','LDM_CHECKOUT_ENCRYPTION_SECRET','LDM2_DEVICE_PEPPER'];
  const missing=required.filter(name=>!new RegExp(`\\b${name}\\b`,'i').test(list));
  if(missing.length){
    console.log('PERINGATAN: secret berikut belum terlihat:');
    missing.forEach(x=>console.log('- '+x));
    console.log('Aktivasi Lifetime mungkin tetap bekerja, tetapi Owner Vault tidak lengkap sampai secret tersebut tersedia.');
  }else{
    console.log('Secret Owner Vault terdeteksi.');
  }

  console.log('');
  console.log('Deploy ldm-license-v2...');
  runSupabase(
    ['functions','deploy','ldm-license-v2','--project-ref',PROJECT_REF],
    {cwd:AUTH_DIR}
  );

  console.log('');
  console.log('DEPLOY V28.1.8 SELESAI.');
  console.log('Paket Lifetime tetap TIDAK dijual baru.');
  console.log('Lisensi Lifetime lama dapat memakai activate/check setelah SQL-17 aktif.');
  console.log('Owner Vault tersedia melalui license.html setelah frontend V28.1.8 diupload.');
})().catch(err=>{
  console.error('');
  console.error('DEPLOY GAGAL: '+(err.message||err));
  process.exitCode=1;
});
