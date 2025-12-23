/* MEM System – UPH (Vanilla JS SPA) */

const API = {
  async meta(){ return fetchJson("/api/meta"); },
  async login(username, password){ return fetchJson("/api/login", { method:"POST", body: { username, password } }); },
  async me(){ return fetchJson("/api/me"); },
  async listAssets(q=""){ 
    const u = new URL("/api/assets", location.origin);
    if (q) u.searchParams.set("q", q);
    return fetchJson(u.pathname + u.search);
  },
  async importExcel(file, mode="merge"){
    const fd = new FormData();
    fd.append("excel", file);
    fd.append("mode", mode);
    return fetchJson(`/api/import/excel`, { method:"POST", body: fd, isForm:true });
  },
  async exportExcel(){
    return fetchBlob(`/api/export/excel`);
  },

async listCalibration(){
  return fetchJson("/api/calibration");
},
async importCalibrationExcel(file, mode="replace"){
  const fd = new FormData();
  fd.append("excel", file);
  fd.append("mode", mode);
  return fetchJson(`/api/calibration/import`, { method:"POST", body: fd, isForm:true });
},
async exportCalibrationExcel(){
  return fetchBlob(`/api/calibration/export/excel`);
},
async createCalibration(item){
  return fetchJson(`/api/calibration`, { method:"POST", body: item });
},
async updateCalibration(id, updates){
  return fetchJson(`/api/calibration/${encodeURIComponent(id)}`, { method:"PUT", body: updates });
},
async deleteCalibration(id){
  return fetchJson(`/api/calibration/${encodeURIComponent(id)}`, { method:"DELETE" });
},
async exportDbJson(){
  return fetchBlob(`/api/export/db`);
},
async importDbJson(file){
  const fd = new FormData();
  fd.append("json", file);
  return fetchJson(`/api/import/db`, { method:"POST", body: fd, isForm:true });
},
  async nextCode(kind){
    const r = await fetchJson(`/api/next-code?kind=${encodeURIComponent(kind)}`);
    return r.next;
  },
  // หมายเหตุ: การรันเลขรหัส (LAB-AS-EQ-Axxx / LAB-AS-GN-Axxx) ทำฝั่ง Client จากข้อมูลที่โหลดแล้ว (db.json / Excel ที่นำเข้า)
  async createAsset(asset){ return fetchJson("/api/assets", { method:"POST", body: asset }); },
  async updateAsset(id, updates){ return fetchJson(`/api/assets/${encodeURIComponent(id)}`, { method:"PUT", body: updates }); },
  async deleteAsset(id){ return fetchJson(`/api/assets/${encodeURIComponent(id)}`, { method:"DELETE" }); },
  async uploadImage(id, file){
    const fd = new FormData();
    fd.append("image", file);
    return fetchJson(`/api/assets/${encodeURIComponent(id)}/image`, { method:"POST", body: fd, isForm:true });
  }
};

const state = {
  token: localStorage.getItem("mem_token") || "",
  user: null,
  meta: null,
  assets: [],
  calibration: [],
  calibrationMeta: null,
  calibrationLoaded: false,
  calibrationLoading: false,
  calibrationLoadError: "",
  calChart: null,
  calSelectedId: null,
  calSearch: "",
  calYear: new Date().getFullYear(),
  calMonth: (new Date().getMonth()+1),
  calPage: 1,
  calPageSize: 10,
  route: "home",
  selectedId: null,
  chart: null,
  maintChoices: [],
  assetsPage: 1,
  assetsPageSize: 10
};

function authHeaders(){
  return state.token ? { "Authorization": "Bearer " + state.token } : {};
}

async function fetchJson(url, opts={}){
  const { method="GET", body=null, isForm=false } = opts;
  const headers = { ...authHeaders() };
  let payload;
  if (body && !isForm){
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (body && isForm){
    payload = body;
  }
  const res = await fetch(url, { method, headers, body: payload });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { ok:false, message: txt || "Unknown error" }; }
  if (!res.ok) {
    const msg = data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchBlob(url, opts={}){
  const { method="GET" } = opts;
  const headers = { ...authHeaders() };
  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const filename = getFilenameFromDisposition(res.headers.get("content-disposition")) || "export.xlsx";
  return { blob, filename };
}

function getFilenameFromDisposition(cd){
  if(!cd) return "";
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^;\"]+)"?/i.exec(cd);
  const name = decodeURIComponent(m?.[1] || m?.[2] || "");
  return name;
}

function $(sel){ return document.querySelector(sel); }
function el(tag, cls){ const e=document.createElement(tag); if(cls) e.className=cls; return e; }

function setActiveMenu(route){
  document.querySelectorAll(".menuBtn").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.route === route);
  });
}

function showLogin(){
  $("#appShell").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
  $("#loginError").classList.add("hidden");
}
function showApp(){
  $("#loginView").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
}

function initials(name){
  const s = (name||"").trim();
  if(!s) return "UP";
  const parts = s.split(/\s+/).slice(0,2);
  return parts.map(p=>p[0]?.toUpperCase()||"").join("").slice(0,2);
}

function badgeStatus(text){
  const t = (text||"").toString();
  if (t.includes("พร้อม")) return ["ok", t];
  if (t.includes("ซ่อมแซมได้")) return ["warn", t];
  if (t.includes("ซ่อมแซมไม่ได้") || t.includes("ชำรุด") ) return ["bad", t];
  if (t.includes("ตรวจไม่พบ") || t.includes("สูญ")) return ["neutral", t];
  return ["neutral", t || "-"];
}
function badgeMaint(text){
  const t = (text||"").toString();
  if (t.includes("ยังไม่เคย")) return ["ok", t];
  if (t.includes("ตีกลับ") || t.includes("ปฏิเสธ")) return ["bad", t];
  if (t.includes("รอยืนยัน")) return ["warn", t];
  if (t.includes("กำลัง")) return ["warn", t];
  if (t.includes("ซ่อมเสร็จ")) return ["ok", t];
  if (t.includes("ปลดระวาง")) return ["bad", t];
  return ["neutral", t || "-"];
}

function updateMaintenanceBadge(){
  const b = document.getElementById("maintBadge");
  if(!b) return;
  const pendingCount = (state.assets||[]).filter(a => String(a["สถานะแจ้งซ่อม"]||"").includes("รอยืนยัน")).length;
  b.textContent = String(pendingCount);
  b.classList.toggle("hidden", pendingCount <= 0);
}

function setPageHeader(title, subtitle){
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
}

function routeTo(route){
  state.route = route;
  setActiveMenu(route);
  render();
}

function safeNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// -------- Asset Code Generator (LAB-AS-EQ-Axxx / LAB-AS-GN-Axxx) --------
function pad3(n){
  const s = String(Math.max(0, Number(n)||0));
  return s.padStart(3, "0");
}

function getNextAssetCode(kind){
  // kind: "EQ" (เครื่องมือทางการแพทย์) | "GN" (ครุภัณฑ์)
  const codeKey = "รหัสเครื่องมือห้องปฏิบัติการ";
  const prefix = kind === "GN" ? "LAB-AS-GN-A" : "LAB-AS-EQ-A";
  const re = new RegExp("^" + prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "(\\d+)$", "i");
  let maxNum = 0;
  for(const a of (state.assets||[])){
    const code = String(a?.[codeKey] || "").trim();
    const m = re.exec(code);
    if(!m) continue;
    const num = Number(m[1]);
    if(Number.isFinite(num) && num > maxNum) maxNum = num;
  }
  return prefix + pad3(maxNum + 1);
}

/* -------- Render pages -------- */
function render(){
  const container = $("#pageContent");
  container.innerHTML = "";

  if (state.route === "home") renderHome(container);
  else if (state.route === "assets") renderAssets(container);
  else if (state.route === "maintenance") renderMaintenance(container);
  else if (state.route === "calibration") renderCalibration(container);
  else if (state.route === "reports") renderReports(container);
  else if (state.route === "qrlookup") renderQrLookup(container);
  else renderHome(container);
}

function renderHome(container){
  setPageHeader("Dashboard", "ภาพรวมการจัดการครุภัณฑ์และเครื่องมือทางการแพทย์ (ข้อมูลล่าสุดจาก db.json)");

  const card = el("div", "card");
  const header = el("div", "cardHeader");
  header.innerHTML = `
    <div>
      <div class="cardTitle">จำนวนครุภัณฑ์</div>
      <div class="cardSub">สรุปจำนวนทั้งหมด แยกตามสถานะ และภาพรวมการใช้งาน</div>
    </div>
    <div class="row gap8">
      <span class="pill">ผู้ใช้: ${escapeHtml(state.user?.displayName || "-")}</span>
      <span class="pill">Role: ${escapeHtml(state.user?.role || "-")}</span>
    </div>
  `;
  card.appendChild(header);

  const kpiRow = el("div", "kpiRow");
  const total = state.assets.length;

  const countBy = (key, val) => state.assets.filter(a => (a[key]||"") === val).length;
  const cntReady = countBy("สถานะ", "พร้อมใช้งาน");
  const cntRepairable = countBy("สถานะ", "ชำรุด(ซ่อมแซมได้)");
  const cntUnrepairable = countBy("สถานะ", "ชำรุด(ซ่อมแซมไม่ได้)");
  const cntMissing = countBy("สถานะ", "ตรวจไม่พบ");

  const locKey = "สถานที่ใช้งาน (ปัจจุบัน)";
  const locMap = new Map();
  for(const a of state.assets){
    const loc = (a[locKey]||"").toString().trim();
    if(!loc) continue;
    locMap.set(loc, (locMap.get(loc)||0)+1);
  }
  const locTotal = locMap.size;
  let topLoc = "-";
  let topLocCount = 0;
  for(const [k,v] of locMap.entries()){
    if(v>topLocCount){ topLoc = k; topLocCount=v; }
  }

  kpiRow.appendChild(kpi("รวมครุภัณฑ์ทั้งหมด", total, "ทั้งหมด"));
  kpiRow.appendChild(kpi("พร้อมใช้งาน", cntReady, "สถานะดี"));
  kpiRow.appendChild(kpi("ชำรุด (ซ่อมแซมได้)", cntRepairable, "ต้องซ่อมแซม"));
  kpiRow.appendChild(kpi("ชำรุด (ซ่อมแซมไม่ได้)", cntUnrepairable, "พิจารณาจัดหาใหม่"));
  kpiRow.appendChild(kpi("ตรวจไม่พบ / สูญหาย", cntMissing, "ติดตามตรวจสอบ"));
  kpiRow.appendChild(kpi("จำนวนสถานที่ใช้งานทั้งหมด", locTotal, "ตามข้อมูล"));
  kpiRow.appendChild(kpi("สถานที่ที่มีครุภัณฑ์มากที่สุด", topLoc, `${topLocCount} รายการ`));
  card.appendChild(kpiRow);

  const chartWrap = el("div", "grid2");
  const chartCard = el("div", "card");
  chartCard.style.marginBottom = "0";
  chartCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">สัดส่วนตามสถานะครุภัณฑ์</div>
        <div class="cardSub">แสดงสัดส่วนและจำนวนครุภัณฑ์แต่ละสถานะ</div>
      </div>
    </div>
    <canvas id="statusChart" height="230"></canvas>
  `;

  const tableCard = el("div", "card");
  tableCard.style.marginBottom = "0";
  const rows = groupCounts(state.assets, "สถานะ");
  tableCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">ตารางสรุปสถานะ</div>
        <div class="cardSub">จำนวนรายการในแต่ละสถานะ</div>
      </div>
    </div>
    ${miniTable(rows, ["label","count"], {"label":"สถานะ","count":"จำนวน (รายการ)"})}
  `;

  chartWrap.appendChild(chartCard);
  chartWrap.appendChild(tableCard);

  container.appendChild(card);
  container.appendChild(chartWrap);

  renderStatusChart(rows);
}

function renderAssets(container){
  setPageHeader("รายการครุภัณฑ์", "ค้นหา ดูรายละเอียด เพิ่ม/แก้ไข/ลบ (Admin) พร้อมอัปโหลดรูปและสร้าง QR");

  const card = el("div", "card");
  const isAdmin = state.user?.role === "admin";

  card.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">ตารางรายการครุภัณฑ์</div>
        <div class="cardSub">คลิกที่แถวเพื่อเปิดฟอร์มรายละเอียด (รองรับค้นหา)</div>
      </div>
      <div class="row gap8">
        <input id="assetSearch" class="pill" style="border-radius:16px; border:1px solid var(--border); padding:10px 12px; min-width:240px;"
               placeholder="ค้นหา: รหัส / ชื่อ / S/N / สถานที่" />
        ${isAdmin ? `
          <button id="btnImportExcel" class="btn btnGhost">นำเข้า Excel</button>
          <button id="btnExportExcel" class="btn btnGhost">Export Excel</button>
          <input id="excelFile" type="file" accept=".xlsx,.xls" style="display:none" />
          <button id="btnNewEQ" class="btn btnPrimary" title="เพิ่มเครื่องมือทางการแพทย์ (รหัส LAB-AS-EQ-Axxx)">+ เพิ่มเครื่องมือแพทย์</button>
          <button id="btnNewGN" class="btn btnGhost" title="เพิ่มครุภัณฑ์ (รหัส LAB-AS-GN-Axxx)">+ เพิ่มครุภัณฑ์</button>
        ` : ``}
      </div>
    </div>
    <div class="tableWrap" id="assetTableWrap"></div>
    <div id="assetPager" class="pager"></div>
  `;
  container.appendChild(card);

  const detailCard = el("div", "card");
  detailCard.id = "assetDetailAnchor";
  detailCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">รายละเอียดครุภัณฑ์</div>
        <div class="cardSub">แก้ไขข้อมูล พร้อมรูปภาพ และ QR (ผู้ใช้ทั่วไปดูได้ / อัปเดตสถานะแจ้งซ่อมได้ที่หน้า QR)</div>
      </div>
      <div class="row gap8">
        <button id="btnRefreshAssets" class="btn btnGhost">รีเฟรช</button>
      </div>
    </div>
    <div id="assetDetailEmpty" class="muted">เลือกครุภัณฑ์จากตารางเพื่อดูรายละเอียด</div>
    <div id="assetDetail"></div>
  `;
  container.appendChild(detailCard);

  $("#assetSearch").addEventListener("input", debounce(async (e)=> {
    // ✅ ค้นหาแบบพิมพ์ได้ลื่น: ไม่ re-render ทั้งหน้า (จะไม่ทำให้ช่องค้นหากระตุก/เสียโฟกัส)
    const q = (e.target.value || "").trim();

    // ค้นหาเมื่อพิมพ์หยุดสักพัก (ลดจำนวน request) — อนุญาตให้ค้นหาว่างเพื่อรีเซ็ต
    if (q.length === 0 || q.length >= 2) {
      await loadAssets(q);
      state.assetsPage = 1;

      // อัปเดตเฉพาะตาราง ไม่ล้างหน้าใหม่
      if (state.route === "assets") {
        renderAssetsTable();
      } else {
        render();
      }
    }
  }, 500));

  // กด Enter เพื่อค้นหาทันที
  $("#assetSearch").addEventListener("keydown", async (e)=> {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = (e.target.value || "").trim();
    await loadAssets(q);
    state.assetsPage = 1;
    if (state.route === "assets") renderAssetsTable();
    else render();
  });

  if (isAdmin){
    // เพิ่มรายการใหม่ (2 ประเภท) + เด้งลงไปฟอร์มกรอกรายละเอียดทันที
    $("#btnNewEQ")?.addEventListener("click", async ()=> {
      const prefillCode = await API.nextCode("EQ").catch(()=> getNextAssetCode("EQ"));
      openAssetEditor(null, { newKind: "EQ", prefillCode, scrollToDetail: true, focusId: "f_name" });
    });
    $("#btnNewGN")?.addEventListener("click", async ()=> {
      const prefillCode = await API.nextCode("GN").catch(()=> getNextAssetCode("GN"));
      openAssetEditor(null, { newKind: "GN", prefillCode, scrollToDetail: true, focusId: "f_name" });
    });

    // Excel import
    $("#btnImportExcel")?.addEventListener("click", ()=> $("#excelFile")?.click());
    $("#excelFile")?.addEventListener("change", async (e)=>{
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const replace = confirm(
        "ต้องการ 'แทนที่ข้อมูลทั้งหมด' ด้วยไฟล์ Excel นี้หรือไม่?\n\n" +
        "กด OK = แทนที่ทั้งหมด\n" +
        "กด Cancel = ผสาน/อัปเดตตามรหัสเครื่องมือ (แนะนำ)"
      );
      const mode = replace ? "replace" : "merge";

      try{
        const r = await API.importExcel(file, mode);
        await loadAssets($("#assetSearch")?.value?.trim()||"");
        toast("#assetMsgOk", `นำเข้า Excel สำเร็จ • นำเข้า ${r.imported} แถว • เพิ่ม ${r.created} • อัปเดต ${r.updated} • ข้าม ${r.skipped}`);
        render();
      }catch(err){
        // show in page-level alert if available, else fallback
        const msg = err?.message || "นำเข้า Excel ไม่สำเร็จ";
        alert(msg);
      }
    });

    // Excel export
    $("#btnExportExcel")?.addEventListener("click", async ()=>{
      try{
        const { blob, filename } = await API.exportExcel();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "UPH_MEM_assets.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
      }catch(err){
        alert(err?.message || "Export Excel ไม่สำเร็จ");
      }
    });
  }
  $("#btnRefreshAssets").addEventListener("click", async ()=>{
    await loadAssets($("#assetSearch").value.trim());
    if (state.route === "assets") renderAssetsTable();
    else render();
  });

renderAssetsTable();
  if (state.selectedId){
    const found = state.assets.find(a=>a.id === state.selectedId);
    if (found) openAssetEditor(found, { inPlace:true });
  }
}

function renderMaintenance(container){
  setPageHeader("แจ้งซ่อม / บำรุงรักษา", "สรุปจำนวนตามสถานะแจ้งซ่อม และดูรายการที่ต้องติดตาม");

  const isAdmin = state.user?.role === "admin";
  const card = el("div", "card");
  const rows = groupCounts(state.assets, "สถานะแจ้งซ่อม");
  const pending = state.assets.filter(a => String(a["สถานะแจ้งซ่อม"]||"").includes("รอยืนยัน"));
  const inProgress = state.assets.filter(a => String(a["สถานะแจ้งซ่อม"]||"").includes("กำลัง"));

  function pendingTable(items){
    const cols = [
      "รหัสเครื่องมือห้องปฏิบัติการ",
      "ชื่อ",
      "หมายเลขเครื่อง",
      "สถานที่ใช้งาน (ปัจจุบัน)",
      "วันที่แจ้งซ่อมล่าสุด",
      "หมายเหตุการซ่อม",
      "ผู้แจ้งซ่อม",
    ];
    // NOTE: วางปุ่มการทำงานไว้คอลัมน์แรก เพื่อให้มองเห็นชัด (ไม่ต้องเลื่อนแนวนอน)
    const head = `
      ${isAdmin ? `<th style="min-width:120px;">ยืนยัน</th><th style="min-width:120px;">ตีกลับ</th>` : ``}
      <th style="min-width:160px;">รหัสเครื่องมือห้องปฏิบัติการ</th>
      <th style="min-width:220px;">ชื่อ</th>
      <th style="min-width:150px;">หมายเลขเครื่อง</th>
      <th style="min-width:200px;">สถานที่ใช้งาน (ปัจจุบัน)</th>
      <th style="min-width:140px;">วันที่แจ้งซ่อม</th>
      <th style="min-width:260px;">หมายเหตุ</th>
      <th style="min-width:140px;">ผู้แจ้งซ่อม</th>
    `;
    const body = (items||[]).map(a=>{
      const id = escapeHtml(a.id);
      const code = escapeHtml(a["รหัสเครื่องมือห้องปฏิบัติการ"]||"");
      const name = escapeHtml(a["ชื่อ"]||"");
      const sn = escapeHtml(a["หมายเลขเครื่อง"]||"");
      const loc = escapeHtml(a["สถานที่ใช้งาน (ปัจจุบัน)"]||"");
      const d = escapeHtml(a["วันที่แจ้งซ่อมล่าสุด"]||"");
      const note = escapeHtml(a["หมายเหตุการซ่อม"]||"");
      const by = escapeHtml(a["ผู้แจ้งซ่อม"]||"");
      return `
        <tr data-id="${id}">
          ${isAdmin ? `
            <td><button type="button" class="btn btnPrimary btnSm btnConfirmRepair" data-id="${id}" title="ยืนยันการแจ้งซ่อม">ยืนยัน</button></td>
            <td><button type="button" class="btn btnGhost btnSm btnRejectRepair" data-id="${id}" title="ตีกลับ/ปฏิเสธการแจ้งซ่อม">ตีกลับ</button></td>
          ` : ``}
          <td class="nowrap">${code}</td>
          <td>${name}</td>
          <td class="nowrap">${sn}</td>
          <td>${loc}</td>
          <td class="nowrap">${d}</td>
          <td>${note}</td>
          <td class="nowrap">${by}</td>
        </tr>
      `;
    }).join("");

    const colspan = isAdmin ? 9 : 7;
    return `
      <table class="clickableTable maintTable">
        <thead><tr>${head}</tr></thead>
        <tbody>
          ${body || `<tr><td colspan="${colspan}" class="muted">ไม่มีรายการรอยืนยัน</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function ensureMaintTableClass(tableHtml){
    // Add class to the first <table> tag if not present
    return (tableHtml || "").replace(
      /<table(?![^>]*class=)/i,
      '<table class="maintTable"'
    ).replace(
      /<table([^>]*class=")([^"]*)"/i,
      (m, pre, cls) => cls.includes('maintTable') ? m : `<table${pre}${cls} maintTable"`
    );
  }

  card.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">ภาพรวมสถานะแจ้งซ่อม</div>
        <div class="cardSub">มีขั้นตอน “รอยืนยัน” เพื่อให้แอดมินตรวจสอบก่อนเริ่มดำเนินการ</div>
      </div>
      <div class="row gap8">
        <span class="pill">รอยืนยัน: <b>${pending.length}</b></span>
        <span class="pill">กำลังดำเนินการ: <b>${inProgress.length}</b></span>
      </div>
    </div>

    <div id="maintMsgOk" class="alert ok hidden" style="margin-top:10px;"></div>
    <div id="maintMsgErr" class="alert error hidden" style="margin-top:10px;"></div>

    <div class="gridMaint" style="align-items:start;">
      <div>
        ${miniTable(rows, ["label","count"], {"label":"สถานะแจ้งซ่อม","count":"จำนวน (รายการ)"})}
      </div>
      <div>
        <div class="card allowOverflow" style="margin:0 0 12px 0;">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">รายการรอยืนยันการแจ้งซ่อม</div>
              <div class="cardSub">สถานะ: แจ้งซ่อมแล้ว - รอยืนยัน ${isAdmin ? "(กดยืนยันเพื่อเริ่มดำเนินการ)" : ""} <span class="muted">• เลื่อนตารางเพื่อดูคอลัมน์ด้านขวา</span></div>
            </div>
          </div>
          <div id="pendingWrap" class="tableWrap tableScrollX scrollY">${pendingTable(pending)}</div>
          </div>
        </div>

        <div class="card allowOverflow" style="margin:0;">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">รายการที่อยู่ระหว่างดำเนินการ</div>
              <div class="cardSub">สถานะ: แจ้งซ่อมแล้ว - กำลังดำเนินการ <span class="muted">• เลื่อนตารางเพื่อดูคอลัมน์ด้านขวา</span></div>
            </div>
          </div>
          <div id="inProgressWrap" class="tableWrap tableScrollX scrollY">${ensureMaintTableClass(assetsTable(inProgress, { compact:true }))}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.appendChild(card);

  if (isAdmin) {
    card.querySelectorAll(".btnConfirmRepair").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;

        const ok = confirm("ยืนยันการแจ้งซ่อมรายการนี้?\nระบบจะเปลี่ยนสถานะเป็น: แจ้งซ่อมแล้ว - กำลังดำเนินการ");
        if (!ok) return;

        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = "กำลังยืนยัน…";

        try {
          const today = new Date();
          const ymd = today.toISOString().slice(0,10);
          await API.updateAsset(id, {
            "สถานะแจ้งซ่อม": "แจ้งซ่อมแล้ว - กำลังดำเนินการ",
            "วันที่ยืนยันแจ้งซ่อม": ymd,
            "ผู้ยืนยันแจ้งซ่อม": state.user?.displayName || state.user?.username || "admin",
            "เวลาที่ยืนยันแจ้งซ่อม": today.toISOString()
          });
          await loadAssets();
          toast("#maintMsgOk", "ยืนยันการแจ้งซ่อมเรียบร้อยแล้ว");
          render();
        } catch (err) {
          toast("#maintMsgErr", err.message || "ยืนยันไม่สำเร็จ", true);
          btn.disabled = false;
          btn.textContent = oldText;
        }
      });
    });

    card.querySelectorAll(".btnRejectRepair").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;

        const reason = prompt("ตีกลับ/ปฏิเสธการแจ้งซ่อม\nกรุณาระบุเหตุผล (จำเป็น)", "ข้อมูลไม่ครบ / ต้องการรายละเอียดเพิ่มเติม");
        if (reason === null) return;
        const r = String(reason || "").trim();
        if (!r) {
          alert("กรุณาระบุเหตุผลการตีกลับ/ปฏิเสธ");
          return;
        }

        const ok = confirm("ยืนยันการตีกลับ/ปฏิเสธรายการนี้?\nระบบจะเปลี่ยนสถานะเป็น: แจ้งซ่อมแล้ว - ตีกลับ");
        if (!ok) return;

        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = "กำลังตีกลับ…";

        try {
          const today = new Date();
          const ymd = today.toISOString().slice(0,10);
          await API.updateAsset(id, {
            "สถานะแจ้งซ่อม": "แจ้งซ่อมแล้ว - ตีกลับ",
            "วันที่ตีกลับแจ้งซ่อม": ymd,
            "ผู้ตีกลับแจ้งซ่อม": state.user?.displayName || state.user?.username || "admin",
            "เหตุผลตีกลับแจ้งซ่อม": r,
            "เวลาที่ตีกลับแจ้งซ่อม": today.toISOString()
          });
          await loadAssets();
          toast("#maintMsgOk", "ตีกลับ/ปฏิเสธการแจ้งซ่อมเรียบร้อยแล้ว");
          render();
        } catch (err) {
          toast("#maintMsgErr", err.message || "ตีกลับไม่สำเร็จ", true);
          btn.disabled = false;
          btn.textContent = oldText;
        }
      });
    });
  }
}

/**
 * Always-visible horizontal range slider for a scrollable table wrapper.
 * - Works even when OS hides scrollbars
 * - Syncs both directions (drag slider <-> table scroll)
 */
function initHScrollRanges(root){
  const scope = root || document;
  const ranges = scope.querySelectorAll?.('.hScrollRange') || [];

  ranges.forEach((range)=>{
    const targetId = range.dataset.target;
    if (!targetId) return;
    const wrap = scope.querySelector('#' + CSS.escape(targetId));
    if (!wrap) return;

    if (range.dataset.inited === '1') return;
    range.dataset.inited = '1';

    // Ensure horizontal overflow is actually possible (some global table rules may fight this)
    const table = wrap.querySelector('table');
    if (table){
      table.classList.add('maintTable');
      table.style.width = 'max-content';
      table.style.minWidth = '1700px';
      table.style.tableLayout = 'auto';
    }

    const sync = ()=>{
      const maxScroll = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      range.max = String(maxScroll);
      range.value = String(Math.min(maxScroll, Math.max(0, wrap.scrollLeft)));
      range.disabled = maxScroll <= 0;
      range.classList.toggle('isDisabled', maxScroll <= 0);
    };

    // Slider -> scroll
    range.addEventListener('input', ()=>{
      wrap.scrollLeft = Number(range.value || '0');
    });

    // Scroll -> slider
    wrap.addEventListener('scroll', ()=>{
      range.value = String(wrap.scrollLeft);
    }, { passive:true });

    // Recalc on resize/content changes
    const syncDebounced = debounce(sync, 60);
    window.addEventListener('resize', syncDebounced);

    if (window.ResizeObserver){
      const ro = new ResizeObserver(()=> syncDebounced());
      ro.observe(wrap);
      if (table) ro.observe(table);
      range._hScrollRO = ro;
    }
    if (window.MutationObserver){
      const mo = new MutationObserver(()=> syncDebounced());
      mo.observe(wrap, { childList:true, subtree:true, characterData:true });
      range._hScrollMO = mo;
    }

    // Initial sync (fonts/layout can be late)
    requestAnimationFrame(()=> requestAnimationFrame(sync));
    setTimeout(sync, 80);
    setTimeout(sync, 300);
  });
}

function renderReports(container){
  setPageHeader("รายงานสรุป", "พื้นที่สำหรับรายงาน/วิเคราะห์ข้อมูลเพิ่มเติมในอนาคต");
  const card = el("div", "card");
  card.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">รายงาน</div>
        <div class="cardSub">คุณสามารถต่อยอดเพิ่ม Export PDF/Excel หรือรายงานตาม ISO ได้ในหน้านี้</div>
      </div>
    </div>
    <div class="muted">
      ✅ แนะนำ: เพิ่มปุ่ม “Export CSV/Excel” และ “สรุปตามหน่วยงาน/สถานที่ใช้งาน” ได้ทันทีในเวอร์ชันถัดไป
    </div>
  `;
  container.appendChild(card);
}

function renderQrLookup(container){
  setPageHeader("เปิดข้อมูลจากรหัส (QR)", "เลือกจากรายการได้เลย ไม่ต้องพิมพ์รหัสเอง (คลิกแถวเพื่อเปิดหน้า QR)");

  const card = el("div", "card");
  card.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">เปิดหน้าข้อมูลจากรหัส</div>
        <div class="cardSub">เลือกจากรายการด้านล่าง แล้วกด “เปิดหน้า QR” หรือคลิกแถวเพื่อเปิดทันที</div>
      </div>
      <div class="row gap8">
        <span class="pill">${escapeHtml(state.assets.length)} รายการ</span>
      </div>
    </div>

    <div class="grid2" style="align-items:end;">
      <div class="field">
        <label>เลือกรหัสเครื่องมือห้องปฏิบัติการ</label>
        <select id="qrSelect" style="height:46px;">
          <option value="">— เลือกจากรายการ —</option>
        </select>
        <div class="help">Tip: ถ้ารายการเยอะ สามารถใช้ Search ในหน้า “รายการครุภัณฑ์” แล้วคลิกดาวน์โหลด/เปิด QR ได้เช่นกัน</div>
      </div>

      <div class="field">
        <label>เปิดหน้า</label>
        <button id="btnOpenQr" class="btn btnPrimary" style="height:46px; width:100%;">เปิดหน้า QR</button>
      </div>
    </div>

    <div id="qrLookupMsg" class="alert error hidden" style="margin-top:12px;"></div>

    <div style="margin-top:14px;">
      <div class="muted" style="font-weight:900; margin-bottom:8px;">คลิกที่แถวเพื่อเปิดหน้า QR ทันที</div>
      <div class="tableWrap">
        <table class="clickableTable">
          <thead>
            <tr>
              <th style="min-width:150px;">รหัส</th>
              <th style="min-width:220px;">ชื่อ</th>
              <th style="min-width:160px;">รุ่น</th>
              <th style="min-width:160px;">สถานที่ใช้งาน</th>
              <th style="min-width:110px;">เปิด</th>
            </tr>
          </thead>
          <tbody id="qrTableBody">
            <tr><td colspan="5" class="muted">กำลังโหลดรายการ…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  container.appendChild(card);

  const codeKey = "รหัสเครื่องมือห้องปฏิบัติการ";
  const nameKey = "ชื่อ";
  const modelKey = "รุ่น";
  const locKey = "สถานที่ใช้งาน (ปัจจุบัน)";

  const items = [...state.assets]
    .filter(a => (a[codeKey] || "").toString().trim())
    .sort((a,b)=> String(a[codeKey]).localeCompare(String(b[codeKey]), "th"));

  // Populate select
  const sel = $("#qrSelect");
  for(const a of items){
    const code = String(a[codeKey] || "").trim();
    const name = String(a[nameKey] || "").trim();
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name ? `${code} — ${name}` : code;
    sel.appendChild(opt);
  }

  // Populate table
  const tbody = $("#qrTableBody");
  if(items.length === 0){
    tbody.innerHTML = `<tr><td colspan="5" class="muted">ยังไม่มีข้อมูลครุภัณฑ์ในฐานข้อมูล</td></tr>`;
  } else {
    tbody.innerHTML = items.map(a=>{
      const code = escapeHtml(String(a[codeKey]||""));
      const name = escapeHtml(String(a[nameKey]||""));
      const model = escapeHtml(String(a[modelKey]||""));
      const loc = escapeHtml(String(a[locKey]||""));
      return `
        <tr data-code="${code}">
          <td class="nowrap">${code}</td>
          <td>${name}</td>
          <td>${model}</td>
          <td>${loc}</td>
          <td><button class="btn btnGhost btnOpenRow" data-code="${code}" style="height:32px;">เปิด</button></td>
        </tr>
      `;
    }).join("");
  }

  function openCode(code){
    const c = (code||"").toString().trim();
    if(!c){
      $("#qrLookupMsg").textContent = "กรุณาเลือกรหัสจากรายการ";
      $("#qrLookupMsg").classList.remove("hidden");
      return;
    }
    location.href = `/qr.html?code=${encodeURIComponent(c)}`;
  }

  $("#btnOpenQr").addEventListener("click", ()=>{
    $("#qrLookupMsg").classList.add("hidden");
    openCode(sel.value);
  });

  sel.addEventListener("change", ()=>{
    $("#qrLookupMsg").classList.add("hidden");
  });

  // row click
  tbody.querySelectorAll("tr[data-code]").forEach(tr=>{
    tr.addEventListener("click", (e)=>{
      const btn = e.target.closest(".btnOpenRow");
      const code = (btn?.dataset?.code) || tr.getAttribute("data-code");
      sel.value = code;
      openCode(code);
    });
  });
}


function parseYMD(s){
  const t = (s||"").toString().trim();
  if(!t) return null;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d){
  if(!d) return "-";
  try{
    return new Intl.DateTimeFormat("th-TH", { dateStyle:"medium" }).format(d);
  }catch{
    return d.toISOString().slice(0,10);
  }
}
function daysDiff(a,b){
  return Math.floor((a.getTime() - b.getTime()) / (1000*60*60*24));
}
function badgeCal(item){
  const due = parseYMD(item["วันครบกำหนดสอบเทียบ"]);
  if(!due) return ["neutral", "ไม่ระบุวันสอบเทียบ"];
  const now = new Date();
  const diff = daysDiff(due, now); // due - now (days)
  if (diff < 0) return ["bad", "เกินกำหนด"];
  if (diff <= 30) return ["warn", "ใกล้ถึงกำหนด (<1 เดือน)"];
  return ["ok", "ปกติ"];
}

async function ensureCalibrationLoaded(){
  // IMPORTANT:
  // - รายการสอบเทียบอาจมี 0 รายการ ([])
  // - ถ้าเราใช้เงื่อนไข length จะทำให้โหลดซ้ำ + render ซ้ำไม่จบ
  //   ส่งผลให้ "กดอะไรไม่ได้เลย" เพราะหน้า re-render รัวๆ
  if (state.calibrationLoaded) return;
  state.calibrationLoading = true;
  state.calibrationLoadError = "";
  try{
    const r = await API.listCalibration();
    state.calibration = r.items || [];
    state.calibrationMeta = r.meta || null;
  }catch(e){
    state.calibration = [];
    state.calibrationMeta = null;
    state.calibrationLoadError = e?.message || "โหลดข้อมูลสอบเทียบไม่สำเร็จ";
  }finally{
    state.calibrationLoaded = true;
    state.calibrationLoading = false;
  }
}

function getCalPageInfo(items){
  const size = Number(state.calPageSize || 10);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = Number(state.calPage || 1);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pages) page = pages;
  state.calPage = page;

  const startIdx = (page - 1) * size;
  const endIdx = Math.min(startIdx + size, total);
  const slice = items.slice(startIdx, endIdx);

  const from = total === 0 ? 0 : startIdx + 1;
  const to = total === 0 ? 0 : endIdx;
  return { page, pages, size, total, from, to, slice };
}

function renderCalPager(targetId, items){
  const pager = document.getElementById(targetId);
  if (!pager) return;
  const info = getCalPageInfo(items);
  const disabledPrev = info.page <= 1 ? "disabled" : "";
  const disabledNext = info.page >= info.pages ? "disabled" : "";

  pager.innerHTML = `
    <div class="row" style="justify-content:space-between; gap:10px; margin-top:10px; flex-wrap:wrap;">
      <div class="muted">แสดง ${info.from}-${info.to} จาก ${info.total} รายการ</div>
      <div class="row gap8">
        <button class="btn btnGhost" id="calPrev" ${disabledPrev}>◀ ก่อนหน้า</button>
        <div class="pill">หน้า ${info.page} / ${info.pages}</div>
        <button class="btn btnGhost" id="calNext" ${disabledNext}>ถัดไป ▶</button>
      </div>
    </div>
  `;
  document.getElementById("calPrev")?.addEventListener("click", ()=>{
    state.calPage = Math.max(1, state.calPage - 1);
    render();
  });
  document.getElementById("calNext")?.addEventListener("click", ()=>{
    state.calPage = state.calPage + 1;
    render();
  });
}

function calibrationTable(items){
  const cols = [
    "รหัสเครื่องมือห้องปฏิบัติการ",
    "ชื่อ",
    "รุ่น",
    "หมายเลขเครื่อง",
    "สถานที่ใช้งาน (ปัจจุบัน)",
    "วันที่สอบเทียบล่าสุด",
    "วันครบกำหนดสอบเทียบ",
    "สถานะสอบเทียบ",
    "หมายเหตุ"
  ];
  const head = cols.map(c=>`<th>${escapeHtml(c)}</th>`).join("");
  const body = items.map(a=>{
    const [cls, txt] = badgeCal(a);
    return `<tr data-id="${escapeHtml(a.id)}">
      <td class="nowrap">${escapeHtml(a["รหัสเครื่องมือห้องปฏิบัติการ"]||"")}</td>
      <td>${escapeHtml(a["ชื่อ"]||"")}</td>
      <td>${escapeHtml(a["รุ่น"]||"")}</td>
      <td class="nowrap">${escapeHtml(a["หมายเลขเครื่อง"]||"")}</td>
      <td>${escapeHtml(a["สถานที่ใช้งาน (ปัจจุบัน)"]||"")}</td>
      <td class="nowrap">${escapeHtml(a["วันที่สอบเทียบล่าสุด"]||"")}</td>
      <td class="nowrap">${escapeHtml(a["วันครบกำหนดสอบเทียบ"]||"")}</td>
      <td><span class="badge ${cls}">${escapeHtml(txt)}</span></td>
      <td>${escapeHtml(a["หมายเหตุ"]||"")}</td>
    </tr>`;
  }).join("");
  return `<table class="clickableTable"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted">ไม่มีข้อมูล</td></tr>`}</tbody></table>`;
}

function renderCalibration(container){
  setPageHeader("แผนสอบเทียบ", "สรุปกำหนดสอบเทียบ • กรองตามปี/เดือน • เตือนล่วงหน้า 1 เดือน (Admin สามารถนำเข้า/ส่งออก Excel)");

  const isAdmin = state.user?.role === "admin";

  const wrap = el("div", "card");
  wrap.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">ปฏิทินและสรุปการสอบเทียบ</div>
        <div class="cardSub">ระบบจะแสดง “ใกล้ถึงกำหนด” เมื่อเหลือ ≤ 30 วัน และ “เกินกำหนด” เมื่อเลยวันครบกำหนด</div>
      </div>
      <div class="row gap8" style="flex-wrap:wrap;">
        <span class="pill">ปี: <b id="calYearPill">-</b></span>
        <span class="pill">เดือน: <b id="calMonthPill">-</b></span>
      </div>
    </div>

    <div class="grid2" style="align-items:end;">
      <div class="field">
        <label>เลือกปี (ค.ศ.)</label>
        <select id="calYearSel" style="height:46px;"></select>
      </div>
      <div class="field">
        <label>เลือกเดือน</label>
        <select id="calMonthSel" style="height:46px;"></select>
      </div>
    </div>

    <div class="row gap8" style="margin-top:10px; flex-wrap:wrap;">
      <input id="calSearch" class="pill" style="border-radius:16px; border:1px solid var(--border); padding:10px 12px; min-width:260px;"
             placeholder="ค้นหา: รหัส / ชื่อ / S/N / สถานที่" />
      ${isAdmin ? `
	      <button id="btnCalAdd" class="btn btnPrimary">+ เพิ่มรายการ</button>
        <button id="btnCalImport" class="btn btnGhost">นำเข้าแผนสอบเทียบ (Excel)</button>
        <button id="btnCalExport" class="btn btnGhost">Export แผนสอบเทียบ (Excel)</button>
        <input id="calExcelFile" type="file" accept=".xlsx,.xls" style="display:none" />
      ` : ``}
	    <button id="btnCalRefresh" class="btn btnGhost">รีเฟรช</button>
    </div>

    <div id="calMsg" class="alert success hidden" style="margin-top:12px;"></div>
    <div id="calErr" class="alert error hidden" style="margin-top:12px;"></div>
  `;
  container.appendChild(wrap);

  // Loading / load error status (ไม่ให้เงียบ)
  const calMsgEl = document.getElementById("calMsg");
  const calErrEl = document.getElementById("calErr");
  if (state.calibrationLoading){
    if(calMsgEl){
      calMsgEl.textContent = "กำลังโหลดข้อมูลแผนสอบเทียบ...";
      calMsgEl.classList.remove("hidden");
    }
  } else {
    calMsgEl?.classList.add("hidden");
  }
  if (state.calibrationLoadError){
    if(calErrEl){
      calErrEl.textContent = state.calibrationLoadError;
      calErrEl.classList.remove("hidden");
    }
  }

  // Load data (async) then re-render ONCE (กัน loop กรณีข้อมูลว่าง)
  if (!state.calibrationLoaded && !state.calibrationLoading){
    ensureCalibrationLoaded().then(()=> {
      if(state.route === "calibration") render();
    });
  }

  const itemsAll = (state.calibration || []);
  const year = Number(state.calYear || new Date().getFullYear());
  const month = Number(state.calMonth || (new Date().getMonth()+1));

  // Build year/month selects
  const ySel = document.getElementById("calYearSel");
  const mSel = document.getElementById("calMonthSel");
  if (ySel && mSel){
    const nowY = new Date().getFullYear();
    const years = [];
    for(let y = nowY-2; y <= nowY+3; y++) years.push(y);
    ySel.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
    ySel.value = String(year);

    const monthNames = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    mSel.innerHTML = monthNames.map((n,i)=>`<option value="${i+1}">${n}</option>`).join("");
    mSel.value = String(month);
    document.getElementById("calYearPill").textContent = year;
    document.getElementById("calMonthPill").textContent = monthNames[month-1] || month;

    ySel.addEventListener("change", ()=>{ state.calYear = Number(ySel.value)||nowY; state.calPage=1; render(); });
    mSel.addEventListener("change", ()=>{ state.calMonth = Number(mSel.value)||1; state.calPage=1; render(); });
  }

  const qBox = document.getElementById("calSearch");
  if (qBox){
    qBox.value = state.calSearch || "";
    qBox.addEventListener("input", debounce((e)=>{
      state.calSearch = (e.target.value||"").trim();
      state.calPage = 1;
      render();
    }, 350));
  }

  document.getElementById("btnCalRefresh")?.addEventListener("click", async ()=>{
    document.getElementById("calErr")?.classList.add("hidden");
    try{
      // force reload by clearing and calling API
      state.calibration = [];
      state.calibrationLoaded = false;
      state.calibrationLoading = false;
      state.calibrationLoadError = "";
      await ensureCalibrationLoaded();
      render();
    }catch(e){
      const er = document.getElementById("calErr");
      if(er){
        er.textContent = e.message || "โหลดข้อมูลสอบเทียบไม่สำเร็จ";
        er.classList.remove("hidden");
      }
    }
  });

  // Add new item
  if (isAdmin){
    document.getElementById("btnCalAdd")?.addEventListener("click", ()=>{
      state.calSelectedId = "__NEW__";
      render();
      setTimeout(()=>{
        document.getElementById("calDetail")?.scrollIntoView({ behavior:"smooth", block:"start" });
      }, 0);
    });
  }

  if (isAdmin){
    document.getElementById("btnCalImport")?.addEventListener("click", ()=> document.getElementById("calExcelFile")?.click());
    document.getElementById("calExcelFile")?.addEventListener("change", async (e)=>{
      const file = e.target.files?.[0];
      e.target.value = "";
      if(!file) return;

      const merge = confirm(
        "ต้องการ 'ผสาน/อัปเดตตามรหัสเครื่องมือ' หรือ 'แทนที่ทั้งหมด' ?\n\n" +
        "กด OK = แทนที่ทั้งหมด\n" +
        "กด Cancel = ผสาน/อัปเดตตามรหัสเครื่องมือ"
      );
      const mode = merge ? "replace" : "merge";

      try{
        const r = await API.importCalibrationExcel(file, mode);
        state.calibration = [];
        state.calibrationLoaded = false;
        state.calibrationLoading = false;
        state.calibrationLoadError = "";
        await ensureCalibrationLoaded();
        const ok = document.getElementById("calMsg");
        if(ok){
          ok.textContent = `นำเข้าแผนสอบเทียบสำเร็จ • นำเข้า ${r.imported} • เพิ่ม ${r.created} • อัปเดต ${r.updated} • ข้าม ${r.skipped}`;
          ok.classList.remove("hidden");
          setTimeout(()=> ok.classList.add("hidden"), 3200);
        }
        render();
      }catch(err){
        const er = document.getElementById("calErr");
        if(er){
          er.textContent = err?.message || "นำเข้าแผนสอบเทียบไม่สำเร็จ";
          er.classList.remove("hidden");
        }else{
          alert(err?.message || "นำเข้าแผนสอบเทียบไม่สำเร็จ");
        }
      }
    });

    document.getElementById("btnCalExport")?.addEventListener("click", async ()=>{
      try{
        const { blob, filename } = await API.exportCalibrationExcel();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "UPH_MEM_calibration.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
      }catch(err){
        alert(err?.message || "Export แผนสอบเทียบไม่สำเร็จ");
      }
    });
  }

  // Filter + compute summary
  const query = (state.calSearch||"").toLowerCase();
  const filtered = itemsAll.filter(a=>{
    if(!query) return true;
    const code = (a["รหัสเครื่องมือห้องปฏิบัติการ"]||"").toString().toLowerCase();
    const name = (a["ชื่อ"]||"").toString().toLowerCase();
    const sn = (a["หมายเลขเครื่อง"]||"").toString().toLowerCase();
    const loc = (a["สถานที่ใช้งาน (ปัจจุบัน)"]||"").toString().toLowerCase();
    return code.includes(query) || name.includes(query) || sn.includes(query) || loc.includes(query);
  });

  const now = new Date();
  const yearMonthItems = filtered.filter(a=>{
    // หากมี dueDate ให้ใช้ dueDate, ถ้าไม่มีก็ลองใช้ตารางเดือน 1-12 (ค่า 1 / ✓ / x)
    const due = parseYMD(a["วันครบกำหนดสอบเทียบ"]);
    if (due) return due.getFullYear() === year && (due.getMonth()+1) === month;

    // schedule months
    const val = (a[String(month)] ?? a[`เดือน${month}`] ?? "").toString().trim();
    return ["1","x","X","✓","y","Y","true","TRUE"].includes(val);
  });

  const overdue = filtered.filter(a=>{
    const due = parseYMD(a["วันครบกำหนดสอบเทียบ"]);
    return due && due.getTime() < now.getTime();
  });
  const dueSoon = filtered.filter(a=>{
    const due = parseYMD(a["วันครบกำหนดสอบเทียบ"]);
    if(!due) return false;
    const diff = daysDiff(due, now);
    return diff >= 0 && diff <= 30;
  });
  const noDue = filtered.filter(a=>{
    const due = parseYMD(a["วันครบกำหนดสอบเทียบ"]);
    const hasSchedule = Array.from({length:12}, (_,i)=> String(a[String(i+1)]||"").trim()).some(v=>v);
    return !due && !hasSchedule;
  });

  const kpiRow = el("div", "kpiRow");
  kpiRow.appendChild(kpi("รายการสอบเทียบทั้งหมด", filtered.length, "รวม"));
  kpiRow.appendChild(kpi("เกินกำหนด", overdue.length, "ต้องเร่งดำเนินการ"));
  kpiRow.appendChild(kpi("ใกล้ถึงกำหนด (≤ 30 วัน)", dueSoon.length, "เตือนล่วงหน้า 1 เดือน"));
  kpiRow.appendChild(kpi("กำหนดในเดือนที่เลือก", yearMonthItems.length, "ตามปี/เดือน"));
  kpiRow.appendChild(kpi("ไม่พบวัน/แผนสอบเทียบ", noDue.length, "ควรตรวจสอบข้อมูล"));
  container.appendChild(kpiRow);

  // Alerts
  // ถ้าโหลดไม่สำเร็จ ให้แสดงข้อความ (ไม่ทำ render loop)
  if (state.calibrationLoadError){
    const er = document.getElementById("calErr");
    if(er){
      er.textContent = `⚠️ ${state.calibrationLoadError}`;
      er.classList.remove("hidden");
    }
  }
  if (dueSoon.length){
    const msg = document.getElementById("calMsg");
    if(msg){
      msg.textContent = `📌 มีรายการใกล้ถึงกำหนดสอบเทียบ ${dueSoon.length} รายการ (ภายใน 30 วัน)`;
      msg.classList.remove("hidden");
    }
  }
  if (overdue.length){
    const er = document.getElementById("calErr");
    if(er){
      er.textContent = `⚠️ มีรายการเกินกำหนดสอบเทียบ ${overdue.length} รายการ`;
      er.classList.remove("hidden");
    }
  }

  // Chart (full width)
  const chartCard = el("div","card");
  chartCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">กราฟสรุปแผนสอบเทียบรายเดือน</div>
        <div class="cardSub">จำนวนรายการตาม “วันครบกำหนดสอบเทียบ” (ปีที่เลือก) — ใช้ประกอบการติดตาม/เตือน</div>
      </div>
    </div>
    <canvas id="calChart" height="230"></canvas>
  `;
  container.appendChild(chartCard);

  // Table (full width - ตามที่ต้องการ "ตารางอยู่ด้านล่าง")
  const tableCard = el("div","card");
  tableCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">รายการสอบเทียบทั้งหมด</div>
        <div class="cardSub">คลิกแถวเพื่อแก้ไข/ดูรายละเอียด • เพิ่มรายการได้เหมือนตารางครุภัณฑ์</div>
      </div>
      <div class="row gap8" style="flex-wrap:wrap;">
        <span class="pill">${escapeHtml(String(filtered.length))} รายการ</span>
        ${isAdmin ? `<button id="btnCalAdd2" class="btn btnPrimary">+ เพิ่มรายการ</button>` : ``}
      </div>
    </div>
    <div class="tableWrap" id="calTableWrap"></div>
    <div id="calPager" class="pager"></div>
  `;
  container.appendChild(tableCard);

  const detailCard = el("div","card");
  detailCard.innerHTML = `
    <div class="cardHeader">
      <div>
        <div class="cardTitle">รายละเอียดการสอบเทียบ</div>
        <div class="cardSub">แสดงข้อมูลจากแผนสอบเทียบ/วันครบกำหนด</div>
      </div>
    </div>
    <div id="calDetailEmpty" class="muted">เลือกแถวจากตารางเพื่อดูรายละเอียด</div>
    <div id="calDetail"></div>
  `;
  container.appendChild(detailCard);

  // secondary add button (in table header)
  document.getElementById("btnCalAdd2")?.addEventListener("click", ()=>{
    state.calSelectedId = "__NEW__";
    renderCalDetail();
    document.getElementById("calDetail")?.scrollIntoView({ behavior:"smooth", block:"start" });
  });

  // Table (paged)
  const pageInfo = getCalPageInfo(filtered);
  const tableWrap = document.getElementById("calTableWrap");
  if (tableWrap) tableWrap.innerHTML = calibrationTable(pageInfo.slice);

  renderCalPager("calPager", filtered);

  // Row click -> detail
  tableWrap?.querySelectorAll("tr[data-id]")?.forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const id = tr.getAttribute("data-id");
      state.calSelectedId = id;
      renderCalDetail();
    });
  });

  // Chart
  renderCalChart(filtered, year);

  // Auto render detail if selected
  renderCalDetail();

  function renderCalDetail(){
    const target = document.getElementById("calDetail");
    const empty = document.getElementById("calDetailEmpty");
    if(!target || !empty) return;

    // allow add new even if not in list
    const isNew = state.calSelectedId === "__NEW__";
    const found = isNew ? null : (state.calibration||[]).find(x=>x.id === state.calSelectedId);

    if(!found && !isNew){
      empty.classList.remove("hidden");
      target.innerHTML = "";
      return;
    }
    empty.classList.add("hidden");

    const item = found ? { ...found } : {
      "รหัสเครื่องมือห้องปฏิบัติการ":"",
      "ชื่อ":"",
      "รุ่น":"",
      "หมายเลขเครื่อง":"",
      "สถานที่ใช้งาน (ปัจจุบัน)":"",
      "วันที่สอบเทียบล่าสุด":"",
      "วันครบกำหนดสอบเทียบ":"",
      "สอบเทียบ":"",
      "ทวนสอบ":"",
      "Asset ID":"",
      "ผู้ผลิต":"",
      "หมายเหตุ":""
    };

    const [cls, txt] = badgeCal(item);

    // non-admin -> read-only view
    if (!isAdmin){
      const due = parseYMD(item["วันครบกำหนดสอบเทียบ"]);
      const last = parseYMD(item["วันที่สอบเทียบล่าสุด"]);
      target.innerHTML = `
        <div class="kv">
          ${kvRow("รหัสเครื่องมือ", item["รหัสเครื่องมือห้องปฏิบัติการ"])}
          ${kvRow("ชื่อ", item["ชื่อ"])}
          ${kvRow("รุ่น", item["รุ่น"])}
          ${kvRow("หมายเลขเครื่อง (S/N)", item["หมายเลขเครื่อง"])}
          ${kvRow("สถานที่ใช้งาน", item["สถานที่ใช้งาน (ปัจจุบัน)"])}
          ${kvRow("วันที่สอบเทียบล่าสุด", last ? fmtDate(last) : (item["วันที่สอบเทียบล่าสุด"]||"-"))}
          ${kvRow("วันครบกำหนดสอบเทียบ", due ? fmtDate(due) : (item["วันครบกำหนดสอบเทียบ"]||"-"))}
          ${kvRow("สถานะสอบเทียบ", `<span class="badge ${cls}">${escapeHtml(txt)}</span>`, true)}
          ${kvRow("หมายเหตุ", item["หมายเหตุ"]||"-")}
        </div>
      `;
      return;
    }

    // Admin -> editable form
    const monthNames = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    const monthBtns = monthNames.map((n,i)=>{
      const m = i+1;
      const on = ["1","x","X","✓","y","Y","true","TRUE"].includes(String(item[String(m)]||"").trim());
      return `<button type="button" class="pill calMonthBtn ${on?"on":""}" data-m="${m}">${n} ${on?"✓":"—"}</button>`;
    }).join(" ");

    target.innerHTML = `
      <div class="row gap8" style="flex-wrap:wrap; margin-bottom:10px;">
        <span class="pill">สถานะ: <b><span class="badge ${cls}">${escapeHtml(txt)}</span></b></span>
        ${found ? `<span class="pill">ID: <b>${escapeHtml(found.id)}</b></span>` : `<span class="pill">กำลังเพิ่มรายการใหม่</span>`}
      </div>

      <div class="grid2">
        ${inputField("รหัสเครื่องมือห้องปฏิบัติการ", "cal_code", item["รหัสเครื่องมือห้องปฏิบัติการ"]||"", false)}
        ${inputField("ชื่อ", "cal_name", item["ชื่อ"]||"", false)}
      </div>
      <div class="grid2">
        ${inputField("รุ่น", "cal_model", item["รุ่น"]||"", false)}
        ${inputField("หมายเลขเครื่อง (S/N)", "cal_sn", item["หมายเลขเครื่อง"]||"", false)}
      </div>
      <div class="grid2">
        ${inputField("สถานที่ใช้งาน (ปัจจุบัน)", "cal_loc", item["สถานที่ใช้งาน (ปัจจุบัน)"]||"", false)}
        ${inputField("Asset ID", "cal_assetid", item["Asset ID"]||"", false)}
      </div>
      <div class="grid2">
        ${inputField("ผู้ผลิต", "cal_manu", item["ผู้ผลิต"]||"", false)}
        ${inputField("หน่วยงาน/บริษัทสอบเทียบ", "cal_vendor", item["หน่วยงาน/บริษัทสอบเทียบ"]||item["หน่วยงาน"]||"", false)}
      </div>

      <div class="grid2">
        ${inputField("วันที่สอบเทียบล่าสุด", "cal_last", item["วันที่สอบเทียบล่าสุด"]||"", false, "date")}
        ${inputField("วันครบกำหนดสอบเทียบ", "cal_due", item["วันครบกำหนดสอบเทียบ"]||"", false, "date")}
      </div>
      <div class="grid2">
        ${inputField("รอบสอบเทียบ", "cal_interval", item["สอบเทียบ"]||"", false)}
        ${inputField("รอบทวนสอบ", "cal_verify", item["ทวนสอบ"]||"", false)}
      </div>

      <div class="field">
        <label>หมายเหตุ</label>
        <textarea id="cal_note" rows="3" style="width:100%; border:1px solid var(--border); border-radius:16px; padding:10px 12px;">${escapeHtml(item["หมายเหตุ"]||"")}</textarea>
      </div>

      <div class="field">
        <label>แผนเดือน 1-12 (กดเพื่อสลับ ✓/—)</label>
        <div class="row gap8" style="flex-wrap:wrap;" id="calMonthWrap">${monthBtns}</div>
      </div>

      <div class="row gap8" style="justify-content:flex-end; flex-wrap:wrap; margin-top:10px;">
        ${found ? `<button id="btnCalDelete" class="btn btnDanger">ลบรายการ</button>` : ``}
        <button id="btnCalSave" class="btn btnPrimary">บันทึก</button>
      </div>
    `;

    // month toggles
    const wrapM = document.getElementById("calMonthWrap");
    wrapM?.querySelectorAll(".calMonthBtn")?.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const m = Number(btn.getAttribute("data-m"))||1;
        const cur = String(item[String(m)]||"").trim();
        const on = !["1","x","X","✓","y","Y","true","TRUE"].includes(cur);
        item[String(m)] = on ? "1" : "";
        // update visual
        btn.classList.toggle("on", on);
        btn.innerHTML = `${monthNames[m-1]} ${on?"✓":"—"}`;
      });
    });

    document.getElementById("btnCalSave")?.addEventListener("click", async ()=>{
      const payload = {
        ...item,
        "รหัสเครื่องมือห้องปฏิบัติการ": (document.getElementById("cal_code")?.value||"").trim(),
        "ชื่อ": (document.getElementById("cal_name")?.value||"").trim(),
        "รุ่น": (document.getElementById("cal_model")?.value||"").trim(),
        "หมายเลขเครื่อง": (document.getElementById("cal_sn")?.value||"").trim(),
        "สถานที่ใช้งาน (ปัจจุบัน)": (document.getElementById("cal_loc")?.value||"").trim(),
        "Asset ID": (document.getElementById("cal_assetid")?.value||"").trim(),
        "ผู้ผลิต": (document.getElementById("cal_manu")?.value||"").trim(),
        "หน่วยงาน/บริษัทสอบเทียบ": (document.getElementById("cal_vendor")?.value||"").trim(),
        "วันที่สอบเทียบล่าสุด": (document.getElementById("cal_last")?.value||"").trim(),
        "วันครบกำหนดสอบเทียบ": (document.getElementById("cal_due")?.value||"").trim(),
        "สอบเทียบ": (document.getElementById("cal_interval")?.value||"").trim(),
        "ทวนสอบ": (document.getElementById("cal_verify")?.value||"").trim(),
        "หมายเหตุ": (document.getElementById("cal_note")?.value||"").trim(),
      };
      if(!payload["รหัสเครื่องมือห้องปฏิบัติการ"] && !payload["ชื่อ"] && !payload["หมายเลขเครื่อง"]){
        alert("กรุณากรอก รหัส/ชื่อ/SN อย่างน้อย 1 ช่อง");
        return;
      }
      try{
        let saved;
        if(found){
          const r = await API.updateCalibration(found.id, payload);
          saved = r.item;
        } else {
          const r = await API.createCalibration(payload);
          saved = r.item;
        }

        state.calibration = [];
        state.calibrationLoaded = false;
        state.calibrationLoading = false;
        state.calibrationLoadError = "";
        await ensureCalibrationLoaded();
        state.calSelectedId = saved.id;

        const ok = document.getElementById("calMsg");
        if(ok){
          ok.textContent = "บันทึกรายการสอบเทียบสำเร็จ";
          ok.classList.remove("hidden");
          setTimeout(()=> ok.classList.add("hidden"), 2500);
        }
        render();
      }catch(err){
        alert(err?.message || "บันทึกไม่สำเร็จ");
      }
    });

    document.getElementById("btnCalDelete")?.addEventListener("click", async ()=>{
      if(!found) return;
      if(!confirm("ยืนยันลบรายการนี้?") ) return;
      try{
        await API.deleteCalibration(found.id);
        state.calibration = [];
        state.calibrationLoaded = false;
        state.calibrationLoading = false;
        state.calibrationLoadError = "";
        await ensureCalibrationLoaded();
        state.calSelectedId = null;
        render();
      }catch(err){
        alert(err?.message || "ลบไม่สำเร็จ");
      }
    });
  }

  function kvRow(k,v,isHtml=false){
    return `
      <div class="kvItem">
        <div class="kvKey">${escapeHtml(k)}</div>
        <div class="kvVal">${isHtml ? v : escapeHtml(String(v ?? "-"))}</div>
      </div>
    `;
  }
}

function renderCalChart(items, year){
  const canvas = document.getElementById("calChart");
  if(!canvas) return;

  // destroy old chart
  if (state.calChart){
    try { state.calChart.destroy(); } catch {}
    state.calChart = null;
  }

  const monthCounts = Array.from({length:12}, ()=>0);

  for(const a of items){
    const due = parseYMD(a["วันครบกำหนดสอบเทียบ"]);
    if (due && due.getFullYear() === year){
      monthCounts[due.getMonth()] += 1;
    }
  }

  const labels = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

  state.calChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "จำนวนรายการ", data: monthCounts }
      ]
    },
    options: {
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{
        y:{ beginAtZero:true, ticks:{ precision:0 } }
      }
    }
  });
}

// NOTE: ผู้ใช้ต้องการนำหน้า "นำเข้า/ส่งออกข้อมูล" ออก จึงตัดหน้า DataIO ออกจาก UI

/* -------- Components -------- */
function kpi(label, value, pill){
  const d = el("div","kpi");
  d.innerHTML = `
    <div class="kpiLabel">${escapeHtml(label)}</div>
    <div class="kpiValue">${escapeHtml(String(value))}</div>
    <div class="kpiPill">${escapeHtml(String(pill||""))}</div>
  `;
  return d;
}

function groupCounts(items, key){
  const map = new Map();
  for(const it of items){
    const v = (it[key] ?? "ไม่ระบุ").toString().trim() || "ไม่ระบุ";
    map.set(v, (map.get(v) || 0) + 1);
  }
  return Array.from(map.entries()).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count);
}

function miniTable(rows, cols, headers){
  const th = cols.map(c=>`<th>${escapeHtml(headers[c] || c)}</th>`).join("");
  const tr = rows.map(r=>`<tr>${cols.map(c=>`<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}</tr>`).join("");
  return `<div class="tableWrap"><table><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${cols.length}" class="muted">ไม่มีข้อมูล</td></tr>`}</tbody></table></div>`;
}

function assetsTable(items, opts={}){
  const compact = !!opts.compact;
  const cols = [
    "รหัสเครื่องมือห้องปฏิบัติการ",
    "ชื่อ",
    "รุ่น",
    "หมายเลขเครื่อง",
    "สถานะ",
    "สถานะแจ้งซ่อม",
    "สถานที่ใช้งาน (ปัจจุบัน)"
  ];
  const head = cols.map(c=>`<th>${escapeHtml(c)}</th>`).join("");
  const body = items.map(a=>{
    const [clsS, txtS] = badgeStatus(a["สถานะ"]);
    const [clsM, txtM] = badgeMaint(a["สถานะแจ้งซ่อม"]);
    return `<tr data-id="${escapeHtml(a.id)}">
      <td class="nowrap">${escapeHtml(a["รหัสเครื่องมือห้องปฏิบัติการ"]||"")}</td>
      <td>${escapeHtml(a["ชื่อ"]||"")}</td>
      <td>${escapeHtml(a["รุ่น"]||"")}</td>
      <td class="nowrap">${escapeHtml(a["หมายเลขเครื่อง"]||"")}</td>
      <td><span class="badge ${clsS}">${escapeHtml(txtS)}</span></td>
      <td><span class="badge ${clsM}">${escapeHtml(txtM)}</span></td>
      ${compact ? "" : `<td>${escapeHtml(a["สถานที่ใช้งาน (ปัจจุบัน)"]||"")}</td>`}
    </tr>`;
  }).join("");
  const fullCols = compact ? cols.length-1 : cols.length;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${fullCols}" class="muted">ไม่มีข้อมูล</td></tr>`}</tbody></table>`;
}



// -------- Pagination (Assets) --------
function getAssetsPageInfo(){
  const size = Number(state.assetsPageSize || 10);
  const total = (state.assets || []).length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = Number(state.assetsPage || 1);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > pages) page = pages;
  state.assetsPage = page;

  const startIdx = (page - 1) * size;
  const endIdx = Math.min(startIdx + size, total);
  const slice = (state.assets || []).slice(startIdx, endIdx);

  const from = total === 0 ? 0 : startIdx + 1;
  const to = total === 0 ? 0 : endIdx;

  return { page, pages, size, total, from, to, startIdx, endIdx, slice };
}

function scrollToAssetsTable(){
  const el = document.getElementById("assetTableWrap");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => window.scrollBy({ top: -80, left: 0, behavior: "smooth" }), 150);
}

function renderAssetsPager(){
  const pager = document.getElementById("assetPager");
  if (!pager) return;

  const info = getAssetsPageInfo();
  const disabledPrev = info.page <= 1 ? "disabled" : "";
  const disabledNext = info.page >= info.pages ? "disabled" : "";

  pager.innerHTML = `
    <div class="pagerLeft">
      <span class="pagerInfo">แสดง <b>${info.from}</b>-<b>${info.to}</b> จาก <b>${info.total}</b> รายการ</span>
    </div>
    <div class="pagerRight">
      <button type="button" id="pagerPrev" class="btn btnGhost btnSm" ${disabledPrev}>ก่อนหน้า</button>
      <span class="pagerInfo">หน้า <b>${info.page}</b> / <b>${info.pages}</b></span>
      <button type="button" id="pagerNext" class="btn btnGhost btnSm" ${disabledNext}>ถัดไป</button>
    </div>
  `;

  const prev = document.getElementById("pagerPrev");
  const next = document.getElementById("pagerNext");

  if (prev) prev.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.assetsPage <= 1) return;

    const y = window.scrollY; // ✅ lock current scroll position
    state.assetsPage -= 1;
    renderAssetsTable();

    // restore scroll (prevent jump)
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: "auto" });
    });
  });

  if (next) next.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const { pages } = getAssetsPageInfo();
    if (state.assetsPage >= pages) return;

    const y = window.scrollY; // ✅ lock current scroll position
    state.assetsPage += 1;
    renderAssetsTable();

    // restore scroll (prevent jump)
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: "auto" });
    });
  });
}

function renderAssetsTable(){
  const wrap = $("#assetTableWrap");
  const info = getAssetsPageInfo();

  wrap.innerHTML = assetsTable(info.slice);
  renderAssetsPager();

  wrap.querySelectorAll("tbody tr[data-id]").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const id = tr.getAttribute("data-id");
      state.selectedId = id;
      const asset = state.assets.find(a=>a.id === id);
      openAssetEditor(asset, { inPlace:true });
      setTimeout(scrollToAssetDetail, 60);
    });
  });
}


function openAssetEditor(asset, opts={}){
  const isAdmin = state.user?.role === "admin";
  const detail = $("#assetDetail");
  const empty = $("#assetDetailEmpty");
  detail.innerHTML = "";
  empty.classList.add("hidden");

  if(!asset){
    if(!isAdmin){
      empty.textContent = "ต้องเป็น Admin เพื่อเพิ่มรายการใหม่";
      empty.classList.remove("hidden");
      return;
    }
    // new asset template (2 ประเภท)
    const kind = (opts.newKind === "GN") ? "GN" : "EQ";
    const autoCode = (opts.prefillCode && String(opts.prefillCode).trim()) ? String(opts.prefillCode).trim() : getNextAssetCode(kind);
    const typeLabel = (kind === "GN") ? "ครุภัณฑ์ภายในโรงพยาบาล" : "เครื่องมือทางการแพทย์";

    asset = {
      id: null,
      "รหัสเครื่องมือห้องปฏิบัติการ": autoCode,
      "ชื่อ": "",
      "รุ่น": "",
      "หมายเลขเครื่อง": "",
      "AssetID": "",
      "สถานะ": "พร้อมใช้งาน",
      "สถานะแจ้งซ่อม": state.maintChoices[0] || "ยังไม่เคยแจ้งซ่อม",
      "ต้นทุนต่อหน่วย": "",
      "ประเภทครุภัณฑ์": typeLabel,
      "หมวดครุภัณฑ์": "",
      "สถานที่ใช้งาน (ปัจจุบัน)": "",
      "รูปภาพครุภัณฑ์": ""
    };
  }

  const code = asset["รหัสเครื่องมือห้องปฏิบัติการ"] || "-";
  const name = asset["ชื่อ"] || "-";
  const img = asset["รูปภาพครุภัณฑ์"] || "";
  const qrUrl = asset.id ? `/api/assets/${encodeURIComponent(asset.id)}/qr` : "";

  const form = el("div");
  form.innerHTML = `
    <div class="grid2">
      <div>
        <div class="card" style="margin:0;">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">${asset.id ? "ฟอร์มแก้ไข" : "เพิ่มรายการใหม่"}</div>
              <div class="cardSub">รหัส: <b>${escapeHtml(code)}</b> • ชื่อ: <b>${escapeHtml(name)}</b></div>
            </div>
            <div class="row gap8">
              ${asset.id ? `<a class="btn btnGhost" href="/qr.html?code=${encodeURIComponent(code)}" target="_blank">เปิดหน้า QR</a>` : ``}
            </div>
          </div>

          <div class="grid2">
            ${inputField("รหัสเครื่องมือห้องปฏิบัติการ", "f_code", asset["รหัสเครื่องมือห้องปฏิบัติการ"]||"", !isAdmin || !!asset.id)}
            ${inputField("ชื่อ", "f_name", asset["ชื่อ"]||"", !isAdmin)}
          </div>

          <div class="grid2">
            ${inputField("รุ่น", "f_model", asset["รุ่น"]||"", !isAdmin)}
            ${inputField("หมายเลขเครื่อง", "f_sn", asset["หมายเลขเครื่อง"]||"", !isAdmin)}
          </div>

          <div class="grid2">
            ${inputField("AssetID", "f_assetid", asset["AssetID"]||"", !isAdmin)}
            ${selectField("สถานะ", "f_status", ["พร้อมใช้งาน","ตรวจไม่พบ","ชำรุด(ซ่อมแซมได้)","ชำรุด(ซ่อมแซมไม่ได้)","ไม่ทราบสถานะ"], asset["สถานะ"]||"พร้อมใช้งาน", !isAdmin)}
          </div>

          <div class="grid2">
            ${selectField("สถานะแจ้งซ่อม", "f_maint", state.maintChoices, asset["สถานะแจ้งซ่อม"]||state.maintChoices[0]||"", !isAdmin)}
            ${inputField("ต้นทุนต่อหน่วย", "f_cost", asset["ต้นทุนต่อหน่วย"]??"", !isAdmin, "number")}
          </div>

          <div class="grid2">
            ${inputField("ประเภทครุภัณฑ์", "f_type", asset["ประเภทครุภัณฑ์"]||"", !isAdmin)}
            ${inputField("หมวดครุภัณฑ์", "f_cat", asset["หมวดครุภัณฑ์"]||"", !isAdmin)}
          </div>

          <div class="grid2">
            ${inputField("สถานที่ใช้งาน (ปัจจุบัน)", "f_loc", asset["สถานที่ใช้งาน (ปัจจุบัน)"]||"", !isAdmin)}
            ${inputField("หมายเหตุการซ่อม", "f_note", asset["หมายเหตุการซ่อม"]||"", !isAdmin)}
          </div>

          <div class="row gap8" style="justify-content:flex-end; margin-top:12px;">
            ${asset.id && isAdmin ? `<button id="btnDeleteAsset" class="btn btnGhost">🗑️ ลบ</button>` : ``}
            ${isAdmin ? `<button id="btnSaveAsset" class="btn btnPrimary">บันทึก</button>` : `<span class="muted tiny">โหมดผู้ใช้: ดูข้อมูลเท่านั้น</span>`}
          </div>

          <div id="assetMsgOk" class="alert success hidden" style="margin-top:12px;"></div>
          <div id="assetMsgErr" class="alert error hidden" style="margin-top:12px;"></div>
        </div>
      </div>

      <div>
        <div class="card" style="margin:0;">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">รูปภาพครุภัณฑ์</div>
              <div class="cardSub">อัปโหลดรูปเพื่อให้สแกน QR แล้วเห็นรูปเดียวกัน</div>
            </div>
          </div>
          <div class="imgBox" id="imgPreviewBox">
            ${img ? `<img src="${escapeAttr(img)}" alt="asset image" />` : `<div class="muted">ยังไม่มีรูปภาพ</div>`}
          </div>
          <div class="row gap8" style="margin-top:10px;">
            <input id="imgFile" type="file" accept="image/*" ${isAdmin && asset.id ? "" : "disabled"} />
            <button id="btnUploadImg" class="btn btnGhost" ${isAdmin && asset.id ? "" : "disabled"}>อัปโหลด</button>
          </div>
          <div class="muted tiny" style="margin-top:8px;">* ต้องเป็น Admin และต้องบันทึกรายการก่อนถึงจะอัปโหลดรูปได้</div>
        </div>

        <div class="card" style="margin-top:12px;">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">QR Code</div>
              <div class="cardSub">ดาวน์โหลด PNG เพื่อนำไปพิมพ์ติดที่อุปกรณ์</div>
            </div>
          </div>
          <div class="imgBox" id="qrBox">
            ${asset.id ? `<img src="${escapeAttr(qrUrl)}" alt="qr" />` : `<div class="muted">บันทึกรายการก่อนเพื่อสร้าง QR</div>`}
          </div>
          <div class="row gap8" style="margin-top:10px; justify-content:flex-end;">
            ${asset.id ? `<a class="btn btnGhost" href="${escapeAttr(qrUrl)}" download="${escapeAttr(code)}_qr.png">ดาวน์โหลด QR</a>` : ``}
          </div>
        </div>
      </div>
    </div>
  `;
  detail.appendChild(form);

  // actions
  if (isAdmin){
    $("#btnSaveAsset")?.addEventListener("click", async ()=>{
      await saveAsset(asset);
    });
    $("#btnDeleteAsset")?.addEventListener("click", async ()=>{
      if (!confirm("ยืนยันการลบรายการนี้?")) return;
      try{
        await API.deleteAsset(asset.id);
        await loadAssets($("#assetSearch")?.value?.trim()||"");
        state.selectedId = null;
        toast("#assetMsgOk","ลบรายการเรียบร้อยแล้ว");
        render();
      }catch(e){
        toast("#assetMsgErr", e.message || "ลบไม่สำเร็จ", true);
      }
    });
    $("#btnUploadImg")?.addEventListener("click", async ()=>{
      const file = $("#imgFile").files?.[0];
      if (!asset.id) return toast("#assetMsgErr","ต้องบันทึกรายการก่อน", true);
      if (!file) return toast("#assetMsgErr","กรุณาเลือกไฟล์รูป", true);
      try{
        const r = await API.uploadImage(asset.id, file);
        toast("#assetMsgOk","อัปโหลดรูปสำเร็จ");
        // update local state
        const target = state.assets.find(a=>a.id===asset.id);
        if (target) target["รูปภาพครุภัณฑ์"] = r.imagePath;
        // refresh preview
        $("#imgPreviewBox").innerHTML = `<img src="${escapeAttr(r.imagePath)}" alt="asset image" />`;
      }catch(e){
        toast("#assetMsgErr", e.message || "อัปโหลดไม่สำเร็จ", true);
      }
    });
  }

  // ถ้ามาจากปุ่ม "เพิ่มรายการ" ให้เด้ง/เลื่อนไปฟอร์มรายละเอียดทันที
  if (opts.scrollToDetail){
    setTimeout(scrollToAssetDetail, 60);
  }
  if (opts.focusId){
    setTimeout(()=>{ document.getElementById(opts.focusId)?.focus(); }, 90);
  }
}

function inputField(label, id, value, disabled=false, type="text"){
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <input id="${escapeAttr(id)}" type="${escapeAttr(type)}" value="${escapeAttr(String(value ?? ""))}" ${disabled?"disabled":""}/>
    </div>`;
}
function selectField(label, id, options, value, disabled=false){
  const opts = (options||[]).map(o=>{
    const sel = (o===value) ? "selected" : "";
    return `<option ${sel} value="${escapeAttr(o)}">${escapeHtml(o)}</option>`;
  }).join("");
  return `
    <div class="field">
      <label>${escapeHtml(label)}</label>
      <select id="${escapeAttr(id)}" ${disabled?"disabled":""}>${opts}</select>
    </div>`;
}

async function saveAsset(asset){
  const isNew = !asset.id;
  const body = collectAssetForm(asset);
  try{
    if (isNew){
      const r = await API.createAsset(body);
      toast("#assetMsgOk","เพิ่มรายการใหม่เรียบร้อยแล้ว");
      state.selectedId = r.asset.id;
    }else{
      await API.updateAsset(asset.id, body);
      toast("#assetMsgOk","บันทึกการแก้ไขเรียบร้อยแล้ว");
    }
    await loadAssets($("#assetSearch")?.value?.trim()||"");
    render();
  }catch(e){
    toast("#assetMsgErr", e.message || "บันทึกไม่สำเร็จ", true);
  }
}

function collectAssetForm(asset){
  const get = (id) => (document.getElementById(id)?.value ?? "").toString();
  const toNum = (v)=> {
    if (v === "" || v == null) return "";
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };
  return {
    "รหัสเครื่องมือห้องปฏิบัติการ": get("f_code").trim(),
    "ชื่อ": get("f_name").trim(),
    "รุ่น": get("f_model").trim(),
    "หมายเลขเครื่อง": get("f_sn").trim(),
    "AssetID": get("f_assetid").trim(),
    "สถานะ": get("f_status"),
    "สถานะแจ้งซ่อม": get("f_maint"),
    "ต้นทุนต่อหน่วย": toNum(get("f_cost")),
    "ประเภทครุภัณฑ์": get("f_type").trim(),
    "หมวดครุภัณฑ์": get("f_cat").trim(),
    "สถานที่ใช้งาน (ปัจจุบัน)": get("f_loc").trim(),
    "หมายเหตุการซ่อม": get("f_note").trim(),
    "รูปภาพครุภัณฑ์": asset["รูปภาพครุภัณฑ์"] || ""
  };
}

/* Chart */
function renderStatusChart(rows){
  const ctx = document.getElementById("statusChart");
  if(!ctx) return;

  const labels = rows.map(r=>r.label);
  const data = rows.map(r=>r.count);

  if(state.chart){
    state.chart.destroy();
    state.chart = null;
  }
  state.chart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: {
        legend: { position: "bottom" },
        tooltip: { enabled:true }
      },
      cutout: "55%"
    }
  });
}

/* Toast helper */
function toast(sel, msg, isErr=false){
  const elx = document.querySelector(sel);
  if(!elx) return;
  elx.textContent = msg;
  elx.classList.remove("hidden");
  // auto-hide success
  if(!isErr){
    setTimeout(()=> elx.classList.add("hidden"), 2200);
  }
}

/* Debounce */
function debounce(fn, wait){
  let t; 
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), wait);
  };
}

// Always-visible horizontal scroll bar for wide tables.
// Works even when OS/browser uses overlay scrollbars (user can't see a bar to drag).

function scrollToAssetDetail(){
  const el = document.getElementById("assetDetailAnchor");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // เผื่อ topbar บัง
  setTimeout(()=> window.scrollBy({ top: -80, left: 0, behavior: "smooth" }), 150);
}

/* Escape */
function escapeHtml(str){
  return (str ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function escapeAttr(str){
  return escapeHtml(str).replaceAll("\n"," ");
}

/* -------- App bootstrap -------- */

async function loadAssets(q=""){
  const r = await API.listAssets(q);
  state.assets = r.assets || [];
  updateMaintenanceBadge();
}

async function loadCalibration(){
  const r = await API.listCalibration();
  state.calibration = r.items || [];
  state.calibrationMeta = r.meta || null;
}

async function bootstrap(){
  try{
    const meta = await API.meta();
    state.meta = meta.meta;
    state.maintChoices = meta.maintenanceStatusChoices || [];
  }catch(e){
    console.warn("meta error", e);
  }

  // try restore session
  if(state.token){
    try{
      const me = await API.me();
      state.user = me.user;
      $("#userDisplayName").textContent = state.user.displayName;
      $("#userRole").textContent = state.user.role.toUpperCase();
      $("#userAvatar").textContent = initials(state.user.displayName);
      await loadAssets();
      try{ await loadCalibration(); }catch{}
      showApp();
      routeTo("home");
      return;
    }catch(e){
      // invalid token
      localStorage.removeItem("mem_token");
      state.token = "";
    }
  }
  showLogin();
}

document.addEventListener("DOMContentLoaded", ()=>{
  // login
  $("#btnLogin").addEventListener("click", async ()=>{
    const u = $("#loginUsername").value.trim();
    const p = $("#loginPassword").value;
    $("#loginError").classList.add("hidden");
    try{
      const r = await API.login(u,p);
      state.token = r.token;
      localStorage.setItem("mem_token", state.token);
      state.user = r.user;
      $("#userDisplayName").textContent = state.user.displayName;
      $("#userRole").textContent = state.user.role.toUpperCase();
      $("#userAvatar").textContent = initials(state.user.displayName);
      await loadAssets();
      try{ await loadCalibration(); }catch{}
      showApp();
      routeTo("home");
    }catch(e){
      $("#loginError").textContent = e.message || "เข้าสู่ระบบไม่สำเร็จ";
      $("#loginError").classList.remove("hidden");
    }
  });

  // menu
  document.querySelectorAll(".menuBtn").forEach(btn=>{
    btn.addEventListener("click", ()=> routeTo(btn.dataset.route));
  });

  // logout
  $("#btnLogout").addEventListener("click", ()=>{
    localStorage.removeItem("mem_token");
    state.token = "";
    state.user = null;
    state.assets = [];
    showLogin();
  });

  bootstrap();
});
