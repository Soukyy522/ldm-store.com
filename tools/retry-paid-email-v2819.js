'use strict';
const fs=require('fs');const path=require('path');const https=require('https');const readline=require('readline');const crypto=require('crypto');
const PROJECT_REF='vplweadbeujidsoponrl';const ROOT=path.resolve(__dirname,'..');const TOKEN_FILE=path.join(ROOT,'.ldm-resend-test-token');
function ask(q){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(r=>rl.question(q+': ',a=>{rl.close();r(String(a||'').trim())}))}
function token(){return fs.existsSync(TOKEN_FILE)?fs.readFileSync(TOKEN_FILE,'utf8').trim():''}
function post(body,tok){return new Promise((resolve,reject)=>{const data=Buffer.from(JSON.stringify(body));const req=https.request({hostname:`${PROJECT_REF}.supabase.co`,port:443,path:'/functions/v1/ldm-resend-test',method:'POST',headers:{'content-type':'application/json','content-length':data.length,'x-ldm-resend-test-token':tok,'user-agent':'LocDailyMar-V28.1.9.4-Retry'}},res=>{let out='';res.setEncoding('utf8');res.on('data',c=>out+=c);res.on('end',()=>resolve({status:res.statusCode,body:out}))});req.on('error',reject);req.write(data);req.end()})}

(async()=>{
 let tok=token();if(!tok)tok=await ask('LDM_RESEND_TEST_TOKEN');if(!tok)throw new Error('Test token tidak tersedia.');
 const orderId=await ask('Order ID PAID yang ingin dicoba kirim emailnya');if(!orderId)throw new Error('Order ID wajib diisi.');
 const retryRunId=crypto.randomUUID();
 console.log('Retry Run ID: '+retryRunId);
 const r=await post({action:'retry_order',order_id:orderId,retry_run_id:retryRunId},tok);
 console.log('HTTP '+r.status);
 console.log(r.body);
 if(r.status<200||r.status>=300)process.exitCode=2;
})().catch(e=>{console.error('RETRY GAGAL: '+(e.message||e));process.exitCode=1});
