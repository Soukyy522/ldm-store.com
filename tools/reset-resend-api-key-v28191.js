'use strict';

const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const readline=require('readline');
const { runSupabase }=require('./supabase-cli');

const PROJECT_REF='vplweadbeujidsoponrl';
const ROOT=path.resolve(__dirname,'..');
const AUTH_DIR=path.join(ROOT,'license-authority-v2');

function askSecret(question){
  return new Promise((resolve,reject)=>{
    const stdin=process.stdin, stdout=process.stdout;

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
      ) out=out.slice(1,-1).trim();
      resolve(out);
    }

    const onData=(chunk)=>{
      for(const ch of String(chunk||'')){
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

function setSecret(apiKey){
  const temp=path.join(os.tmpdir(),`ldm-resend-key-${crypto.randomBytes(6).toString('hex')}.env`);
  fs.writeFileSync(temp,`RESEND_API_KEY=${apiKey}\n`,'utf8');
  try{
    runSupabase(['secrets','set','--env-file',temp,'--project-ref',PROJECT_REF],{cwd:AUTH_DIR});
  }finally{
    try{fs.unlinkSync(temp)}catch(_){}
  }
}

(async()=>{
  console.log('');
  console.log('LocDailyMar V28.1.9.1 - RESET RESEND API KEY');
  console.log('');
  console.log('Gunakan SECRET KEY lengkap dari Resend Dashboard -> API Keys.');
  console.log('Jangan masukkan nama key atau API Key ID.');
  console.log('Input tidak dicetak ke terminal.');
  console.log('');

  const apiKey=await askSecret('Paste RESEND_API_KEY baru');

  if(!/^re_[A-Za-z0-9_\-]{20,}$/.test(apiKey)){
    throw new Error(
      'Format key tidak valid. Secret Resend harus berupa token lengkap yang diawali re_.'
    );
  }

  setSecret(apiKey);

  console.log('');
  console.log('RESEND_API_KEY berhasil diperbarui di Supabase Secrets.');
  console.log('Tidak perlu redeploy Edge Function hanya untuk mengganti secret.');
  console.log('');
  console.log('Lanjutkan:');
  console.log('  1. CHECK-RESEND.cmd');
  console.log('  2. TEST-RESEND-EMAIL.cmd');
})().catch(e=>{
  console.error('');
  console.error('RESET GAGAL: '+(e.message||e));
  process.exitCode=1;
});
