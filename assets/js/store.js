/*
 * ที่เก็บข้อมูลในเครื่อง (localStorage)
 * ข้อมูลผู้ป่วยถูกเก็บไว้ 24 ชั่วโมงนับจากเวลาบันทึก แล้วลบออกอัตโนมัติ
 */
const Store = (() => {
  'use strict';

  const KEY = 'newsphon.records.v1';
  const PREFS_KEY = 'newsphon.prefs.v1';
  const RETENTION_MS = 24 * 60 * 60 * 1000;
  const listeners = new Set();

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  let records = read(KEY, []);
  if (!Array.isArray(records)) records = [];

  function persist() {
    const ok = write(KEY, records);
    listeners.forEach(fn => fn());
    return ok;
  }

  function purge() {
    const now = Date.now();
    const before = records.length;
    records = records.filter(r => now - r.savedAt < RETENTION_MS);
    const removed = before - records.length;
    if (removed) persist();
    return removed;
  }

  // ซิงก์ระหว่างแท็บในเครื่องเดียวกัน
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    records = read(KEY, []);
    listeners.forEach(fn => fn());
  });

  return {
    RETENTION_MS,
    all: () => records.slice(),
    get: id => records.find(r => r.id === id) || null,
    add(rec) { records.push(rec); return persist(); },
    update(id, patch) {
      const i = records.findIndex(r => r.id === id);
      if (i === -1) return false;
      records[i] = { ...records[i], ...patch, id };
      return persist();
    },
    remove(id) { records = records.filter(r => r.id !== id); return persist(); },
    clear() { records = []; return persist(); },
    purge,
    onChange(fn) { listeners.add(fn); },
    prefs: () => read(PREFS_KEY, {}),
    setPrefs(p) { write(PREFS_KEY, { ...read(PREFS_KEY, {}), ...p }); },
  };
})();
