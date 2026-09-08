'use strict';
const https=require('https');const PROJECT_REF='vplweadbeujidsoponrl';
https.get(`https://${PROJECT_REF}.supabase.co/functions/v1/ldm-resend-test`,{headers:{'user-agent':'LocDailyMar-V28.1.9-Check'}},res=>{let out='';res.setEncoding('utf8');res.on('data',c=>out+=c);res.on('end',()=>{console.log('HTTP '+res.status);console.log(out);if(res.status<200||res.status>=300)process.exitCode=2})}).on('error',e=>{console.error('CHECK GAGAL: '+e.message);process.exitCode=1});
