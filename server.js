const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const multer = require("multer");
const QRCode = require("qrcode");
const XLSX = require("xlsx");

// NOTE: newer nanoid versions are ESM-only and will throw ERR_REQUIRE_ESM
// when required from CommonJS. To keep this project runnable with `node server.js`
// we generate short IDs using Node's built-in crypto instead.
function randomHex(len = 8) {
  // hex length is 2 chars per byte
  const bytes = Math.ceil(len / 2);
  return crypto.randomBytes(bytes).toString("hex").slice(0, len);
}

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(ROOT, "db.json");
const IMAGE_DIR = path.join(PUBLIC_DIR, "assets", "images");
const CAL_FILE_DIR = path.join(PUBLIC_DIR, "assets", "calibration_files");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

/** -----------------------------
 *  JSON DB helpers (atomic write)
 * ------------------------------*/

function ensureDbSchema(db){
  if(!db || typeof db !== "object") db = {};
  if(!db.meta) db.meta = {};
  if(!Array.isArray(db.users)) db.users = [];
  if(!Array.isArray(db.assets)) db.assets = [];
  if(!Array.isArray(db.maintenanceStatusChoices)) db.maintenanceStatusChoices = [];

  // Ensure standard maintenance workflow choices exist (including "รอยืนยัน")
  // so that old databases still work and the Admin can confirm repair requests.
  const STANDARD_MAINT = [
    "ยังไม่เคยแจ้งซ่อม",
    "แจ้งซ่อมแล้ว - รอยืนยัน",
    "แจ้งซ่อมแล้ว - ตีกลับ",
    "แจ้งซ่อมแล้ว - กำลังดำเนินการ",
    "ซ่อมเสร็จแล้ว",
    "ปลดระวาง / รอจำหน่าย",
  ];
  if (db.maintenanceStatusChoices.length === 0) {
    db.maintenanceStatusChoices = [...STANDARD_MAINT];
  } else {
    // If missing "รอยืนยัน" add it after "ยังไม่เคยแจ้งซ่อม".
    const hasPending = db.maintenanceStatusChoices.some(s => String(s).includes("รอยืนยัน"));
    if (!hasPending) {
      const idx = db.maintenanceStatusChoices.findIndex(s => String(s).includes("ยังไม่เคย"));
      const insertAt = idx >= 0 ? idx + 1 : 1;
      db.maintenanceStatusChoices.splice(insertAt, 0, "แจ้งซ่อมแล้ว - รอยืนยัน");
    }

    // If missing "ตีกลับ" add it after "รอยืนยัน".
    const hasReject = db.maintenanceStatusChoices.some(s => String(s).includes("ตีกลับ"));
    if (!hasReject) {
      const pIdx = db.maintenanceStatusChoices.findIndex(s => String(s).includes("รอยืนยัน"));
      const insertAt = pIdx >= 0 ? pIdx + 1 : 2;
      db.maintenanceStatusChoices.splice(insertAt, 0, "แจ้งซ่อมแล้ว - ตีกลับ");
    }
  }

  if(!db.calibration || typeof db.calibration !== "object"){
    db.calibration = { meta: {}, items: [] };
  }
  if(!db.calibration.meta || typeof db.calibration.meta !== "object") db.calibration.meta = {};
  if(!Array.isArray(db.calibration.items)) db.calibration.items = [];
  return db;
}


let writeQueue = Promise.resolve();

async function readDb() {
  const raw = await fsp.readFile(DB_PATH, "utf-8");
  return ensureDbSchema(JSON.parse(raw));
}
async function writeDb(db) {
  // serialize writes to avoid corruption
  writeQueue = writeQueue.then(async () => {
    const tmp = DB_PATH + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2), "utf-8");
    await fsp.rename(tmp, DB_PATH);
  });
  return writeQueue;
}

/** -----------------------------
 *  Simple token (HMAC)
 *  payload: {u, r, n, exp}
 * ------------------------------*/
const SECRET = process.env.MEM_SECRET || "UPH_MEM_SYSTEM_DEV_SECRET_CHANGE_ME";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}
function makeToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = sign(body);
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (sign(body) !== sig) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")); }
  catch { return null; }
  if (!payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

function authRequired(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, message: "Unauthorized" });
  req.user = payload;
  next();
}
function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user?.r !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    next();
  });
}

/** -----------------------------
 *  Upload (images)
 * ------------------------------*/
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try { await fsp.mkdir(IMAGE_DIR, { recursive: true }); } catch {}
    cb(null, IMAGE_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safe = (req.params.id || randomHex(8)).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${safe}${ext}`);
  }
});
const upload = multer({ storage });

// Upload (excel import) - keep in memory
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// Common column names used in Excel (Thai/English) -> internal Thai columns
const COL = {
  CODE: "รหัสเครื่องมือห้องปฏิบัติการ",
  NAME: "ชื่อ",
  MODEL: "รุ่น",
  SN: "หมายเลขเครื่อง",
  STATUS: "สถานะ",
  MAINT: "สถานะแจ้งซ่อม",
  LOC: "สถานที่ใช้งาน (ปัจจุบัน)",
  IMAGE: "รูปภาพครุภัณฑ์"
};

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
      const v = obj[k];
      if (typeof v === "string") {
        const s = v.trim();
        if (s) return s;
      } else if (v !== "") {
        return String(v);
      }
    }
  }
  return "";
}


/** -----------------------------
 *  Calibration helpers
 *  - Supports columns:
 *    - รหัสเครื่องมือห้องปฏิบัติการ, ชื่อ, หมายเลขเครื่อง, สถานที่ใช้งาน (ปัจจุบัน)
 *    - วันที่สอบเทียบล่าสุด, วันครบกำหนดสอบเทียบ
 *    - เดือน 1-12 (หัวคอลัมน์เป็น "1".."12" หรือ "เดือน1".."เดือน12")
 * ------------------------------*/
function excelDateToYMD(v){
  if (!v && v !== 0) return "";
  try{
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.toISOString().slice(0,10);
    }
  }catch{}
  if (typeof v === "number" && Number.isFinite(v)) {
    const dc = XLSX.SSF.parse_date_code(v);
    if (dc && dc.y && dc.m && dc.d){
      const dt = new Date(Date.UTC(dc.y, dc.m-1, dc.d, 12, 0, 0));
      return dt.toISOString().slice(0,10);
    }
  }
  const s = String(v).trim();
  if(!s) return "";
  // try ISO / YYYY-MM-DD / DD/MM/YYYY
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);

  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if(m){
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yy = Number(m[3]);
    if(yy < 100) yy += 2000;
    const dt = new Date(Date.UTC(yy, mm-1, dd, 12, 0, 0));
    if(!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
  }
  return "";
}

function truthyMonth(v){
  const t = String(v ?? "").trim();
  if (!t) return false;
  return ["1","x","X","✓","y","Y","true","TRUE"].includes(t);
}

function normalizeCalibrationRow(rawRow, sheetName=""){
  const row = { ...rawRow };

  // รองรับไฟล์แผนสอบเทียบแบบหัวคอลัมน์อังกฤษ (ID Code / Equipment / Models / S/N / Due M/D/Y)
  const code = pickFirst(row, [
    COL.CODE,
    "ID Code","IDCode","ID_Code",
    "รหัสครุภัณฑ์","รหัสเครื่องมือ","รหัส",
    "code","Code","CODE"
  ]);
  const name = pickFirst(row, [
    COL.NAME,
    "Equipment","Equipment ","เครื่องมือ","ชื่อครุภัณฑ์",
    "name","Name"
  ]);
  const model = pickFirst(row, [COL.MODEL, "Models","Model","model"]);
  const manuf = pickFirst(row, ["Manufacture","Manufacturer","ผู้ผลิต","ผู้ผลิต/ยี่ห้อ"]);
  const assetId = pickFirst(row, ["Asset ID","AssetID","Asset Id","Asset"]);
  const sn = pickFirst(row, [COL.SN, "SN", "S/N", "Serial", "serial", "หมายเลขเครื่อง/Serial"]);
  const loc = pickFirst(row, [COL.LOC, "สถานที่ใช้งาน", "Location", "location"]);

  if (!code && !name && !sn) return null;

  if (code) row[COL.CODE] = row[COL.CODE] || code;
  if (name) row[COL.NAME] = row[COL.NAME] || name;
  if (sn) row[COL.SN] = row[COL.SN] || sn;
  if (model) row[COL.MODEL] = row[COL.MODEL] || model;
  if (assetId) row["AssetID"] = row["AssetID"] || assetId;
  if (manuf) row["ผู้ผลิต"] = row["ผู้ผลิต"] || manuf;

  // ถ้าไม่มีสถานที่ใช้งาน ให้ใช้ชื่อชีตเป็นตัวช่วย (เช่น ห้องปฏิบัติการ / ธนาคารเลือด)
  const inferredLoc = String(sheetName||"").split(/\s*\d{4}/)[0].trim();
  if (loc) row[COL.LOC] = row[COL.LOC] || loc;
  else if (!row[COL.LOC] && inferredLoc) row[COL.LOC] = inferredLoc;

  // date columns (Thai + English)
  const last = pickFirst(row, [
    "วันที่สอบเทียบล่าสุด","Last Calibration","Last Cal","LastCal",
    "last_cal","lastCal","last"
  ]);
  const due = pickFirst(row, [
    "วันครบกำหนดสอบเทียบ","Due Date","Due","Due M/D/Y","Due M/D/Y ",
    "due_date","dueDate","due"
  ]);
  if (last && !row["วันที่สอบเทียบล่าสุด"]) row["วันที่สอบเทียบล่าสุด"] = last;
  if (due && !row["วันครบกำหนดสอบเทียบ"]) row["วันครบกำหนดสอบเทียบ"] = due;

  // normalize to YYYY-MM-DD where possible
  if (row["วันที่สอบเทียบล่าสุด"]) row["วันที่สอบเทียบล่าสุด"] = excelDateToYMD(row["วันที่สอบเทียบล่าสุด"]) || String(row["วันที่สอบเทียบล่าสุด"]).trim();
  if (row["วันครบกำหนดสอบเทียบ"]) row["วันครบกำหนดสอบเทียบ"] = excelDateToYMD(row["วันครบกำหนดสอบเทียบ"]) || String(row["วันครบกำหนดสอบเทียบ"]).trim();

  // ถ้าไม่มีวันครบกำหนด แต่มี "วันที่สอบเทียบล่าสุด" + ความถี่ "สอบเทียบ" (เช่น 3 month / 12 month)
  // ให้คำนวณวันครบกำหนดโดยอัตโนมัติ
  if (!row["วันครบกำหนดสอบเทียบ"] && row["วันที่สอบเทียบล่าสุด"]) {
    const freq = String(row["สอบเทียบ"] ?? row["Calibration"] ?? row["frequency"] ?? "").trim();
    const m = /(\d+)\s*(month|months|m)/i.exec(freq);
    const lastYmd = excelDateToYMD(row["วันที่สอบเทียบล่าสุด"]) || String(row["วันที่สอบเทียบล่าสุด"]).trim();
    const lastDt = lastYmd ? new Date(lastYmd) : null;
    if (m && lastDt && !isNaN(lastDt.getTime())) {
      const addMonths = Number(m[1]);
      if (Number.isFinite(addMonths) && addMonths > 0) {
        const dueDt = new Date(Date.UTC(lastDt.getUTCFullYear(), lastDt.getUTCMonth() + addMonths, lastDt.getUTCDate(), 12, 0, 0));
        row["วันครบกำหนดสอบเทียบ"] = dueDt.toISOString().slice(0,10);
      }
    }
  }

  // months 1-12 (รองรับหัวคอลัมน์เป็นตัวเลข เช่น 10,11,12,1..9)
  for (let m = 1; m <= 12; m++){
    const v = row[String(m)] ?? row[`เดือน${m}`] ?? row[`Month${m}`] ?? row[`M${m}`] ?? "";
    row[String(m)] = truthyMonth(v) ? "1" : (String(v).trim() ? String(v).trim() : "");
  }

  if (!row.id) row.id = "C-" + randomHex(6).toUpperCase();
  return row;
}

// อ่านชีตที่มีหัวตารางอยู่ไม่ใช่แถวแรก (กรณีไฟล์แผนสอบเทียบที่มีหัวเรื่อง 2-3 แถว)
function sheetToObjectsWithHeaderDetect(ws){
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const norm = (v)=> String(v ?? "").trim();
  const scoreRow = (arr)=>{
    const s = arr.map(norm);
    let score = 0;
    const has = (needle)=> s.some(x => x.toLowerCase() === String(needle).toLowerCase());
    const hasLike = (re)=> s.some(x => re.test(String(x)));
    if (has("ID Code") || hasLike(/รหัส/)) score += 2;
    if (has("Equipment") || hasLike(/ชื่อ/)) score += 2;
    if (has("S/N") || has("SN") || hasLike(/หมายเลข/)) score += 2;
    if (hasLike(/Due/i) || hasLike(/ครบกำหนด/)) score += 1;
    if (has("Models") || hasLike(/รุ่น/)) score += 1;
    return score;
  };

  let bestIdx = -1;
  let bestScore = 0;
  const scanMax = Math.min(40, rows.length);
  for (let i=0; i<scanMax; i++){
    const sc = scoreRow(rows[i] || []);
    if (sc > bestScore){ bestScore = sc; bestIdx = i; }
  }
  if (bestIdx < 0 || bestScore < 3) {
    // fallback: default behavior
    return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  }

  const header = (rows[bestIdx] || []).map(v => norm(v));
  const out = [];
  for (let r = bestIdx + 1; r < rows.length; r++){
    const arr = rows[r] || [];
    const hasAny = arr.some(v => norm(v) !== "");
    if (!hasAny) continue;

    const obj = {};
    for (let c=0; c<header.length; c++){
      const key = header[c];
      if (!key) continue;
      obj[key] = arr[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}


function normalizeImportedRow(row, db) {
  // Keep all original columns but ensure required ones exist
  const out = { ...row };

  const code = pickFirst(row, [COL.CODE, "รหัสครุภัณฑ์", "รหัส", "code", "Code", "CODE"]);
  if (!code) return null;
  out[COL.CODE] = code;

  // Optional standard fields
  const name = pickFirst(row, [COL.NAME, "name", "Name"]);
  if (name) out[COL.NAME] = name;

  const model = pickFirst(row, [COL.MODEL, "model", "Model"]);
  if (model) out[COL.MODEL] = model;

  const sn = pickFirst(row, [COL.SN, "SN", "S/N", "Serial", "serial", "หมายเลขเครื่อง/Serial"]);
  if (sn) out[COL.SN] = sn;

  // Defaults
  if (!out[COL.MAINT]) out[COL.MAINT] = (db.maintenanceStatusChoices || [])[0] || "ยังไม่เคยแจ้งซ่อม";
  if (!out[COL.IMAGE]) out[COL.IMAGE] = "";

  // Ensure id
  if (!out.id) out.id = "A-" + randomHex(6).toUpperCase();

  return out;
}

/** -----------------------------
 *  Auto asset-code generator
 *  - EQ: LAB-AS-EQ-A001, A002...
 *  - GN: LAB-AS-GN-A001, A002...
 *  (Always computed from full db.assets, independent of search/filter)
 * ------------------------------*/
function pad3(n){
  return String(Math.max(0, Number(n)||0)).padStart(3, "0");
}
function escapeRegex(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nextAssetCode(db, kind){
  const k = String(kind||"EQ").toUpperCase();
  const prefix = (k === "GN") ? "LAB-AS-GN-A" : "LAB-AS-EQ-A";
  const re = new RegExp("^" + escapeRegex(prefix) + "(\\d+)$", "i");
  let maxNum = 0;
  for (const a of (db.assets || [])) {
    const code = String(a?.[COL.CODE] || "").trim();
    const m = re.exec(code);
    if (!m) continue;
    const num = Number(m[1]);
    if (Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return prefix + pad3(maxNum + 1);
}

/** -----------------------------
 *  API
 * ------------------------------*/
app.get("/api/meta", async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, meta: db.meta, maintenanceStatusChoices: db.maintenanceStatusChoices || [] });
});

/** -----------------------------
 *  Excel import / export (Admin)
 *  - Import: upload .xlsx/.xls and convert rows into db.assets
 *    mode = replace | merge (merge by asset code)
 *  - Export: generate .xlsx from current db.assets
 * ------------------------------*/

function normalizeImportedRow(rawRow, db) {
  const row = { ...rawRow };

  // map common headers to Thai headers used by the app
  const code = pickFirst(row, [
    COL.CODE, "รหัสครุภัณฑ์", "รหัสเครื่องมือ", "code", "Code", "CODE"
  ]);
  if (!code) return null;
  row[COL.CODE] = row[COL.CODE] || code;

  const name = pickFirst(row, [COL.NAME, "ชื่อครุภัณฑ์", "name", "Name"]);
  if (name) row[COL.NAME] = row[COL.NAME] || name;

  const model = pickFirst(row, [COL.MODEL, "Model", "model"]);
  if (model) row[COL.MODEL] = row[COL.MODEL] || model;

  const sn = pickFirst(row, [COL.SN, "S/N", "SN", "Serial", "serial", "หมายเลขเครื่อง/Serial"]);
  if (sn) row[COL.SN] = row[COL.SN] || sn;

  const status = pickFirst(row, [COL.STATUS, "Status", "status"]);
  if (status) row[COL.STATUS] = row[COL.STATUS] || status;

  const loc = pickFirst(row, [COL.LOC, "สถานที่ใช้งาน", "Location", "location"]);
  if (loc) row[COL.LOC] = row[COL.LOC] || loc;

  // Defaults
  if (!row[COL.MAINT]) row[COL.MAINT] = (db.maintenanceStatusChoices || [])[0] || "ยังไม่เคยแจ้งซ่อม";
  if (!row[COL.IMAGE]) row[COL.IMAGE] = "";

  // numeric cleanup
  if (Object.prototype.hasOwnProperty.call(row, "ต้นทุนต่อหน่วย")) {
    const v = row["ต้นทุนต่อหน่วย"];
    if (typeof v === "string") {
      const n = Number(v.replace(/,/g, "").trim());
      if (Number.isFinite(n)) row["ต้นทุนต่อหน่วย"] = n;
    }
  }

  // ensure id
  if (!row.id) row.id = "A-" + randomHex(6).toUpperCase();

  return row;
}

app.post("/api/import/excel", adminRequired, excelUpload.single("excel"), async (req, res) => {
  const mode = (req.body?.mode || "merge").toString();
  const file = req.file;
  if (!file?.buffer) return res.status(400).json({ ok: false, message: "ไม่พบไฟล์ Excel" });

  let wb;
  try {
    wb = XLSX.read(file.buffer, { type: "buffer" });
  } catch (e) {
    return res.status(400).json({ ok: false, message: "อ่านไฟล์ Excel ไม่ได้" });
  }

  const sheetName = (req.body?.sheet || wb.SheetNames?.[0] || "").toString();
  const ws = wb.Sheets[sheetName];
  if (!ws) return res.status(400).json({ ok: false, message: "ไม่พบชีตในไฟล์ Excel" });

  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  const db = await readDb();

  let skipped = 0;
  const imported = [];
  for (const r of rawRows) {
    // skip fully empty rows
    const hasAny = Object.values(r || {}).some(v => String(v ?? "").trim() !== "");
    if (!hasAny) continue;

    const norm = normalizeImportedRow(r, db);
    if (!norm) { skipped++; continue; }
    imported.push(norm);
  }

  // dedupe by code (keep last)
  const mapImport = new Map();
  for (const a of imported) {
    const code = String(a[COL.CODE] || "").trim();
    if (!code) continue;
    mapImport.set(code, a);
  }
  const importedUnique = Array.from(mapImport.values());

  let created = 0;
  let updated = 0;

  if (mode === "replace") {
    db.assets = importedUnique;
    created = importedUnique.length;
  } else {
    // merge by code
    const existing = db.assets || [];
    const mapExisting = new Map(existing.map(a => [String(a[COL.CODE] || "").trim(), a]));

    for (const inc of importedUnique) {
      const code = String(inc[COL.CODE] || "").trim();
      if (!code) continue;

      if (mapExisting.has(code)) {
        const cur = mapExisting.get(code);
        const merged = { ...cur, ...inc, id: cur.id };
        // preserve image if incoming empty
        if (!inc[COL.IMAGE]) merged[COL.IMAGE] = cur[COL.IMAGE] || "";
        mapExisting.set(code, merged);
        updated++;
      } else {
        mapExisting.set(code, inc);
        created++;
      }
    }

    db.assets = Array.from(mapExisting.values());
  }

  await writeDb(db);
  res.json({ ok: true, mode, imported: importedUnique.length, created, updated, skipped, sheet: sheetName });
});

app.get("/api/export/excel", adminRequired, async (req, res) => {
  const db = await readDb();
  const assets = db.assets || [];

  // Export without large internal-only fields if any
  const clean = assets.map(a => {
    const { id, ...rest } = a;
    return { id, ...rest };
  });

  const ws = XLSX.utils.json_to_sheet(clean);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Assets");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=UPH_MEM_assets.xlsx");
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
});


/** -----------------------------
 *  Calibration import / export (Admin)
 *  - Stores in db.calibration.items
 * ------------------------------*/
app.get("/api/calibration", authRequired, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, meta: db.calibration?.meta || {}, items: db.calibration?.items || [] });
});

app.post("/api/calibration/import", adminRequired, excelUpload.single("excel"), async (req, res) => {
  const mode = (req.body?.mode || "replace").toString();
  const file = req.file;
  if (!file?.buffer) return res.status(400).json({ ok: false, message: "ไม่พบไฟล์ Excel" });

  let wb;
  try {
    wb = XLSX.read(file.buffer, { type: "buffer" });
  } catch (e) {
    return res.status(400).json({ ok: false, message: "อ่านไฟล์ Excel ไม่ได้" });
  }

  // ถ้าไม่ระบุชีต -> นำเข้าทุกชีต (เหมาะกับไฟล์แผนสอบเทียบที่แยกตามหน่วยงาน)
  const requestedSheet = (req.body?.sheet || "").toString().trim();
  const sheetNames = requestedSheet ? [requestedSheet] : (wb.SheetNames || []);

  const db = await readDb();
  ensureDbSchema(db);

  let skipped = 0;
  const imported = [];
  for (const sn of sheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const rawRows = sheetToObjectsWithHeaderDetect(ws);
    for (const r of rawRows) {
      const hasAny = Object.values(r || {}).some(v => String(v ?? "").trim() !== "");
      if (!hasAny) continue;
      const norm = normalizeCalibrationRow(r, sn);
      if (!norm) { skipped++; continue; }
      imported.push(norm);
    }
  }

  // dedupe by code if present (keep last)
  const mapImport = new Map();
  let noCodeIdx = 0;
  for (const a of imported) {
    const code = String(a[COL.CODE] || "").trim();
    const key = code ? `CODE:${code}` : `NOCODE:${noCodeIdx++}`;
    mapImport.set(key, a);
  }
  const importedUnique = Array.from(mapImport.values());

  let created = 0;
  let updated = 0;

  if (mode === "replace") {
    db.calibration.items = importedUnique;
    created = importedUnique.length;
  } else {
    // merge by code when code exists, else append
    const existing = db.calibration.items || [];
    const mapExisting = new Map();
    for (const it of existing){
      const code = String(it[COL.CODE] || "").trim();
      if (code) mapExisting.set(code, it);
    }
    const mergedList = [...existing];

    for (const inc of importedUnique) {
      const code = String(inc[COL.CODE] || "").trim();
      if (code && mapExisting.has(code)) {
        const cur = mapExisting.get(code);
        const merged = { ...cur, ...inc, id: cur.id };
        mapExisting.set(code, merged);
        // replace in mergedList
        const idx = mergedList.findIndex(x => x.id === cur.id);
        if (idx >= 0) mergedList[idx] = merged;
        updated++;
      } else {
        mergedList.push(inc);
        if (code) mapExisting.set(code, inc);
        created++;
      }
    }

    db.calibration.items = mergedList;
  }

  db.calibration.meta = {
    importedAt: new Date().toISOString(),
    sourceFile: file.originalname || "",
    sheets: sheetNames
  };

  await writeDb(db);
  res.json({ ok: true, mode, imported: importedUnique.length, created, updated, skipped, sheets: sheetNames });
});

app.get("/api/calibration/export/excel", adminRequired, async (req, res) => {
  const db = await readDb();
  const base = `${req.protocol}://${req.get("host")}`;
  const items = (db.calibration?.items || []).map(it => {
    const out = { ...it };
    const u = String(out["ไฟล์ผลสอบเทียบ"] || "").trim();
    if (u) {
      out["ไฟล์ผลสอบเทียบ"] = /^https?:\/\//i.test(u) ? u : (base + (u.startsWith("/") ? u : ("/" + u)));
    } else {
      out["ไฟล์ผลสอบเทียบ"] = "";
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(items);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Calibration");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=UPH_MEM_calibration.xlsx");
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
});


// =========================
// Reports: Summary + Export (All-in-one)
// =========================
function ymdToDateUTC(s){
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(s||""));
  if(!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), 12, 0, 0));
  if(isNaN(dt.getTime())) return null;
  return dt;
}

function buildReportsSummary(db){
  const assets = db.assets || [];
  const calItems = db.calibration?.items || [];

  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
  const dayMs = 24*60*60*1000;

  let calOverdue = 0;
  let calDueSoon = 0;
  let calDueThisMonth = 0;
  let calNoDue = 0;
  let calWithFile = 0;
  const calByMonth = Array.from({length:12}, ()=>0);

  for(const it of calItems){
    const dueStr = it["วันครบกำหนดสอบเทียบ"];
    const due = ymdToDateUTC(dueStr);
    if(!due){
      calNoDue++;
    }else{
      const diffDays = Math.floor((due.getTime() - todayUTC.getTime())/dayMs);
      if(diffDays < 0) calOverdue++;
      else if(diffDays <= 30) calDueSoon++;
      if(due.getUTCFullYear() === todayUTC.getUTCFullYear() && due.getUTCMonth() === todayUTC.getUTCMonth()) calDueThisMonth++;
      calByMonth[due.getUTCMonth()]++;
    }
    if(String(it["ไฟล์ผลสอบเทียบ"]||"").trim()) calWithFile++;
  }

  // Maintenance summary (stored in assets)
  const maintKey = COL.MAINT;
  const maintByStatus = {};
  let maintPending = 0;
  let maintInProgress = 0;
  let maintDone = 0;

  for(const a of assets){
    const s = String(a[maintKey] || "").trim() || "ไม่ระบุ";
    maintByStatus[s] = (maintByStatus[s] || 0) + 1;

    // heuristic buckets
    if(s.includes("รอยืนยัน")) maintPending++;
    else if(s.includes("ดำเนิน")) maintInProgress++;
    else if(s.includes("เสร็จ")) maintDone++;
  }

  // Assets by location and by type/category (best-effort)
  const locKey = COL.LOC;
  const byLocation = {};
  for(const a of assets){
    const l = String(a[locKey] || "").trim() || "ไม่ระบุ";
    byLocation[l] = (byLocation[l] || 0) + 1;
  }

  const typeKeys = ["ประเภท", "หมวดหมู่", "ชนิดครุภัณฑ์", "ประเภทเครื่องมือ", "กลุ่ม"];
  const byType = {};
  for(const a of assets){
    let t = "";
    for(const k of typeKeys){
      if(a && a[k]){
        t = String(a[k]).trim();
        if(t) break;
      }
    }
    t = t || "ไม่ระบุ";
    byType[t] = (byType[t] || 0) + 1;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    assets: { total: assets.length, byLocation, byType },
    maintenance: { total: assets.length, pending: maintPending, inProgress: maintInProgress, done: maintDone, byStatus: maintByStatus },
    calibration: { total: calItems.length, overdue: calOverdue, dueSoon: calDueSoon, dueThisMonth: calDueThisMonth, noDueDate: calNoDue, withFile: calWithFile, byMonth: calByMonth }
  };
}

app.get("/api/reports/summary", authRequired, async (req, res) => {
  const db = await readDb();
  res.json(buildReportsSummary(db));
});

app.get("/api/reports/export/excel", adminRequired, async (req, res) => {
  const db = await readDb();
  const summary = buildReportsSummary(db);

  const wb = XLSX.utils.book_new();

  // Summary sheet (AOA)
  const maintRows = Object.entries(summary.maintenance.byStatus || {}).sort((a,b)=>b[1]-a[1]);
  const locRows = Object.entries(summary.assets.byLocation || {}).sort((a,b)=>b[1]-a[1]).slice(0, 30);
  const typeRows = Object.entries(summary.assets.byType || {}).sort((a,b)=>b[1]-a[1]).slice(0, 30);

  const aoa = [
    ["UPH MEM System - รายงานสรุป (Export)"],
    ["Generated At", summary.generatedAt],
    [],
    ["สรุปครุภัณฑ์"],
    ["รวมครุภัณฑ์ทั้งหมด", summary.assets.total],
    [],
    ["สรุปแจ้งซ่อม/บำรุงรักษา (จากครุภัณฑ์)"],
    ["รอยืนยัน", summary.maintenance.pending],
    ["กำลังดำเนินการ", summary.maintenance.inProgress],
    ["เสร็จสิ้น", summary.maintenance.done],
    [],
    ["สรุปแผนสอบเทียบ"],
    ["รวมรายการสอบเทียบ", summary.calibration.total],
    ["เกินกำหนด", summary.calibration.overdue],
    ["ใกล้ถึงกำหนด (≤ 30 วัน)", summary.calibration.dueSoon],
    ["กำหนดภายในเดือนนี้", summary.calibration.dueThisMonth],
    ["ไม่มีวันครบกำหนด", summary.calibration.noDueDate],
    ["มีไฟล์ผลสอบเทียบแนบแล้ว", summary.calibration.withFile],
    [],
    ["สถานะแจ้งซ่อม (แยกตามสถานะ)","จำนวน"]
  ];
  for(const [k,v] of maintRows) aoa.push([k, v]);
  aoa.push([]);
  aoa.push(["สถานที่ใช้งาน (Top 30)","จำนวน"]);
  for(const [k,v] of locRows) aoa.push([k, v]);
  aoa.push([]);
  aoa.push(["ประเภท/หมวดหมู่ (Top 30)","จำนวน"]);
  for(const [k,v] of typeRows) aoa.push([k, v]);

  const wsSummary = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  // Full data sheets
  const wsAssets = XLSX.utils.json_to_sheet(db.assets || []);
  XLSX.utils.book_append_sheet(wb, wsAssets, "Assets");

  const calItems = db.calibration?.items || [];
  const wsCal = XLSX.utils.json_to_sheet(calItems);
  XLSX.utils.book_append_sheet(wb, wsCal, "Calibration");

  // Maintenance view (subset)
  const maintView = (db.assets || []).map(a => ({
    [COL.CODE]: a[COL.CODE] || "",
    [COL.NAME]: a[COL.NAME] || "",
    [COL.MODEL]: a[COL.MODEL] || "",
    [COL.SN]: a[COL.SN] || "",
    [COL.LOC]: a[COL.LOC] || "",
    [COL.MAINT]: a[COL.MAINT] || "",
    "วันที่แจ้งซ่อมล่าสุด": a["วันที่แจ้งซ่อมล่าสุด"] || "",
    "หมายเหตุการซ่อม": a["หมายเหตุการซ่อม"] || ""
  }));
  const wsMaint = XLSX.utils.json_to_sheet(maintView);
  XLSX.utils.book_append_sheet(wb, wsMaint, "Maintenance");

  // Calibration attachments only
  const fileRows = calItems
    .filter(it => String(it["ไฟล์ผลสอบเทียบ"] || "").trim())
    .map(it => ({
      [COL.CODE]: it[COL.CODE] || it["รหัสเครื่องมือห้องปฏิบัติการ"] || "",
      "ชื่อ": it["ชื่อ"] || "",
      "วันครบกำหนดสอบเทียบ": it["วันครบกำหนดสอบเทียบ"] || "",
      "ไฟล์ผลสอบเทียบ": it["ไฟล์ผลสอบเทียบ"] || "",
      "ชื่อไฟล์ผลสอบเทียบ": it["ชื่อไฟล์ผลสอบเทียบ"] || ""
    }));
  const wsFiles = XLSX.utils.json_to_sheet(fileRows);
  XLSX.utils.book_append_sheet(wb, wsFiles, "CalibrationFiles");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=UPH_MEM_reports.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});


/** -----------------------------
 *  Calibration CRUD (Admin)
 * ------------------------------*/
app.post("/api/calibration", adminRequired, async (req, res) => {
  const db = await readDb();
  ensureDbSchema(db);

  const incoming = req.body || {};
  const norm = normalizeCalibrationRow(incoming, "");
  if (!norm) return res.status(400).json({ ok:false, message: "ข้อมูลไม่ครบ (ต้องมีรหัส/ชื่อ/SN อย่างน้อย 1 อย่าง)" });

  norm.id = "C-" + randomHex(6).toUpperCase();
  db.calibration.items.push(norm);
  await writeDb(db);
  res.json({ ok:true, item: norm });
});

app.put("/api/calibration/:id", adminRequired, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = await readDb();
  ensureDbSchema(db);

  const idx = (db.calibration.items || []).findIndex(x => String(x?.id||"") === id);
  if (idx < 0) return res.status(404).json({ ok:false, message: "ไม่พบรายการ" });

  const cur = db.calibration.items[idx];
  const merged = { ...cur, ...(req.body || {}), id: cur.id };
  const norm = normalizeCalibrationRow(merged, "");
  if (!norm) return res.status(400).json({ ok:false, message: "ข้อมูลไม่ครบ (ต้องมีรหัส/ชื่อ/SN อย่างน้อย 1 อย่าง)" });
  norm.id = cur.id;

  db.calibration.items[idx] = norm;
  await writeDb(db);
  res.json({ ok:true, item: norm });
});

/** -----------------------------
 *  Calibration file attach (Admin)
 * ------------------------------*/
app.post("/api/calibration/:id/file", adminRequired, (req, res, next) => {
  // multer error handling
  calFileUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message || "อัปโหลดไฟล์ไม่สำเร็จ" });
    next();
  });
}, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const file = req.file;
  if (!file) return res.status(400).json({ ok:false, message: "ไม่พบไฟล์" });

  const db = await readDb();
  ensureDbSchema(db);

  const idx = (db.calibration.items || []).findIndex(x => String(x?.id||"") === id);
  if (idx < 0) {
    // cleanup orphan file
    try { await fsp.unlink(file.path); } catch {}
    return res.status(404).json({ ok:false, message: "ไม่พบรายการสอบเทียบ" });
  }

  const cur = db.calibration.items[idx] || {};
  // delete old file if any
  const oldUrl = cur["ไฟล์ผลสอบเทียบ"];
  const oldDisk = diskPathFromPublicUrl(oldUrl);
  if (oldDisk) {
    try { await fsp.unlink(oldDisk); } catch {}
  }

  const publicUrl = `/assets/calibration_files/${path.basename(file.path)}`;
  db.calibration.items[idx] = {
    ...cur,
    "ไฟล์ผลสอบเทียบ": publicUrl,
    "ชื่อไฟล์ผลสอบเทียบ": file.originalname || path.basename(file.path),
    id: cur.id
  };

  await writeDb(db);
  res.json({ ok:true, url: publicUrl, name: db.calibration.items[idx]["ชื่อไฟล์ผลสอบเทียบ"] });
});

app.delete("/api/calibration/:id/file", adminRequired, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = await readDb();
  ensureDbSchema(db);

  const idx = (db.calibration.items || []).findIndex(x => String(x?.id||"") === id);
  if (idx < 0) return res.status(404).json({ ok:false, message: "ไม่พบรายการสอบเทียบ" });

  const cur = db.calibration.items[idx] || {};
  const oldUrl = cur["ไฟล์ผลสอบเทียบ"];
  const oldDisk = diskPathFromPublicUrl(oldUrl);
  if (oldDisk) {
    try { await fsp.unlink(oldDisk); } catch {}
  }

  db.calibration.items[idx] = {
    ...cur,
    "ไฟล์ผลสอบเทียบ": "",
    "ชื่อไฟล์ผลสอบเทียบ": "",
    id: cur.id
  };
  await writeDb(db);
  res.json({ ok:true });
});

app.delete("/api/calibration/:id", adminRequired, async (req, res) => {
  const id = String(req.params.id || "").trim();
  const db = await readDb();
  ensureDbSchema(db);

  const target = (db.calibration.items || []).find(x => String(x?.id||"") === id);
  if (!target) return res.status(404).json({ ok:false, message: "ไม่พบรายการ" });

  // delete attached file if any
  const oldUrl = target["ไฟล์ผลสอบเทียบ"];
  const oldDisk = diskPathFromPublicUrl(oldUrl);
  if (oldDisk) {
    try { await fsp.unlink(oldDisk); } catch {}
  }

  db.calibration.items = (db.calibration.items || []).filter(x => String(x?.id||"") !== id);

  await writeDb(db);
  res.json({ ok:true });
});

/** -----------------------------
 *  DB backup (Admin)
 * ------------------------------*/
app.get("/api/export/db", adminRequired, async (req, res) => {
  const raw = await fsp.readFile(DB_PATH);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=db.json");
  res.setHeader("Cache-Control", "no-store");
  res.send(raw);
});

app.post("/api/import/db", adminRequired, excelUpload.single("json"), async (req, res) => {
  const file = req.file;
  if (!file?.buffer) return res.status(400).json({ ok: false, message: "ไม่พบไฟล์ JSON" });

  let incoming;
  try{
    incoming = JSON.parse(file.buffer.toString("utf-8"));
  }catch(e){
    return res.status(400).json({ ok:false, message: "ไฟล์ JSON ไม่ถูกต้อง" });
  }

  incoming = ensureDbSchema(incoming);

  // atomic replace
  await writeDb(incoming);

  res.json({
    ok:true,
    assets: (incoming.assets||[]).length,
    calibration: (incoming.calibration?.items||[]).length
  });
});




app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const db = await readDb();
  const user = (db.users || []).find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ ok: false, message: "ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง" });

  const payload = {
    u: user.username,
    r: user.role,
    n: user.displayName,
    exp: Date.now() + (1000 * 60 * 60 * 8) // 8 hours
  };
  const token = makeToken(payload);
  res.json({ ok: true, token, user: { username: user.username, displayName: user.displayName, role: user.role } });
});

app.get("/api/me", authRequired, async (req, res) => {
  res.json({ ok: true, user: { username: req.user.u, displayName: req.user.n, role: req.user.r, exp: req.user.exp } });
});

// คืนค่ารหัสถัดไปสำหรับการเพิ่มรายการใหม่ (คำนวณจากข้อมูลทั้งหมดใน db.json)
// ใช้: GET /api/next-code?kind=EQ|GN (Admin only)
app.get("/api/next-code", adminRequired, async (req, res) => {
  const kind = String(req.query.kind || "EQ").toUpperCase();
  if (!["EQ","GN"].includes(kind)) {
    return res.status(400).json({ ok: false, message: "kind ต้องเป็น EQ หรือ GN" });
  }
  const db = await readDb();
  const next = nextAssetCode(db, kind);
  res.json({ ok: true, kind, next });
});

app.get("/api/assets", authRequired, async (req, res) => {
  const db = await readDb();
  let assets = db.assets || [];

  const q = (req.query.q || "").toString().trim().toLowerCase();
  if (q) {
    assets = assets.filter(a => {
      const code = (a["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString().toLowerCase();
      const name = (a["ชื่อ"] || "").toString().toLowerCase();
      const sn = (a["หมายเลขเครื่อง"] || "").toString().toLowerCase();
      const loc = (a["สถานที่ใช้งาน (ปัจจุบัน)"] || "").toString().toLowerCase();
      return code.includes(q) || name.includes(q) || sn.includes(q) || loc.includes(q);
    });
  }

  res.json({ ok: true, assets });
});

app.get("/api/assets/by-code/:code", async (req, res) => {
  const code = (req.params.code || "").toString();
  const db = await readDb();
  const asset = (db.assets || []).find(a => (a["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString() === code);
  if (!asset) return res.status(404).json({ ok: false, message: "ไม่พบครุภัณฑ์" });
  res.json({ ok: true, asset });
});

app.post("/api/assets", adminRequired, async (req, res) => {
  const db = await readDb();
  const asset = req.body || {};

  // Ensure required code
  const code = (asset["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString().trim();
  if (!code) return res.status(400).json({ ok: false, message: "ต้องมีรหัสเครื่องมือห้องปฏิบัติการ" });

  // Prevent duplicates
  const exists = (db.assets || []).some(a => (a["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString() === code);
  if (exists) return res.status(409).json({ ok: false, message: "รหัสนี้มีอยู่แล้ว" });

  asset.id = "A-" + randomHex(6).toUpperCase();
  if (!asset["สถานะแจ้งซ่อม"]) asset["สถานะแจ้งซ่อม"] = (db.maintenanceStatusChoices || [])[0] || "ยังไม่เคยแจ้งซ่อม";
  if (!asset["รูปภาพครุภัณฑ์"]) asset["รูปภาพครุภัณฑ์"] = "";

  db.assets = [asset, ...(db.assets || [])];
  await writeDb(db);
  res.json({ ok: true, asset });
});

app.put("/api/assets/:id", adminRequired, async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  const db = await readDb();
  const idx = (db.assets || []).findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "ไม่พบรายการ" });

  const original = db.assets[idx];
  db.assets[idx] = { ...original, ...updates, id: original.id };

  await writeDb(db);
  res.json({ ok: true, asset: db.assets[idx] });
});

app.delete("/api/assets/:id", adminRequired, async (req, res) => {
  const id = req.params.id;
  const db = await readDb();
  const before = (db.assets || []).length;
  db.assets = (db.assets || []).filter(a => a.id !== id);
  const after = db.assets.length;
  if (after === before) return res.status(404).json({ ok: false, message: "ไม่พบรายการ" });
  await writeDb(db);
  res.json({ ok: true });
});

app.post("/api/assets/:id/image", adminRequired, upload.single("image"), async (req, res) => {
  const id = req.params.id;
  const db = await readDb();
  const idx = (db.assets || []).findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "ไม่พบรายการ" });

  const filename = req.file?.filename;
  if (!filename) return res.status(400).json({ ok: false, message: "ไม่พบไฟล์รูป" });

  db.assets[idx]["รูปภาพครุภัณฑ์"] = `/assets/images/${filename}`;
  await writeDb(db);
  res.json({ ok: true, imagePath: db.assets[idx]["รูปภาพครุภัณฑ์"] });
});

app.get("/api/assets/:id/qr", async (req, res) => {
  const id = req.params.id;
  const db = await readDb();
  const asset = (db.assets || []).find(a => a.id === id);
  if (!asset) return res.status(404).send("Not found");

  const code = (asset["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString();
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const url = `${baseUrl}/qr.html?code=${encodeURIComponent(code)}`;

  try {
    const png = await QRCode.toBuffer(url, { type: "png", width: 420, margin: 1 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (e) {
    res.status(500).send("QR error");
  }
});

/** Public update from QR (optional): require login token (admin or user) */
app.put("/api/assets/by-code/:code", authRequired, async (req, res) => {
  const code = (req.params.code || "").toString();
  const updates = req.body || {};
  const db = await readDb();
  const idx = (db.assets || []).findIndex(a => (a["รหัสเครื่องมือห้องปฏิบัติการ"] || "").toString() === code);
  if (idx < 0) return res.status(404).json({ ok: false, message: "ไม่พบรายการ" });

  // allow any logged-in user to update only maintenance + note fields
  const allowed = new Set(["สถานะแจ้งซ่อม", "หมายเหตุการซ่อม", "วันที่แจ้งซ่อมล่าสุด"]);
  const sanitized = {};
  for (const k of Object.keys(updates)) {
    if (req.user.r === "admin" || allowed.has(k)) sanitized[k] = updates[k];
  }

  // User flow: if a normal user reports repair, it should go to "รอยืนยัน" first.
  if (req.user.r !== "admin" && Object.prototype.hasOwnProperty.call(sanitized, "สถานะแจ้งซ่อม")) {
    const v = String(sanitized["สถานะแจ้งซ่อม"] || "");
    // If user tries to set any non-empty status other than "ยังไม่เคย...", force to pending-confirm.
    if (v && !v.includes("ยังไม่เคย")) {
      sanitized["สถานะแจ้งซ่อม"] = "แจ้งซ่อมแล้ว - รอยืนยัน";
      if (!sanitized["วันที่แจ้งซ่อมล่าสุด"]) {
        sanitized["วันที่แจ้งซ่อมล่าสุด"] = new Date().toISOString().slice(0,10);
      }
      // Track reporter (optional fields)
      sanitized["ผู้แจ้งซ่อม"] = req.user.n || req.user.u;
      sanitized["เวลาที่แจ้งซ่อม"] = new Date().toISOString();
    }
  }

  db.assets[idx] = { ...db.assets[idx], ...sanitized };
  await writeDb(db);
  res.json({ ok: true, asset: db.assets[idx] });
});

app.get("*", (req, res) => {
  // SPA fallback
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`MEM System running on http://localhost:${PORT}`);
});
