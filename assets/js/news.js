/*
 * NEWS2 scoring: Royal College of Physicians (2017)
 * National Early Warning Score (NEWS) 2: Standardising the assessment of
 * acute-illness severity in the NHS. Updated report of a working party.
 *
 * ใช้ SpO2 Scale 1 เท่านั้น (ผู้ป่วยอายุ ≥ 15 ปี ที่ไม่อยู่ในภาวะหายใจล้มเหลวเรื้อรัง)
 */
const NEWS = (() => {
  'use strict';

  const r0 = v => Math.round(v);
  const r1 = v => Math.round(v * 10) / 10;

  const SCORERS = {
    rr:   v => { v = r0(v); return v <= 8 ? 3 : v <= 11 ? 1 : v <= 20 ? 0 : v <= 24 ? 2 : 3; },
    spo2: v => { v = r0(v); return v <= 91 ? 3 : v <= 93 ? 2 : v <= 95 ? 1 : 0; },
    o2:   on => (on ? 2 : 0),
    sbp:  v => { v = r0(v); return v <= 90 ? 3 : v <= 100 ? 2 : v <= 110 ? 1 : v <= 219 ? 0 : 3; },
    pr:   v => { v = r0(v); return v <= 40 ? 3 : v <= 50 ? 1 : v <= 90 ? 0 : v <= 110 ? 1 : v <= 130 ? 2 : 3; },
    avpu: c => (c === 'A' ? 0 : 3),
    bt:   v => { v = r1(v); return v <= 35.0 ? 3 : v <= 36.0 ? 1 : v <= 38.0 ? 0 : v <= 39.0 ? 1 : 2; },
  };

  const ORDER = ['rr', 'spo2', 'o2', 'sbp', 'pr', 'avpu', 'bt'];

  const LABELS = {
    rr: 'RR', spo2: 'SpO₂', o2: 'O₂', sbp: 'SBP', pr: 'PR', avpu: 'ความรู้สึกตัว', bt: 'BT',
  };

  const AVPU = {
    A: 'Alert: รู้สึกตัวดี',
    C: 'New confusion: สับสนเกิดขึ้นใหม่',
    V: 'Voice: ตอบสนองต่อเสียง',
    P: 'Pain: ตอบสนองต่อความเจ็บปวด',
    U: 'Unresponsive: ไม่ตอบสนอง',
  };

  // ข้อปฏิบัติตามแนวทางของโรงพยาบาล (4 ระดับสี)
  const LEVELS = {
    green: {
      key: 'green', name: 'สีเขียว', range: '0-2', risk: 'ความเสี่ยงต่ำ',
      band: '(NEWS Score 0-2 สีเขียว)',
      lines: ['ประเมินต่อเนื่องทุก 4 ชม.'],
      recheckMin: 240,
    },
    yellow: {
      key: 'yellow', name: 'สีเหลือง', range: '3-4', risk: 'ความเสี่ยงต่ำถึงปานกลาง',
      band: '(NEWS Score 3-4 สีเหลือง)',
      lines: ['แจ้งพยาบาลหัวหน้าเวร มีประเมินซ้ำ', 'ทุก 2 ชม. จนกว่าอาการจะดีขึ้น'],
      recheckMin: 120,
    },
    orange: {
      key: 'orange', name: 'สีส้ม', range: '5-6', risk: 'ความเสี่ยงปานกลาง',
      band: '(NEWS Score 5-6 สีส้ม)',
      lines: ['แจ้งพยาบาลหัวหน้าเวร มีประเมินซ้ำ', 'ไม่ดีขึ้น + รายงานแพทย์ภายใน 30 นาที'],
      recheckMin: 30,
    },
    red: {
      key: 'red', name: 'สีแดง', range: '≥ 7', risk: 'ความเสี่ยงสูง',
      band: '(NEWS Score ≥ 7 สีแดง)',
      lines: ['แจ้งพยาบาลหัวหน้าเวร ประเมินซ้ำทันที', 'ไม่ดีขึ้น + รายงานแพทย์ภายใน 15 นาที'],
      recheckMin: 15,
    },
  };

  function levelOf(total) {
    return total >= 7 ? 'red' : total >= 5 ? 'orange' : total >= 3 ? 'yellow' : 'green';
  }

  function scoreParam(key, value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return SCORERS[key](value);
  }

  /** คืนค่า null ถ้าข้อมูลไม่ครบ */
  function compute(v) {
    const scores = {};
    let total = 0;
    for (const k of ORDER) {
      const s = scoreParam(k, v[k]);
      if (s === null) return null;
      scores[k] = s;
      total += s;
    }
    return {
      scores,
      total,
      level: levelOf(total),
      redFlags: ORDER.filter(k => scores[k] === 3),
    };
  }

  return { ORDER, LABELS, AVPU, LEVELS, levelOf, scoreParam, compute };
})();

if (typeof module !== 'undefined') module.exports = NEWS;
