'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const crypto=require('crypto');const readline=require('readline');const {runSupabase}=require('./supabase-cli');
const PROJECT_REF='vplweadbeujidsoponrl';const ROOT=path.resolve(__dirname,'..');const AUTH_DIR=path.join(ROOT,'license-authority-v2');
function ask(q,def=''){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(r=>rl.question(`${q}${def?` [${def}]`:''}: `,a=>{rl.close();r(String(a||'').trim()||def)}))}
function setSecrets(v){const f=path.join(os.tmpdir(),`ldm-resend-prod-${crypto.randomBytes(6).toString('hex')}.env`);fs.writeFileSync(f,Object.entries(v).map(([k,x])=>`${k}=${x}`).join('\n')+'\n','utf8');try{runSupabase(['secrets','set','--env-file',f,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR})}finally{try{fs.unlinkSync(f)}catch(_){}}}
(async()=>{
 console.log('Aktifkan RESEND PRODUCTION hanya setelah domain/subdomain sudah Verified di dashboard Resend.');
 const from=await ask('From address, contoh LocDailyMar <license@send.domainkamu.com>');if(!/@/.test(from)||/resend\.dev/i.test(from))throw new Error('Production From harus memakai domain/subdomain milikmu yang sudah Verified, bukan resend.dev.');
 const reply=await ask('Reply-To (boleh kosong)');
 const confirm=(await ask('Ketik PRODUKSI untuk mengaktifkan email ke customer')).toUpperCase();if(confirm!=='PRODUKSI'){console.log('Dibatalkan.');return}
 setSecrets({LDM_RESEND_MODE:'production',LDM_RESEND_FROM:from,LDM_RESEND_REPLY_TO:reply,LDM_RESEND_INCLUDE_SECRETS:'true'});
 console.log('Mode production aktif dan email lisensi lengkap diaktifkan. Secret tersedia langsung untuk Edge Functions.');
 console.log('Jalankan CHECK-RESEND.cmd lalu TEST-RESEND-EMAIL.cmd sebelum pembayaran customer berikutnya.');
})().catch(e=>{console.error('AKTIVASI GAGAL: '+(e.message||e));process.exitCode=1});
