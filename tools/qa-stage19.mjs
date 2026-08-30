#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const args=process.argv.slice(2);const jsonOnly=args.includes("--json");const root=path.resolve(args.find(arg=>!arg.startsWith("--"))||process.cwd());
const failures=[],warnings=[],passes=[];
const add=(bucket,code,file,detail)=>bucket.push({code,file:path.relative(root,file)||".",detail});
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);if(entry.name===".git"||entry.name==="node_modules")return[];return entry.isDirectory()?walk(full):[full];});}
const files=walk(root),html=files.filter(file=>file.endsWith(".html")),js=files.filter(file=>file.endsWith(".js"));
for(const file of js){try{new vm.Script(fs.readFileSync(file,"utf8"),{filename:file});}catch(error){add(failures,"JS_SYNTAX",file,error.message);}}
for(const file of html){
  const text=fs.readFileSync(file,"utf8");
  const staticHtml=text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,"");
  for(const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){const attrs=match[1],body=match[2];if(/\bsrc\s*=/.test(attrs)){if(body.trim())add(failures,"SCRIPT_SRC_WITH_BODY",file,"Isi inline diabaikan browser karena tag juga memiliki src.");continue;}if(!/type\s*=\s*["'](?:application\/json|importmap)/i.test(attrs)){try{new vm.Script(body,{filename:file+":inline"});}catch(error){add(failures,"INLINE_JS_SYNTAX",file,error.message);}}}
  const ids=[...staticHtml.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match=>match[1]);for(const id of new Set(ids.filter((id,index)=>ids.indexOf(id)!==index)))add(failures,"DUPLICATE_STATIC_ID",file,id);
  for(const match of staticHtml.matchAll(/<img\b([^>]*)>/gi)){if(!/\balt\s*=/.test(match[1]))add(warnings,"IMG_ALT",file,match[0].slice(0,100));}
  if(Buffer.byteLength(text)>300*1024)add(warnings,"LARGE_HTML",file,`${Math.round(Buffer.byteLength(text)/1024)} KiB`);
  if(/navigator\.serviceWorker\.register\s*\(\s*["'](?!\.\/service-worker\.js|service-worker\.js)/.test(text))add(failures,"LEGACY_SW",file,"Registrasi Service Worker lama terdeteksi.");
  for(const match of text.matchAll(/<(?:script|link|img|a)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/gi)){
    let ref=match[1].split(/[?#]/)[0];if(!ref||ref.startsWith("#")||ref.includes("${")||/^(?:https?:|data:|mailto:|tel:|javascript:|\/\/)/i.test(ref))continue;
    try{ref=decodeURIComponent(ref);}catch{}const target=path.resolve(path.dirname(file),ref);if(!fs.existsSync(target))add(failures,"MISSING_LOCAL_ASSET",file,match[1]);
  }
  for(const match of text.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/([^"'\s<]+)/g)){if(/@(?:supabase\/supabase-js@\d+|[^@/]+)$/.test(match[1]))add(warnings,"UNPINNED_CDN",file,match[1]);}
}
const manifestFile=path.join(root,"manifest.json");
if(!fs.existsSync(manifestFile))add(failures,"MANIFEST_MISSING",manifestFile,"manifest.json tidak ditemukan.");else try{const manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8"));for(const key of ["name","short_name","start_url","display","icons"])if(!manifest[key])add(failures,"MANIFEST_FIELD",manifestFile,key);for(const icon of manifest.icons||[]){const target=path.resolve(root,String(icon.src||"").replace(/^\.\//,""));if(!fs.existsSync(target))add(failures,"MANIFEST_ICON",manifestFile,icon.src||"kosong");}}catch(error){add(failures,"MANIFEST_JSON",manifestFile,error.message);}
const combined=files.filter(file=>/\.(?:html|js|mjs|json|sql)$/i.test(file)).map(file=>fs.readFileSync(file,"utf8")).join("\n");
if(/sb_secret_[A-Za-z0-9._-]+/.test(combined)||/["'][^"']*service_role[^"']*["']\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i.test(combined))add(failures,"SECRET_EXPOSED",root,"Kandidat secret/service-role konkret terdeteksi.");else add(passes,"SECRET_SCAN",root,"Tidak menemukan pola secret/service-role konkret.");
for(const name of ["style.css","setting.js","employee-id.js","js/security-hardening.js","js/qa-runtime.js","qa-security-performance.html"]){const target=path.join(root,name);if(fs.existsSync(target))add(passes,"REQUIRED_FILE",target,"tersedia");else add(failures,"REQUIRED_FILE",target,"hilang");}
const report={stage:19,root,generatedAt:new Date().toISOString(),summary:{pass:passes.length,warn:warnings.length,fail:failures.length},passes,warnings,failures};
if(jsonOnly)console.log(JSON.stringify(report,null,2));else{console.log(`TAHAP 19 QA — PASS ${passes.length} | WARN ${warnings.length} | FAIL ${failures.length}`);for(const [title,rows] of [["FAIL",failures],["WARN",warnings],["PASS",passes]]){if(!rows.length)continue;console.log(`\n${title}`);rows.forEach(row=>console.log(`- [${row.code}] ${row.file}: ${row.detail}`));}}
process.exitCode=failures.length?1:0;
