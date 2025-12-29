/* QR page (public) */
const token = localStorage.getItem("mem_token") || "";
let currentUser = null;

function authHeaders(){
  return token ? { "Authorization": "Bearer " + token } : {};
}
async function fetchJson(url, opts={}){
  const { method="GET", body=null } = opts;
  const headers = { ...authHeaders() };
  let payload;
  if (body){
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const txt = await res.text();
  let data;
  try{ data = JSON.parse(txt); } catch { data = { ok:false, message: txt || "Unknown error" }; }
  if(!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}
function esc(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function qparam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name) || "";
}

async function load(){
  const code = qparam("code").trim();
  const kv = document.getElementById("qrKv");
  const imgBox = document.getElementById("qrImgBox");
  const caption = document.getElementById("qrCodeCaption");
  const btnDownloadQr = document.getElementById("btnDownloadQr");
  const reporterSel = document.getElementById("qrReporterSelect");

  if(!code){
    caption.textContent = "ไม่พบรหัส (code)";
    kv.innerHTML = `<div class="alert error">ไม่พบ parameter <b>code</b></div>`;
    return;
  }

  caption.textContent = `รหัส: ${code}`;
  // resolve current user role (optional)
  if(token){
    try{
      const me = await fetchJson("/api/me");
      currentUser = me.user || null;
    }catch{
      currentUser = null;
    }
  }

  try{
    const meta = await fetchJson("/api/meta");
    let choices = meta.maintenanceStatusChoices || [];
    // For normal users: only allow "ยังไม่เคย" and "รอยืนยัน" (admin will confirm)
    if((currentUser?.role || "") !== "admin"){
      choices = choices.filter(c => String(c).includes("ยังไม่เคย") || String(c).includes("รอยืนยัน"));
      if(choices.length === 0){
        choices = ["ยังไม่เคยแจ้งซ่อม", "แจ้งซ่อมแล้ว - รอยืนยัน"]; 
      }
    }
    fillMaintChoices(choices);
  }catch{}

  // Load reporter choices (if logged in)
  try{
    await fillReporterChoices(reporterSel);
  }catch{}

  try{
    const r = await fetchJson(`/api/assets/by-code/${encodeURIComponent(code)}`);
    const a = r.asset;
    // image
    if(a["รูปภาพครุภัณฑ์"]){
      imgBox.innerHTML = `<img src="${esc(a["รูปภาพครุภัณฑ์"])}" alt="asset">`;
    }else{
      imgBox.innerHTML = `<div class="muted">ยังไม่มีรูปภาพ</div>`;
    }

    // kv list
    const keysLeft = ["ชื่อ","รุ่น","หมายเลขเครื่อง","AssetID","สถานะ","สถานะแจ้งซ่อม"];
    const keysRight = ["ต้นทุนต่อหน่วย","ประเภทครุภัณฑ์","หมวดครุภัณฑ์","สถานที่ใช้งาน (ปัจจุบัน)","ผู้แจ้งซ่อม","วันที่แจ้งซ่อมล่าสุด","เวลาที่แจ้งซ่อม","หมายเหตุการซ่อม"];
    const all = [...keysLeft, ...keysRight];
    kv.innerHTML = all.map(k=>`
      <div class="kvItem">
        <div class="kvKey">${esc(k)}</div>
        <div class="kvVal">${esc(a[k] ?? "-")}</div>
      </div>
    `).join("");

    // QR download link
    if(a.id){
      btnDownloadQr.href = `/api/assets/${encodeURIComponent(a.id)}/qr`;
      btnDownloadQr.setAttribute("download", `${code}_qr.png`);
    }

    // fill edit form
    const maintSel = document.getElementById("qrMaintSelect");
    maintSel.value = (a["สถานะแจ้งซ่อม"] || "");
    document.getElementById("qrMaintDate").value = normalizeDate(a["วันที่แจ้งซ่อมล่าสุด"] || "");
    document.getElementById("qrMaintNote").value = (a["หมายเหตุการซ่อม"] || "");

    // reporter (Admin can choose; User is locked)
    if(reporterSel){
      const currentReporter = String(a["ผู้แจ้งซ่อม"] || "").trim();
      const mine = String(currentUser?.displayName || currentUser?.username || "").trim();
      const prefer = currentReporter || mine;
      if(prefer){
        ensureSelectHasOption(reporterSel, prefer);
        reporterSel.value = prefer;
      }
      if((currentUser?.role || "") !== "admin"){
        // keep only user's own name to avoid confusion
        if(mine){
          reporterSel.innerHTML = "";
          const opt = document.createElement("option");
          opt.value = mine;
          opt.textContent = mine;
          reporterSel.appendChild(opt);
          reporterSel.value = mine;
        }
        reporterSel.disabled = true;
      }
    }

    // If user is not admin and current status is already in progress/done, lock status change.
    if((currentUser?.role || "") !== "admin"){
      const cur = String(a["สถานะแจ้งซ่อม"] || "");
      if(cur.includes("กำลัง") || cur.includes("ซ่อมเสร็จ") || cur.includes("ปลดระวาง")){
        maintSel.disabled = true;
      }
      const btnSave = document.getElementById("btnQrSave");
      btnSave.textContent = "ส่งคำขอ/อัปเดตข้อมูล";
    }

    // login button
    const btnLogin = document.getElementById("btnQrLogin");
    if(token){
      btnLogin.textContent = "เข้าสู่ระบบแล้ว";
      btnLogin.disabled = true;
    }else{
      btnLogin.addEventListener("click", ()=> location.href = "/");
    }

    // save
    document.getElementById("btnQrSave").addEventListener("click", async ()=>{
      hideMsg();
      try{
        if(!token) throw new Error("กรุณา Login ก่อน");
        const payload = {
          "สถานะแจ้งซ่อม": document.getElementById("qrMaintSelect").value,
          "วันที่แจ้งซ่อมล่าสุด": document.getElementById("qrMaintDate").value || "",
          "หมายเหตุการซ่อม": document.getElementById("qrMaintNote").value || "",
          "ผู้แจ้งซ่อม": (document.getElementById("qrReporterSelect")?.value || "").trim()
        };
        await fetchJson(`/api/assets/by-code/${encodeURIComponent(code)}`, { method:"PUT", body: payload });
        showOk("บันทึกเรียบร้อยแล้ว");
      }catch(e){
        showErr(e.message || "บันทึกไม่สำเร็จ");
      }
    });

  }catch(e){
    kv.innerHTML = `<div class="alert error">${esc(e.message || "ไม่พบข้อมูล")}</div>`;
    imgBox.innerHTML = `<div class="muted">-</div>`;
  }
}

async function fillReporterChoices(sel){
  if(!sel) return;
  sel.innerHTML = "";

  if(!token){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "กรุณา Login เพื่อระบุผู้แจ้งซ่อม";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  let reporters = [];
  try{
    const r = await fetchJson("/api/reporters");
    reporters = Array.isArray(r.reporters) ? r.reporters : [];
  }catch{
    reporters = [];
  }

  const mine = String(currentUser?.displayName || currentUser?.username || "").trim();
  if(mine && !reporters.includes(mine)) reporters.unshift(mine);

  // De-dup + sort (Thai)
  const seen = new Set();
  reporters = reporters
    .map(s => String(s || "").trim())
    .filter(Boolean)
    .filter(s => (seen.has(s) ? false : (seen.add(s), true)))
    .sort((a,b)=> a.localeCompare(b, "th"));

  for(const name of reporters){
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }

  // Admin: allow add new
  if((currentUser?.role || "") === "admin"){
    const add = document.createElement("option");
    add.value = "__add__";
    add.textContent = "➕ เพิ่มชื่อใหม่…";
    sel.appendChild(add);

    sel.addEventListener("change", async ()=>{
      if(sel.value !== "__add__") return;
      const name = prompt("เพิ่มชื่อผู้แจ้งซ่อม (ผู้แจ้งซ่อม)");
      const v = String(name || "").trim();
      if(!v){
        sel.value = mine || "";
        return;
      }
      try{
        await fetchJson("/api/reporters", { method:"POST", body: { name: v } });
      }catch{ /* ถ้าบันทึกไม่ได้ ยังให้ใช้งานเฉพาะหน้านี้ได้ */ }
      ensureSelectHasOption(sel, v);
      sel.value = v;
    });
  }

  // Default selection
  if(mine) sel.value = mine;
}

function ensureSelectHasOption(sel, value){
  if(!sel || !value) return;
  const v = String(value).trim();
  if(!v) return;
  const exists = Array.from(sel.options).some(o => o.value === v);
  if(exists) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = v;
  // insert before add option if exists
  const addIdx = Array.from(sel.options).findIndex(o => o.value === "__add__");
  if(addIdx >= 0) sel.insertBefore(opt, sel.options[addIdx]);
  else sel.appendChild(opt);
}

function normalizeDate(v){
  // accept YYYY-MM-DD or others; keep if valid
  const s = (v||"").toString().trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "";
}

function fillMaintChoices(choices){
  const sel = document.getElementById("qrMaintSelect");
  sel.innerHTML = "";
  for(const c of choices){
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
}

function hideMsg(){
  document.getElementById("qrSaveMsg").classList.add("hidden");
  document.getElementById("qrSaveErr").classList.add("hidden");
}
function showOk(msg){
  const el = document.getElementById("qrSaveMsg");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function showErr(msg){
  const el = document.getElementById("qrSaveErr");
  el.textContent = msg;
  el.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", load);
