(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const HOSPITAL = 'โรงพยาบาลพล';
  const REPORT_TITLE = 'บันทึกผลการตรวจวัดสัญญาณชีพ และการประมวลผล NEWS Score';

  // ช่วงค่าที่ยอมรับได้ (กันพิมพ์ผิด) ไม่ใช่ช่วงปกติทางคลินิก
  const VITALS = [
    { key: 'bt',   label: 'อุณหภูมิกาย',          abbr: 'BT',   unit: '°C',   step: '0.1', mode: 'decimal', min: 25, max: 45,  ph: '37.0', required: true },
    { key: 'pr',   label: 'ชีพจร',                abbr: 'PR',   unit: 'bpm',  step: '1',   mode: 'numeric', min: 20, max: 300, ph: '80',   required: true },
    { key: 'rr',   label: 'อัตราการหายใจ',        abbr: 'RR',   unit: '/min', step: '1',   mode: 'numeric', min: 0,  max: 80,  ph: '18',   required: true },
    { key: 'sbp',  label: 'ความดันซิสโตลิก',      abbr: 'SBP',  unit: 'mmHg', step: '1',   mode: 'numeric', min: 40, max: 300, ph: '120',  required: true },
    { key: 'dbp',  label: 'ความดันไดแอสโตลิก',    abbr: 'DBP',  unit: 'mmHg', step: '1',   mode: 'numeric', min: 10, max: 200, ph: '80',   required: false, noScore: true },
    { key: 'spo2', label: 'ความอิ่มตัวออกซิเจน',  abbr: 'SpO₂', unit: '%',    step: '1',   mode: 'numeric', min: 50, max: 100, ph: '98',   required: true },
  ];
  const VITAL = Object.fromEntries(VITALS.map(p => [p.key, p]));

  /* ───────────── helpers ───────────── */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = ts => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543}`; };
  const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDT = ts => `${fmtDate(ts)} ${fmtTime(ts)}`;
  const toLocalInput = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtVal = (k, v) => (v === null || v === undefined || v === '') ? '-' : (k === 'bt' ? Number(v).toFixed(1) : String(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const bedKey = r => `${(r.ward || '').trim().toLowerCase()}|${String(r.bed).trim().toLowerCase()}`;
  const dueAt = r => r.measuredAt + NEWS.LEVELS[r.level].recheckMin * 60000;
  const fileStamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
  const fmtRemain = ms => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
  };

  let toastTimer;
  function toast(msg, type = 'info', ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.dataset.type = type;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ───────────── ENTRY FORM ───────────── */
  const form = $('#entryForm');
  const touched = new Set();
  let submitted = false;
  let timeTouched = false;
  let editingId = null;

  function renderVitals() {
    $('#vitals').innerHTML = VITALS.map(p => `
      <div class="vital" data-param="${p.key}" data-score="">
        <label class="v-term" for="f-${p.key}"><b>${p.abbr}</b><small>${p.label}${p.noScore ? ' (ไม่คิดคะแนน)' : ''}</small></label>
        <div class="v-entry">
          <input id="f-${p.key}" name="${p.key}" type="number" step="${p.step}" inputmode="${p.mode}"
            min="${p.min}" max="${p.max}" ${p.required ? 'required' : ''} aria-describedby="e-${p.key}">
          <span class="unit">${p.unit}</span>
        </div>
        ${p.noScore ? '<span class="chip chip-na">-</span>' : `<span class="chip" data-chip="${p.key}">-</span>`}
        <span class="field-err" id="e-${p.key}"></span>
      </div>`).join('');

    // กันล้อเมาส์เปลี่ยนค่าตัวเลขโดยไม่ตั้งใจ
    $$('#vitals input').forEach(inp => inp.addEventListener('wheel', e => {
      if (document.activeElement === inp) e.preventDefault();
    }, { passive: false }));
  }

  function readVitals() {
    const v = {};
    VITALS.forEach(p => {
      const raw = form.elements[p.key].value.trim();
      v[p.key] = raw === '' ? null : Number(raw);
    });
    v.o2 = form.elements.o2.value === 'o2';
    v.avpu = form.elements.avpu.value || 'A';
    return v;
  }

  function readMeta() {
    const t = form.elements.time.value;
    return {
      bed: form.elements.bed.value.trim(),
      name: form.elements.name.value.trim(),
      ward: form.elements.ward.value.trim(),
      hn: form.elements.hn.value.trim(),
      an: form.elements.an.value.trim(),
      assessor: form.elements.assessor.value.trim(),
      measuredAt: t ? new Date(t).getTime() : NaN,
    };
  }

  function vitalError(key, v) {
    const p = VITAL[key];
    const val = v[key];
    if (val === null) return p.required ? 'จำเป็นต้องกรอก' : '';
    if (!Number.isFinite(val)) return 'ตัวเลขไม่ถูกต้อง';
    if (val < p.min || val > p.max) return `ช่วงที่รับได้ ${p.min}-${p.max}`;
    if (key === 'dbp' && v.sbp !== null && Number.isFinite(v.sbp) && val >= v.sbp) return 'DBP ต้องน้อยกว่า SBP';
    return '';
  }

  function validateAll(v, meta) {
    const errors = {};
    if (!meta.bed) errors.bed = 'กรุณาระบุเตียง';
    if (!Number.isFinite(meta.measuredAt)) errors.time = 'กรุณาระบุเวลา';
    else if (meta.measuredAt > Date.now() + 5 * 60000) errors.time = 'เวลาอยู่ในอนาคต';
    VITALS.forEach(p => { const e = vitalError(p.key, v); if (e) errors[p.key] = e; });
    return errors;
  }

  function setFieldError(key, msg) {
    const el = $(`#e-${key}`);
    if (el) el.textContent = msg || '';
    const input = form.elements[key];
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const tile = $(`.vital[data-param="${key}"]`);
    if (tile) tile.classList.toggle('invalid', !!msg);
  }

  function liveUpdate() {
    const v = readVitals();
    let sum = 0;
    let done = 0;
    const flags = [];

    NEWS.ORDER.forEach(k => {
      let s = null;
      if (k === 'o2' || k === 'avpu') s = NEWS.scoreParam(k, v[k]);
      else if (v[k] !== null && !vitalError(k, v)) s = NEWS.scoreParam(k, v[k]);

      const chip = $(`[data-chip="${k}"]`);
      if (chip) {
        chip.textContent = s === null ? '-' : `+${s}`;
        chip.dataset.s = s === null ? '' : s;
      }
      const tile = $(`.vital[data-param="${k}"]`);
      if (tile) tile.dataset.score = s === null ? '' : s;
      if (s !== null) { sum += s; done++; if (s === 3) flags.push(k); }
    });

    // แสดง error แบบสด เฉพาะช่องที่แตะแล้ว
    VITALS.forEach(p => {
      if (submitted || touched.has(p.key)) setFieldError(p.key, vitalError(p.key, v));
    });

    const live = $('#live');
    const complete = done === NEWS.ORDER.length;
    const missing = NEWS.ORDER.length - done;
    // o2 และ avpu มีค่าเริ่มต้นเสมอ ยังไม่แสดงคะแนนจนกว่าจะเริ่มกรอกสัญญาณชีพ
    $('#liveTotal').textContent = done <= 2 ? '-' : sum;

    if (complete) {
      const lvl = NEWS.levelOf(sum);
      const L = NEWS.LEVELS[lvl];
      live.dataset.level = lvl;
      $('#liveNote').textContent = `${L.name} (${L.risk})`;
      $('#liveAction').innerHTML = L.lines.map(esc).join('<br>');
    } else {
      live.dataset.level = 'none';
      $('#liveNote').textContent = done <= 2 ? 'กรอกสัญญาณชีพให้ครบเพื่อคำนวณ' : `คะแนนบางส่วน ยังขาดอีก ${missing} รายการ`;
      $('#liveAction').innerHTML = '';
    }

    const flag = $('#liveFlag');
    if (flags.length && !(complete && NEWS.levelOf(sum) === 'red')) {
      flag.hidden = false;
      flag.textContent = `พบพารามิเตอร์ได้ 3 คะแนน: ${flags.map(k => NEWS.LABELS[k]).join(', ')}`;
    } else {
      flag.hidden = true;
    }
  }

  function setTimeNow() {
    form.elements.time.value = toLocalInput(Date.now());
    timeTouched = false;
    setFieldError('time', '');
  }

  function resetForm({ keepSticky = true } = {}) {
    const keep = { ward: form.elements.ward.value, assessor: form.elements.assessor.value };
    form.reset();
    if (keepSticky) {
      form.elements.ward.value = keep.ward;
      form.elements.assessor.value = keep.assessor;
    }
    touched.clear();
    submitted = false;
    editingId = null;
    $('#editBanner').hidden = true;
    $('#btnSubmit span').textContent = 'ประเมินและบันทึก';
    ['bed', 'time', ...VITALS.map(p => p.key)].forEach(k => setFieldError(k, ''));
    setTimeNow();
    liveUpdate();
  }

  function refreshWardList() {
    const wards = new Set([...(Store.prefs().wards || []), ...Store.all().map(r => r.ward).filter(Boolean)]);
    $('#wardList').innerHTML = [...wards].map(w => `<option value="${esc(w)}">`).join('');
  }

  function rememberPrefs(meta) {
    const prefs = Store.prefs();
    const wards = [meta.ward, ...(prefs.wards || [])].filter(Boolean);
    Store.setPrefs({
      ward: meta.ward,
      assessor: meta.assessor,
      wards: [...new Set(wards)].slice(0, 20),
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    submitted = true;
    const v = readVitals();
    const meta = readMeta();
    const errors = validateAll(v, meta);
    ['bed', 'time', ...VITALS.map(p => p.key)].forEach(k => setFieldError(k, errors[k]));
    liveUpdate();

    const firstKey = ['bed', 'time', ...VITALS.map(p => p.key)].find(k => errors[k]);
    if (firstKey) {
      form.elements[firstKey].focus();
      toast('กรุณาตรวจสอบข้อมูลที่ยังไม่ครบหรือไม่ถูกต้อง', 'error');
      return;
    }

    const res = NEWS.compute(v);
    const now = Date.now();
    const rec = {
      measuredAt: meta.measuredAt,
      ward: meta.ward, bed: meta.bed, name: meta.name, hn: meta.hn, an: meta.an, assessor: meta.assessor,
      bt: Math.round(v.bt * 10) / 10, pr: v.pr, rr: v.rr, sbp: v.sbp, dbp: v.dbp, spo2: v.spo2,
      o2: v.o2, avpu: v.avpu,
      scores: res.scores, total: res.total, level: res.level, redFlags: res.redFlags,
    };

    let ok;
    let saved;
    if (editingId && Store.get(editingId)) {
      ok = Store.update(editingId, { ...rec, updatedAt: now });
      saved = Store.get(editingId);
    } else {
      saved = { id: uid(), savedAt: now, ...rec };
      ok = Store.add(saved);
    }
    if (!ok) toast('บันทึกลงเครื่องไม่สำเร็จ (พื้นที่จัดเก็บเต็มหรือถูกปิดกั้น)', 'error');

    rememberPrefs(meta);
    refreshWardList();
    openResult(saved, !!editingId);
    resetForm();
  }

  function startEdit(id) {
    const r = Store.get(id);
    if (!r) return;
    location.hash = '#/entry';
    resetForm();
    editingId = id;
    const f = form.elements;
    f.bed.value = r.bed; f.name.value = r.name || ''; f.ward.value = r.ward || ''; f.hn.value = r.hn || ''; f.an.value = r.an || ''; f.assessor.value = r.assessor || '';
    f.time.value = toLocalInput(r.measuredAt); timeTouched = true;
    VITALS.forEach(p => { f[p.key].value = r[p.key] ?? ''; });
    $(`#o2-${r.o2 ? 'on' : 'air'}`).checked = true;
    $(`#avpu-${r.avpu.toLowerCase()}`).checked = true;
    $('#editLabel').textContent = `เตียง ${r.bed} เวลา ${fmtDT(r.measuredAt)} น.`;
    $('#editBanner').hidden = false;
    $('#btnSubmit span').textContent = 'บันทึกการแก้ไข';
    liveUpdate();
    f.bed.focus();
  }

  /* ───────────── RESULT POP-UP ───────────── */
  const modal = $('#resultModal');
  let lastFocus = null;
  let resultId = null;

  function openResult(rec, isEdit) {
    const L = NEWS.LEVELS[rec.level];
    resultId = rec.id;
    $('#resReport').hidden = !(rec.level === 'orange' || rec.level === 'red');
    const card = $('.modal-card', modal);
    card.dataset.level = rec.level;
    $('#resTotal').textContent = rec.total;
    $('#resAction').innerHTML = L.lines.map(esc).join('<br>');
    $('#resBand').textContent = L.band;
    $('#resMeta').textContent = [
      `เตียง ${rec.bed}`, rec.name, rec.ward, `${fmtTime(rec.measuredAt)} น.`,
    ].filter(Boolean).join(' | ') + (isEdit ? ' | แก้ไขแล้ว' : '');

    const warn = $('#resWarn');
    if (rec.redFlags.length && rec.level !== 'red') {
      warn.hidden = false;
      warn.innerHTML = `<b>พบพารามิเตอร์ที่ได้ 3 คะแนน:</b> ${rec.redFlags.map(k => esc(NEWS.LABELS[k])).join(', ')}<br>
        ตามแนวทาง NEWS2 ควรแจ้งพยาบาลหัวหน้าเวรเพื่อประเมินผู้ป่วยโดยเร็ว`;
    } else {
      warn.hidden = true;
    }

    const valueOf = k => k === 'o2' ? (rec.o2 ? 'O₂' : 'Air') : k === 'avpu' ? rec.avpu : fmtVal(k, rec[k]);
    $('#resBreakdown').innerHTML = NEWS.ORDER.map(k => `
      <li data-s="${rec.scores[k]}"><span class="bd-k">${esc(NEWS.LABELS[k])}</span><span class="bd-v">${esc(valueOf(k))}</span><span class="bd-s">+${rec.scores[k]}</span></li>`).join('');

    const due = dueAt(rec);
    $('#resNext').innerHTML = rec.level === 'red'
      ? `ประเมินซ้ำ<b>ทันที</b> หากไม่ดีขึ้นรายงานแพทย์ภายใน <b>${fmtTime(due)} น.</b>`
      : rec.level === 'orange'
        ? `ประเมินซ้ำ หากไม่ดีขึ้นรายงานแพทย์ภายใน <b>${fmtTime(due)} น.</b>`
        : `ประเมินครั้งถัดไปภายใน <b>${fmtTime(due)} น.</b>`;

    lastFocus = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    $('#resNew').focus({ preventScroll: true });
    $('.modal-card', modal).scrollTop = 0;
  }

  function closeResult() {
    if (modal.hidden) return;
    modal.classList.remove('open');
    modal.hidden = true;
    if (location.hash.startsWith('#/entry') || !location.hash) form.elements.bed.focus();
    else if (lastFocus) lastFocus.focus?.();
  }

  /* ───────────── DIALOGS (รายงานแพทย์ / กราฟแนวโน้ม) ───────────── */
  const reportModal = $('#reportModal');
  const trendModal = $('#trendModal');
  let reportId = null;

  function openDlg(el, focusSel) {
    el._lastFocus = document.activeElement;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
    $(focusSel, el)?.focus({ preventScroll: true });
    $('.modal-card', el).scrollTop = 0;
  }

  function closeDlg(el) {
    if (el.hidden) return;
    el.classList.remove('open');
    el.hidden = true;
    el._lastFocus?.focus?.();
  }

  const closeAny = m => (m === modal ? closeResult() : closeDlg(m));

  function responseLimit(rec) {
    return NEWS.LEVELS[rec.level].recheckMin;
  }

  function openReport(id) {
    const r = Store.get(id);
    if (!r) return;
    reportId = id;
    const L = NEWS.LEVELS[r.level];
    const rep = r.report;
    $('#rpSub').textContent = [`เตียง ${r.bed}`, r.name, `NEWS ${r.total} (${L.name})`, `วัดเมื่อ ${fmtDT(r.measuredAt)} น.`].filter(Boolean).join(' | ');
    $('#rp-time').value = toLocalInput(rep ? rep.at : Date.now());
    $('#rp-doctor').value = rep?.doctor || '';
    $('#rp-time-err').textContent = '';
    $('#rpClear').hidden = !rep;
    updateReportElapsed();
    openDlg(reportModal, '#rp-doctor');
  }

  function updateReportElapsed() {
    const r = Store.get(reportId);
    const t = $('#rp-time').value;
    const out = $('#rpElapsed');
    if (!r || !t) { out.textContent = ''; return; }
    const mins = Math.round((new Date(t).getTime() - r.measuredAt) / 60000);
    const limit = responseLimit(r);
    out.textContent = mins < 0
      ? ''
      : `รายงานหลังวัดค่า ${mins} นาที (เกณฑ์ภายใน ${limit} นาที${mins > limit ? ' · เกินเกณฑ์' : ''})`;
    out.dataset.over = mins > limit;
  }

  function onReportSubmit(e) {
    e.preventDefault();
    const r = Store.get(reportId);
    if (!r) return closeDlg(reportModal);
    const t = $('#rp-time').value;
    const at = t ? new Date(t).getTime() : NaN;
    const err = !Number.isFinite(at) ? 'กรุณาระบุเวลา'
      : at > Date.now() + 5 * 60000 ? 'เวลาอยู่ในอนาคต'
      : at < r.measuredAt ? 'เวลารายงานต้องไม่ก่อนเวลาที่วัดค่า' : '';
    $('#rp-time-err').textContent = err;
    if (err) return $('#rp-time').focus();
    Store.update(reportId, { report: { at, doctor: $('#rp-doctor').value.trim() } });
    closeDlg(reportModal);
    toast('บันทึกการรายงานแพทย์แล้ว', 'ok');
  }

  function openTrend(id) {
    const r = Store.get(id);
    if (!r) return;
    const k = bedKey(r);
    const pts = Store.all().filter(x => bedKey(x) === k).sort((a, b) => a.measuredAt - b.measuredAt || a.savedAt - b.savedAt);
    $('#trTitle').textContent = `แนวโน้มคะแนน NEWS เตียง ${r.bed}`;
    $('#trSub').textContent = [r.ward, r.name, r.hn && `HN ${r.hn}`, r.an && `AN ${r.an}`].filter(Boolean).join(' | ') || ' ';
    $('#trChart').innerHTML = trendSvg(pts);

    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    let note = `${pts.length} ครั้ง ตั้งแต่ ${fmtDT(pts[0].measuredAt)} ถึง ${fmtDT(last.measuredAt)} น.`;
    if (prev) {
      const d = last.total - prev.total;
      note += d > 0 ? ` · ครั้งล่าสุดเพิ่มขึ้น ${d} คะแนนจากครั้งก่อน` : d < 0 ? ` · ครั้งล่าสุดลดลง ${-d} คะแนนจากครั้งก่อน` : ' · ครั้งล่าสุดเท่าเดิม';
    } else {
      note += ' · มีข้อมูลเพียงครั้งเดียว กราฟจะแสดงแนวโน้มเมื่อบันทึกครั้งถัดไป';
    }
    const n = $('#trNote');
    n.textContent = note;
    n.dataset.over = !!prev && last.total > prev.total;
    openDlg(trendModal, '.dlg-close');
  }

  function trendSvg(pts) {
    const W = 680, H = 300, ml = 40, mr = 20, mt = 18, mb = 38;
    const iw = W - ml - mr, ih = H - mt - mb;
    const yMax = Math.max(9, Math.max(...pts.map(p => p.total)) + 1);
    const y = v => mt + (1 - v / yMax) * ih;
    const t0 = pts[0].measuredAt, t1 = pts[pts.length - 1].measuredAt;
    const span = t1 - t0;
    const x = t => ml + (span ? (t - t0) / span * 0.9 + 0.05 : 0.5) * iw;

    const bands = [['green', 0, 2.5], ['yellow', 2.5, 4.5], ['orange', 4.5, 6.5], ['red', 6.5, yMax]]
      .map(([l, a, b]) => `<rect class="tr-band" data-level="${l}" x="${ml}" y="${y(b)}" width="${iw}" height="${y(a) - y(b)}"/>`).join('');

    const step = yMax <= 12 ? 1 : 2;
    let grid = '';
    for (let v = 0; v <= yMax; v += step) {
      grid += `<line class="tr-grid" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text class="tr-ytick" x="${ml - 8}" y="${y(v) + 4}">${v}</text>`;
    }

    const nTicks = span ? Math.min(5, pts.length) : 1;
    let xt = '';
    for (let i = 0; i < nTicks; i++) {
      const tt = nTicks === 1 ? t0 : t0 + (span * i) / (nTicks - 1);
      xt += `<text class="tr-xtick" x="${x(tt)}" y="${H - mb + 20}">${fmtTime(tt)}</text>`;
    }

    const line = pts.length > 1 ? `<polyline class="tr-line" points="${pts.map(p => `${x(p.measuredAt)},${y(p.total)}`).join(' ')}"/>` : '';
    const dots = pts.map(p => `<g class="tr-pt" data-level="${p.level}"><title>${fmtDT(p.measuredAt)} น. · NEWS ${p.total}</title>
      <circle cx="${x(p.measuredAt)}" cy="${y(p.total)}" r="7"/><text x="${x(p.measuredAt)}" y="${y(p.total) - 12}">${p.total}</text></g>`).join('');

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟคะแนน NEWS ตามเวลา">${bands}${grid}${xt}${line}${dots}
      <text class="tr-ytitle" x="${ml}" y="${mt - 6}">NEWS Score</text></svg>`;
  }

  /* ───────────── REMINDER ALERTS ───────────── */
  const alerted = new Set();
  let audioCtx = null;

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      [0, 0.28, 0.56].forEach(offset => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const t = audioCtx.currentTime + offset;
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.24);
      });
    } catch { /* ไม่มีเสียงก็ยังแจ้งด้วยข้อความ */ }
  }

  function dueRecords() {
    const all = Store.all();
    const latest = latestIds(all);
    const now = Date.now();
    return all.filter(r => latest.has(r.id) && now >= dueAt(r));
  }

  function checkDue() {
    // ครั้งที่ถูกแก้เวลาให้ยังไม่ถึงกำหนด หรือถูกลบ ให้แจ้งใหม่ได้
    const now = Date.now();
    alerted.forEach(id => { const r = Store.get(id); if (!r || now < dueAt(r)) alerted.delete(id); });
    if (!Store.prefs().alerts) return;

    const fresh = dueRecords().filter(r => !alerted.has(r.id));
    if (!fresh.length) return;
    fresh.forEach(r => alerted.add(r.id));
    const names = fresh.map(r => `เตียง ${r.bed}`).join(', ');
    beep();
    toast(`ถึงเวลาประเมินซ้ำ: ${names}`, 'error', 10000);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('NEWS Score · ถึงเวลาประเมินซ้ำ', { body: names, tag: 'news-due' }); } catch { /* ignore */ }
    }
  }

  async function onAlertToggle(e) {
    const on = e.target.checked;
    Store.setPrefs({ alerts: on });
    if (!on) return toast('ปิดการแจ้งเตือนแล้ว');
    dueRecords().forEach(r => alerted.add(r.id)); // รายการที่เลยกำหนดอยู่แล้ว ไม่ต้องแจ้งซ้ำทันที (ดูได้ในชีต)
    beep(); // เปิด AudioContext จากการกดของผู้ใช้ และให้ได้ยินเสียงตัวอย่าง
    let extra = '';
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    if ('Notification' in window && Notification.permission !== 'granted') extra = ' (เบราว์เซอร์ไม่อนุญาตการแจ้งเตือนบนหน้าจอ จะแจ้งด้วยเสียงและข้อความในหน้านี้)';
    toast('เปิดการแจ้งเตือนแล้ว ต้องเปิดหน้าเว็บนี้ค้างไว้' + extra, 'ok', 5000);
  }

  /* ───────────── SHEET ───────────── */
  function latestIds(records) {
    const map = new Map();
    records.forEach(r => {
      const k = bedKey(r);
      const cur = map.get(k);
      if (!cur || r.measuredAt > cur.measuredAt || (r.measuredAt === cur.measuredAt && r.savedAt > cur.savedAt)) map.set(k, r);
    });
    return new Set([...map.values()].map(r => r.id));
  }

  function filteredRows() {
    const all = Store.all();
    const latest = latestIds(all);
    const q = $('#q').value.trim().toLowerCase();
    const ward = $('#fWard').value;
    const lvl = $('#fLevel').value;
    const onlyLatest = $('#fLatest').checked;

    const rows = all.filter(r =>
      (!onlyLatest || latest.has(r.id)) &&
      (!ward || r.ward === ward) &&
      (!lvl || r.level === lvl) &&
      (!q || [r.bed, r.name, r.hn, r.an, r.assessor, r.ward].some(x => String(x || '').toLowerCase().includes(q)))
    ).sort((a, b) => b.measuredAt - a.measuredAt || b.savedAt - a.savedAt);

    return { rows, latest, all };
  }

  function renderSummary(all, latest) {
    const now = Date.now();
    const current = all.filter(r => latest.has(r.id));
    const count = lvl => current.filter(r => r.level === lvl).length;
    const overdue = current.filter(r => now > dueAt(r)).length;
    const activeLvl = $('#fLevel').value;
    const tiles = ['red', 'orange', 'yellow', 'green'].map(l => {
      const L = NEWS.LEVELS[l];
      return `<button type="button" class="sum-tile" data-lvl="${l}" aria-pressed="${activeLvl === l}">
        <span class="sum-n">${count(l)}</span>
        <span class="sum-l">${L.name}<small>NEWS ${L.range}</small></span>
      </button>`;
    }).join('');
    $('#summary').innerHTML = `
      <div class="sum-lead">
        <span class="sum-n">${current.length}</span>
        <span class="sum-l">เตียงที่ติดตาม<small>${all.length} รายการใน 24 ชม.</small></span>
      </div>
      ${tiles}
      <div class="sum-overdue" data-has="${overdue > 0}">
        <span class="sum-n">${overdue}</span>
        <span class="sum-l">เลยกำหนดประเมินซ้ำ<small>นับจากครั้งล่าสุดของเตียง</small></span>
      </div>`;
  }

  function reportCell(r, now) {
    if (r.report) {
      const mins = Math.round((r.report.at - r.measuredAt) / 60000);
      const over = mins > responseLimit(r);
      return `<button type="button" class="rep rep-done${over ? ' late' : ''}" data-act="report" title="แก้ไขบันทึกการรายงานแพทย์">
        ${fmtTime(r.report.at)} น.<small>${r.report.doctor ? esc(r.report.doctor) + ' · ' : ''}${mins} นาที${over ? ' (เกินเกณฑ์)' : ''}</small></button>`;
    }
    if (r.level === 'orange' || r.level === 'red') {
      const over = now > r.measuredAt + responseLimit(r) * 60000;
      return `<button type="button" class="rep rep-todo${over ? ' over' : ''}" data-act="report">${over ? 'เลยกำหนด · ' : ''}บันทึกรายงาน</button>`;
    }
    return '<span class="muted">-</span>';
  }

  function renderWardFilter(all) {
    const sel = $('#fWard');
    const cur = sel.value;
    const wards = [...new Set(all.map(r => r.ward).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
    sel.innerHTML = '<option value="">ทุกหน่วยงาน</option>' + wards.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
    sel.value = wards.includes(cur) ? cur : '';
  }

  function renderSheet() {
    Store.purge();
    const allNow = Store.all();
    renderWardFilter(allNow);
    const { rows, latest, all } = filteredRows();
    renderSummary(all, latest);

    const now = Date.now();
    $('#sheetBody').innerHTML = rows.map(r => {
      const isLatest = latest.has(r.id);
      const due = dueAt(r);
      let dueCell = '<span class="due due-done" title="มีการประเมินที่ใหม่กว่าแล้ว">-</span>';
      if (isLatest) {
        dueCell = now > due
          ? `<span class="due due-over">เลย ${fmtTime(due)}</span>`
          : `<span class="due">${r.level === 'red' ? 'ทันที, ' : ''}${fmtTime(due)}</span>`;
      }
      const flag = r.redFlags?.length && r.level !== 'red' ? `<span class="flag3" title="มีพารามิเตอร์ได้ 3 คะแนน: ${esc(r.redFlags.map(k => NEWS.LABELS[k]).join(', '))}">!</span>` : '';
      const cls = k => (NEWS.ORDER.includes(k) && r.scores?.[k] > 0) ? ` s${r.scores[k]}` : '';
      const sc = k => (r.scores?.[k] === 0) ? `<span class="sc" data-s="0" title="0 คะแนน">0</span>` : (r.scores?.[k] > 0) ?`<span class="sc" data-s="${r.scores[k]}" title="${r.scores[k]} คะแนน">${r.scores[k]}</span>` : '';
      return `<tr data-id="${esc(r.id)}" data-level="${r.level}" class="${isLatest ? 'is-latest' : 'is-old'}">
        <td class="t-time"><span>${fmtTime(r.measuredAt)}</span><small>${fmtDate(r.measuredAt)}</small></td>
        <td class="t-bed"><button type="button" class="bed-link" data-act="trend" title="ดูกราฟแนวโน้มคะแนนของเตียงนี้">${esc(r.bed)}</button></td>
        <td class="t-name">${r.name ? esc(r.name) : '<span class="muted">-</span>'}${r.hn || r.an ? `<small>${[r.hn && 'HN ' + esc(r.hn), r.an && 'AN ' + esc(r.an)].filter(Boolean).join(' · ')}</small>` : ''}${r.assessor ? `<small>ผู้ประเมิน: ${esc(r.assessor)}</small>` : ''}</td>
        <td class="num${cls('bt')}">${fmtVal('bt', r.bt)}${sc('bt')}</td>
        <td class="num${cls('pr')}">${fmtVal('pr', r.pr)}${sc('pr')}</td>
        <td class="num${cls('rr')}">${fmtVal('rr', r.rr)}${sc('rr')}</td>
        <td class="num${cls('sbp')}">${fmtVal('sbp', r.sbp)}${sc('sbp')}</td>
        <td class="num">${fmtVal('dbp', r.dbp)}</td>
        <td class="num${cls('spo2')}">${fmtVal('spo2', r.spo2)}${sc('spo2')}</td>
        <td class="${cls('o2').trim()}">${r.o2 ? 'O₂' : 'Air'}${sc('o2')}</td>
        <td class="${cls('avpu').trim()}">${esc(r.avpu)}${sc('avpu')}</td>
        <td class="num"><span class="pill" data-level="${r.level}">${r.total}</span>${flag}</td>
        <td class="t-ward">${r.ward ? esc(r.ward) : '<span class="muted">-</span>'}</td>
        <td>${dueCell}</td>
        <td class="t-rep">${reportCell(r, now)}</td>
        <td class="actions">
          <button type="button" class="icon-btn" data-act="edit" title="แก้ไข" aria-label="แก้ไขเตียง ${esc(r.bed)}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
          <button type="button" class="icon-btn danger" data-act="del" title="ลบ" aria-label="ลบเตียง ${esc(r.bed)}"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/></svg></button>
        </td>
      </tr>`;
    }).join('');

    const empty = $('#sheetEmpty');
    empty.hidden = rows.length > 0;
    $('#emptyText').textContent = allNow.length ? 'ไม่พบข้อมูลตามตัวกรองที่เลือก' : 'ยังไม่มีข้อมูลในชีต';
    $('.table-wrap .sheet').classList.toggle('is-empty', rows.length === 0);
    $('.table-wrap .sheet').classList.toggle('show-scores', $('#fScores').checked);

    const oldest = allNow.reduce((m, r) => Math.min(m, r.savedAt), Infinity);
    $('#sheetFoot').textContent = allNow.length
      ? `แสดง ${rows.length} จาก ${allNow.length} รายการ ข้อมูลเก็บไว้ 24 ชม. นับจากเวลาบันทึก รายการเก่าสุดจะถูกลบในอีก ${fmtRemain(oldest + Store.RETENTION_MS - now)} (การส่งออกใช้ข้อมูลตามตัวกรองปัจจุบัน)`
      : 'ข้อมูลเก็บไว้ในเบราว์เซอร์ของเครื่องนี้ 24 ชม. นับจากเวลาบันทึก แล้วลบออกอัตโนมัติ';
  }

  function updateNavCount() {
    $('#navCount').textContent = Store.all().length;
  }

  /* ───────────── EXPORT ───────────── */
  const EXPORT_HEADERS = ['วันที่', 'เวลา', 'หน่วยงาน', 'Bed', 'Name', 'HN', 'AN', 'BT (°C)', 'PR (bpm)', 'RR (/min)', 'SBP (mmHg)', 'DBP (mmHg)', 'SpO2 (%)', 'O2', 'ความรู้สึกตัว', 'NEWS Score', 'ระดับ', 'ข้อปฏิบัติ', 'ผู้ประเมิน', 'รายงานแพทย์', 'เวลารายงานแพทย์', 'แพทย์ที่รับรายงาน'];
  const EXPORT_WIDTHS = [12, 7, 18, 8, 22, 12, 12, 8, 8, 9, 10, 10, 9, 10, 12, 11, 9, 52, 18, 12, 16, 20];

  function exportRow(r) {
    const L = NEWS.LEVELS[r.level];
    return [
      fmtDate(r.measuredAt), fmtTime(r.measuredAt), r.ward || '', r.bed, r.name || '', r.hn || '', r.an || '',
      r.bt, r.pr, r.rr, r.sbp, r.dbp ?? '', r.spo2,
      r.o2 ? 'On O2' : 'Room air', r.avpu, r.total, L.name, L.lines.join(' '), r.assessor || '',
      r.report ? 'รายงานแล้ว' : (r.level === 'orange' || r.level === 'red' ? 'ยังไม่บันทึก' : ''),
      r.report ? fmtDT(r.report.at) : '', r.report?.doctor || '',
    ];
  }

  function ensureRows() {
    const { rows } = filteredRows();
    if (!rows.length) { toast('ไม่มีข้อมูลสำหรับส่งออก', 'error'); return null; }
    return rows;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportCsv() {
    const rows = ensureRows();
    if (!rows) return;
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [EXPORT_HEADERS, ...rows.map(exportRow)].map(r => r.map(cell).join(',')).join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `NEWS-Score_${fileStamp()}.csv`);
    toast(`ส่งออก CSV แล้ว ${rows.length} รายการ`, 'ok');
  }

  function exportXlsx() {
    const rows = ensureRows();
    if (!rows) return;
    if (!window.XLSX) {
      toast('โหลดตัวสร้างไฟล์ Excel ไม่ได้ (อาจไม่มีอินเทอร์เน็ต) จึงส่งออกเป็น CSV แทน', 'error');
      exportCsv();
      return;
    }
    const aoa = [
      [`${REPORT_TITLE} ${HOSPITAL}`],
      [`ส่งออกเมื่อ ${fmtDT(Date.now())} น. จำนวน ${rows.length} รายการ`],
      [],
      EXPORT_HEADERS,
      ...rows.map(exportRow),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: EXPORT_HEADERS.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: EXPORT_HEADERS.length - 1 } },
    ];
    ws['!cols'] = EXPORT_WIDTHS.map(wch => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: EXPORT_HEADERS.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'NEWS Score');
    XLSX.writeFile(wb, `NEWS-Score_${fileStamp()}.xlsx`);
    toast(`ส่งออก Excel แล้ว ${rows.length} รายการ`, 'ok');
  }

  function reportHtml(rows) {
    const now = Date.now();
    const wards = [...new Set(rows.map(r => r.ward).filter(Boolean))];
    const site = location.protocol.startsWith('http') ? location.host + location.pathname : 'NEWS Score (ใช้งานในเครื่อง)';
    const body = rows.map(r => `
      <tr>
        <td>${esc(r.bed)}</td>
        <td class="rp-name">${esc(r.name || '')}${r.hn || r.an ? `<br><small>${[r.hn && 'HN ' + esc(r.hn), r.an && 'AN ' + esc(r.an)].filter(Boolean).join(' · ')}</small>` : ''}</td>
        <td>${fmtVal('bt', r.bt)}</td>
        <td>${fmtVal('pr', r.pr)}</td>
        <td>${fmtVal('rr', r.rr)}</td>
        <td>${fmtVal('sbp', r.sbp)}</td>
        <td>${fmtVal('dbp', r.dbp)}</td>
        <td>${fmtVal('spo2', r.spo2)}</td>
        <td>${r.o2 ? 'O₂' : 'Air'}</td>
        <td>${esc(r.avpu)}</td>
        <td class="rp-score" data-level="${r.level}">${r.total}</td>
        <td class="rp-ward">${esc(r.ward || '')}</td>
        <td>${fmtDate(r.measuredAt)}<br>${fmtTime(r.measuredAt)} น.</td>
      </tr>`).join('');

    return `<div class="report">
      <div class="rp-head"><img src="assets/img/logo-mark.png" alt=""><h1>${REPORT_TITLE}</h1></div>
      <p class="rp-sub">${HOSPITAL}${wards.length ? ' หน่วยงาน: ' + esc(wards.join(', ')) : ''}</p>
      <div class="rp-notes">
        <p><b>คำชี้แจง :</b> 1) ใช้ประเมินในผู้ป่วยที่มีอายุ 15 ปี ขึ้นไปเท่านั้น และไม่อยู่ในภาวะหายใจล้มเหลวเรื้อรัง</p>
        <p class="ind">2) ข้อมูลจะถูกเก็บในระบบ 24 ชั่วโมง แล้วจะถูกลบออกจากระบบโดยอัตโนมัติ</p>
        <p><b>วัตถุประสงค์ :</b> การจัดทำ Web นี้ เพื่อความสะดวกในการประมวลผล NEWS Score และเป็นการลดการใช้กระดาษ ซึ่งเป็นที่ยอมรับในการทำงานของโรงพยาบาลของผู้จัดทำ</p>
      </div>
      <table class="rp-table">
        <colgroup><col class="c-bed"><col class="c-name"><col class="c-vital"><col class="c-vital"><col class="c-vital"><col class="c-vital"><col class="c-vital"><col class="c-vital"><col class="c-o2"><col class="c-avpu"><col class="c-score"><col class="c-ward"><col class="c-time"></colgroup>
        <thead><tr>
          <th>Bed</th><th>NAME</th><th>BT<br>(C)</th><th>PR<br>bpm</th><th>RR<br>bpm</th><th>SBP<br>mmHg</th><th>DBP<br>mmHg</th><th>SpO2<br>%</th><th>O2</th><th>AVPU</th><th>NEWS<br>Score</th><th>หน่วยงาน</th><th>วันที่/เวลา</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="rp-legend">
        <span data-level="green">0-2 เขียว: ประเมินต่อเนื่องทุก 4 ชม.</span>
        <span data-level="yellow">3-4 เหลือง: แจ้งหัวหน้าเวร ประเมินซ้ำทุก 2 ชม.</span>
        <span data-level="orange">5-6 ส้ม: แจ้งหัวหน้าเวร ไม่ดีขึ้นรายงานแพทย์ใน 30 นาที</span>
        <span data-level="red">≥ 7 แดง: แจ้งหัวหน้าเวร ประเมินซ้ำทันที ไม่ดีขึ้นรายงานแพทย์ใน 15 นาที</span>
      </div>
      <p class="rp-foot">พิมพ์เมื่อ ${fmtDate(now)} เวลา ${fmtTime(now)} น. &nbsp;|&nbsp; ${HOSPITAL} &nbsp;|&nbsp; ${esc(site)}</p>
      <p class="rp-ref">อ้างอิง: Royal College of Physicians. (2017). National Early Warning Score (NEWS) 2: Standardising the assessment of acute-illness severity in the NHS. Updated report of a working party. https://www.rcp.ac.uk/resources/national-early-warning-score-news-2/</p>
      <p class="rp-ref">นำมาประยุกต์เป็น Web page โดย นางสุมาลัย กุลวงษ์ พยาบาลวิชาชีพ โรงพยาบาลพล ผู้ประสานงาน Service Plan Sepsis และเลขานุการ IM Nurse &nbsp;|&nbsp; © 2569 จัดทำโดย นายกฤติพงศ์ กุลวงษ์</p>
    </div>`;
  }

  function printReport() {
    const rows = ensureRows();
    if (!rows) return;
    $('#printArea').innerHTML = reportHtml(rows);
    setTimeout(() => window.print(), 50);
  }

  async function exportPdf() {
    const rows = ensureRows();
    if (!rows) return;
    if (!window.html2pdf) {
      toast('โหลดตัวสร้าง PDF ไม่ได้ จึงเปิดหน้าพิมพ์แทน (เลือก "บันทึกเป็น PDF")', 'error');
      printReport();
      return;
    }
    const btn = $('[data-export="pdf"]');
    btn.disabled = true;
    toast('กำลังสร้างไฟล์ PDF…');
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const wrap = document.createElement('div');
      wrap.className = 'pdf-render';
      wrap.innerHTML = reportHtml(rows);
      await html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: `NEWS-Score_${fileStamp()}.pdf`,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, windowWidth: 1200 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' },
      }).from(wrap.firstElementChild).save();
      toast(`ส่งออก PDF แล้ว ${rows.length} รายการ`, 'ok');
    } catch (err) {
      console.error(err);
      toast('สร้าง PDF ไม่สำเร็จ จึงเปิดหน้าพิมพ์แทน', 'error');
      printReport();
    } finally {
      btn.disabled = false;
    }
  }

  function initExportMenu() {
    const btn = $('#btnExport');
    const menu = $('#exportList');
    const items = () => $$('[role="menuitem"]', menu);
    const actions = { xlsx: exportXlsx, csv: exportCsv, pdf: exportPdf, print: printReport };

    const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); items()[0].focus(); };
    const close = (focusBtn = true) => {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (focusBtn) btn.focus();
    };

    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } });
    menu.addEventListener('click', e => {
      const item = e.target.closest('[data-export]');
      if (!item) return;
      close();
      actions[item.dataset.export]();
    });
    menu.addEventListener('keydown', e => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') close(false);
    });
    document.addEventListener('click', e => { if (!e.target.closest('#exportMenu')) close(false); });
  }

  /* ───────────── CRITERIA ───────────── */
  function renderResponseGrid() {
    $('#responseGrid').innerHTML = ['green', 'yellow', 'orange', 'red'].map(l => {
      const L = NEWS.LEVELS[l];
      return `<article class="resp" data-level="${l}">
        <p class="resp-range">NEWS ${L.range}</p>
        <h3>${L.name}</h3>
        <p class="resp-risk">${L.risk}</p>
        <p class="resp-lines">${L.lines.map(esc).join('<br>')}</p>
      </article>`;
    }).join('');
  }

  /* ───────────── ROUTER / CLOCK ───────────── */
  function route() {
    const name = (location.hash.replace(/^#\//, '').split('?')[0]) || 'entry';
    const view = $(`[data-view="${name}"]`) ? name : 'entry';
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === view));
    if (view === 'sheet') renderSheet();
    if (!modal.hidden) closeResult();
    closeDlg(reportModal);
    closeDlg(trendModal);
    document.title = `${{ entry: 'บันทึกสัญญาณชีพ', sheet: 'ชีตข้อมูล', criteria: 'เกณฑ์การประเมิน' }[view]} | NEWS Score โรงพยาบาลพล`;
    window.scrollTo(0, 0);
  }

  const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  function tick() {
    const now = new Date();
    $('#clockTime').textContent = fmtTime(now);
    $('#clockDate').textContent = `วัน${TH_DAYS[now.getDay()]} ${fmtDate(now)}`;
    if (!timeTouched && !editingId) form.elements.time.value = toLocalInput(now);
  }

  /* ───────────── INIT ───────────── */
  function init() {
    renderVitals();
    renderResponseGrid();

    const prefs = Store.prefs();
    if (prefs.ward) form.elements.ward.value = prefs.ward;
    if (prefs.assessor) form.elements.assessor.value = prefs.assessor;
    Store.purge();
    refreshWardList();
    setTimeNow();
    liveUpdate();
    updateNavCount();

    form.addEventListener('input', e => {
      if (e.target.name === 'time') timeTouched = true;
      if (e.target.name === 'bed' && (submitted || touched.has('bed'))) setFieldError('bed', e.target.value.trim() ? '' : 'กรุณาระบุเตียง');
      liveUpdate();
    });
    form.addEventListener('change', liveUpdate);
    form.addEventListener('focusout', e => {
      if (!e.target.name) return;
      touched.add(e.target.name);
      if (VITAL[e.target.name]) liveUpdate();
    });
    form.addEventListener('submit', onSubmit);
    $('#btnReset').addEventListener('click', () => { resetForm(); form.elements.bed.focus(); });
    $('#btnNow').addEventListener('click', setTimeNow);
    $('#cancelEdit').addEventListener('click', () => { resetForm(); toast('ยกเลิกการแก้ไขแล้ว'); });

    // pop-up
    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeResult(); });
    $('#resNew').addEventListener('click', closeResult);
    $('#resReport').addEventListener('click', () => {
      const id = resultId;
      closeResult();
      openReport(id);
    });
    [reportModal, trendModal].forEach(m => m.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDlg(m); }));
    document.addEventListener('keydown', e => {
      const open = $$('.modal').filter(m => !m.hidden).pop();
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); closeAny(open); }
      if (e.key === 'Tab') {
        const f = $$('button, a[href], input, select, textarea', $('.modal-card', open)).filter(el => !el.disabled && !el.hidden && el.type !== 'radio' && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // บันทึกการรายงานแพทย์
    $('#reportForm').addEventListener('submit', onReportSubmit);
    $('#rp-time').addEventListener('input', updateReportElapsed);
    $('#rpNow').addEventListener('click', () => { $('#rp-time').value = toLocalInput(Date.now()); $('#rp-time-err').textContent = ''; updateReportElapsed(); });
    $('#rpClear').addEventListener('click', () => {
      if (!confirm('ลบบันทึกการรายงานแพทย์ของรายการนี้?')) return;
      Store.update(reportId, { report: undefined });
      closeDlg(reportModal);
      toast('ลบบันทึกการรายงานแพทย์แล้ว');
    });

    // sheet
    ['#q', '#fWard', '#fLevel', '#fLatest', '#fScores'].forEach(s => $(s).addEventListener('input', renderSheet));
    $('#summary').addEventListener('click', e => {
      const t = e.target.closest('.sum-tile');
      if (!t) return;
      const sel = $('#fLevel');
      sel.value = sel.value === t.dataset.lvl ? '' : t.dataset.lvl;
      renderSheet();
    });
    $('#sheetBody').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      const r = Store.get(id);
      if (!r) return;
      if (btn.dataset.act === 'edit') startEdit(id);
      if (btn.dataset.act === 'report') openReport(id);
      if (btn.dataset.act === 'trend') openTrend(id);
      if (btn.dataset.act === 'del' && confirm(`ลบข้อมูลเตียง ${r.bed} เวลา ${fmtDT(r.measuredAt)} น. ?`)) {
        Store.remove(id);
        toast('ลบรายการแล้ว');
      }
    });
    $('#btnClear').addEventListener('click', () => {
      const n = Store.all().length;
      if (!n) return toast('ไม่มีข้อมูลให้ลบ');
      if (confirm(`ลบข้อมูลทั้งหมด ${n} รายการออกจากเครื่องนี้?\nแนะนำให้ส่งออก Excel/PDF ก่อน เพราะการลบนี้ย้อนกลับไม่ได้`)) {
        Store.clear();
        toast('ลบข้อมูลทั้งหมดแล้ว');
      }
    });
    $('#fScores').checked = !!Store.prefs().showScores;
    $('#fScores').addEventListener('change', e => Store.setPrefs({ showScores: e.target.checked }));
    $('#fAlert').checked = !!Store.prefs().alerts;
    $('#fAlert').addEventListener('change', onAlertToggle);
    initExportMenu();
    window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

    Store.onChange(() => {
      updateNavCount();
      if (!$('#view-sheet').hidden) renderSheet();
    });

    window.addEventListener('hashchange', route);
    route();
    tick();
    setInterval(() => {
      tick();
      if (Store.purge() === 0 && !$('#view-sheet').hidden) renderSheet(); // อัปเดตสถานะเลยกำหนด
    }, 30000);
    checkDue();
    setInterval(checkDue, 15000);

    if (!location.hash || location.hash.startsWith('#/entry')) form.elements.bed.focus();
  }

  init();
})();
