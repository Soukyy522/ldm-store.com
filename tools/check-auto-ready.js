'use strict';

const https = require('https');
const PROJECT_REF = 'vplweadbeujidsoponrl';

function getJson(url) {
  return new Promise((resolve,reject) => {
    https.get(url,{headers:{'user-agent':'LocDailyMar-V28.1.7-ReadyCheck'}},(res) => {
      let body='';
      res.setEncoding('utf8');
      res.on('data',(c)=>body+=c);
      res.on('end',()=>{
        try{resolve({status:res.statusCode,data:JSON.parse(body||'{}')});}
        catch(e){reject(new Error('Response health bukan JSON: '+body.slice(0,500)));}
      });
    }).on('error',reject);
  });
}

(async()=>{
  const url=`https://${PROJECT_REF}.supabase.co/functions/v1/ldm-lynk-webhook`;
  const {status,data}=await getJson(url);
  console.log('LocDailyMar V28.1.7 - LYNK AUTO READY CHECK');
  console.log('HTTP:',status);
  const r=data.runtime||{};
  console.log('webhook_token_configured :',!!r.webhook_token_configured);
  console.log('auto_process             :',!!r.auto_process);
  console.log('assume_success_webhook   :',!!r.assume_success_webhook);
  console.log('matching_mode            :',r.matching_mode||'-');
  console.log('success_values           :',Array.isArray(r.success_values)?r.success_values.join(', '):'-');
  const ready=!!r.webhook_token_configured && !!r.auto_process && !!r.assume_success_webhook && r.matching_mode==='mapped_plus_recursive_unique_match';
  console.log('');
  console.log(ready?'READY: YA':'READY: BELUM');
  if(!ready)process.exitCode=2;
})().catch((e)=>{console.error('CHECK GAGAL:',e.message||e);process.exitCode=1;});
