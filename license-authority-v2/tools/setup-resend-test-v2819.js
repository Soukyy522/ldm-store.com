'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { runSupabase } = require('./supabase-cli');

const PROJECT_REF='vplweadbeujidsoponrl';
const ROOT=path.resolve(__dirname,'..');
const AUTH_DIR=path.join(ROOT,'license-authority-v2');
const TOKEN_FILE=path.join(ROOT,'.ldm-resend-test-token');

function ask(q,def=''){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  return new Promise(resolve=>rl.question(`${q}${def?` [${def}]`:''}: `,a=>{rl.close();resolve(String(a||'').trim()||def)}));
}
function askSecret(question){
  return new Promise((resolve,reject)=>{
    const stdin=process.stdin, stdout=process.stdout;

    // Non-TTY fallback. Input may be visible depending terminal.
    if(!stdin.isTTY||typeof stdin.setRawMode!=='function'){
      const rl=readline.createInterface({input:stdin,output:stdout});
      rl.question(question+': ',v=>{
        rl.close();
        resolve(String(v||'').trim().replace(/^["']|["']$/g,''));
      });
      return;
    }

    stdout.write(question+': ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value='';

    function cleanup(){
      stdin.removeListener('data',onData);
      try{stdin.setRawMode(false)}catch(_){}
      stdin.pause();
    }

    function finish(){
      stdout.write(os.EOL);
      cleanup();
      let out=String(value||'').trim();
      if(
        out.length>=2 &&
        ((out.startsWith('"')&&out.endsWith('"')) ||
         (out.startsWith("'")&&out.endsWith("'")))
      ){
        out=out.slice(1,-1).trim();
      }
      resolve(out);
    }

    const onData=(chunk)=>{
      // PENTING V28.1.9.1:
      // Paste di Windows Terminal/PowerShell sering datang sebagai SATU chunk
      // berisi banyak karakter. Versi lama hanya menerima chunk.length === 1.
      // Sekarang setiap karakter di dalam chunk diproses.
      const s=String(chunk||'');
      for(const ch of s){
        if(ch==='\u0003'){
          cleanup();
          reject(new Error('Dibatalkan.'));
          return;
        }
        if(ch==='\r'||ch==='\n'){
          finish();
          return;
        }
        if(ch==='\u007f'||ch==='\b'){
          if(value.length){
            value=value.slice(0,-1);
            stdout.write('\b \b');
          }
          continue;
        }
        if(ch>=' '){
          value+=ch;
          stdout.write('*');
        }
      }
    };

    stdin.on('data',onData);
  });
}
function writeSecrets(values){
  const temp=path.join(os.tmpdir(),`ldm-resend-${crypto.randomBytes(6).toString('hex')}.env`);
  fs.writeFileSync(temp,Object.entries(values).map(([k,v])=>`${k}=${String(v)}`).join('\n')+'\n','utf8');
  try{runSupabase(['secrets','set','--env-file',temp,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR})}
  finally{try{fs.unlinkSync(temp)}catch(_){}}
}
(async()=>{
  console.log('');
  console.log('LocDailyMar V28.1.9 - SETUP RESEND TEST');
  console.log('Mode TEST memakai onboarding@resend.dev dan hanya boleh mengirim ke email akun Resend sendiri.');
  console.log('');
  const email=(await ask('Email yang terdaftar pada akun Resend')).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Format email tidak valid.');
  const apiKey=await askSecret('Paste RESEND_API_KEY (disamarkan)');
  if(!/^re_[A-Za-z0-9_\-]{20,}$/.test(apiKey)){
    throw new Error('Format RESEND_API_KEY tidak valid. Pastikan menyalin SECRET KEY lengkap yang diawali re_, bukan nama/ID key.');
  }
  const testToken=crypto.randomBytes(32).toString('hex');
  writeSecrets({
    RESEND_API_KEY:apiKey,
    LDM_RESEND_MODE:'test',
    LDM_RESEND_FROM:'LocDailyMar <onboarding@resend.dev>',
    LDM_RESEND_TEST_TO:email,
    LDM_RESEND_INCLUDE_SECRETS:'true',
    LDM_RESEND_TEST_TOKEN:testToken
  });
  fs.writeFileSync(TOKEN_FILE,testToken+'\n',{encoding:'utf8',mode:0o600});
  const gi=path.join(ROOT,'.gitignore');
  let g=fs.existsSync(gi)?fs.readFileSync(gi,'utf8'):'';
  if(!g.includes('.ldm-resend-test-token'))fs.writeFileSync(gi,(g.trimEnd()+'\n.ldm-resend-test-token\n').replace(/^\n/,''),'utf8');
  console.log('');
  console.log('Deploy Edge Functions Resend...');
  for(const fn of ['ldm-resend-test','ldm-lynk-webhook','ldm-license-v2']){
    console.log('>>> '+fn);
    runSupabase(['functions','deploy',fn,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR});
  }
  console.log('');
  console.log('SETUP TEST SELESAI.');
  console.log('API key sudah disimpan di Supabase Secrets, bukan frontend.');
  console.log('Test token lokal disimpan ke .ldm-resend-test-token dan sudah dimasukkan .gitignore.');
  console.log('Lanjut jalankan TEST-RESEND-EMAIL.cmd');
})().catch(err=>{console.error('');console.error('SETUP GAGAL: '+(err.message||err));process.exitCode=1});
