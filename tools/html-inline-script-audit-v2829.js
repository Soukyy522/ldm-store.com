const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = fs.readdirSync(root)
  .filter(name => name.toLowerCase().endsWith(".html"))
  .sort();

const failures = [];
let checked = 0;

for (const file of files) {
  const full = path.join(root, file);
  const html = fs.readFileSync(full, "utf8");
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;

  while ((match = pattern.exec(html))) {
    index += 1;
    const attrs = String(match[1] || "");
    const code = String(match[2] || "");

    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["']module["']/i.test(attrs)) continue;
    if (!code.trim()) continue;

    checked += 1;
    try {
      new vm.Script(code, { filename: `${file}#inline-${index}` });
    } catch (error) {
      failures.push({
        file,
        script: index,
        message: String(error && error.message || error)
      });
    }
  }
}

if (failures.length) {
  console.error("INLINE SCRIPT AUDIT: GAGAL");
  for (const failure of failures) {
    console.error(`- ${failure.file} script #${failure.script}: ${failure.message}`);
  }
  process.exit(1);
}

console.log("INLINE SCRIPT AUDIT: LULUS");
console.log(`Inline script diperiksa: ${checked}`);
