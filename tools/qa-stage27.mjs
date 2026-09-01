import fs from "node:fs";
import vm from "node:vm";

const required = [
  "supabase/sql/26-stage27-employee-nik.sql",
  "supabase/sql/26-stage27-verify.sql",
  "supabase/functions/ldm-account-admin/index.ts",
  "employee-id.js",
  "account-management.html",
  "multi-store.html",
  "owner-control-center.html",
  "CARA-PASANG-TAHAP-27-NIK-KARYAWAN.txt"
];

const failures = [];
for (const file of required) {
  if (!fs.existsSync(file)) failures.push(`File tidak ditemukan: ${file}`);
}

function requireText(file, markers) {
  const text = fs.readFileSync(file, "utf8");
  for (const marker of markers) {
    if (!text.includes(marker)) failures.push(`${file}: marker tidak ditemukan: ${marker}`);
  }
}

if (!failures.length) {
  requireText("supabase/sql/26-stage27-employee-nik.sql", [
    "employee_origin_store_id",
    "ldm_employee_counters",
    "ldm_generate_employee_nik",
    "trg_profiles_assign_employee_nik",
    "YYMMDDSSNNN"
  ]);
  requireText("account-management.html", ["NIK Karyawan", "employee_id"]);
  requireText("multi-store.html", ["NIK Karyawan", "employee_id"]);
  requireText("owner-control-center.html", ["NIK Karyawan", "employee_id"]);
  requireText("supabase/functions/ldm-account-admin/index.ts", [
    '.select("employee_id")',
    "employee_id: profile?.employee_id"
  ]);

  const data = {};
  const context = {
    window: {},
    localStorage: {
      getItem: key => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null,
      setItem: (key, value) => { data[key] = String(value); }
    },
    Date, JSON, Object, String, Number, Array, Math, RegExp, Error
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("employee-id.js", "utf8"), context);

  data.ldmCloudStoreId = "STORE-A";
  const first = context.LDMEmployee.createForAccount({
    username: "qa-first",
    createdAt: "2026-09-01T00:00:57+08:00"
  });
  const second = context.LDMEmployee.createForAccount({
    username: "qa-second",
    createdAt: "2026-09-01T00:01:57+08:00"
  });
  data.ldmCloudStoreId = "STORE-B";
  const otherStore = context.LDMEmployee.createForAccount({
    username: "qa-other-store",
    createdAt: "2026-09-01T00:02:57+08:00"
  });

  if (!/^\d{11}$/.test(first.employeeId)) failures.push("NIK bukan 11 digit.");
  if (!first.employeeId.endsWith("001")) failures.push("Karyawan pertama bukan urutan 001.");
  if (!second.employeeId.endsWith("002")) failures.push("Karyawan kedua bukan urutan 002.");
  if (!otherStore.employeeId.endsWith("001")) failures.push("Urutan Store ID kedua tidak dimulai dari 001.");
}

if (failures.length) {
  console.error(`QA 27 GAGAL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("QA 27 LULUS: NIK otomatis 11 digit, urutan per Store ID, UI, SQL, dan Edge Function tersedia.");
