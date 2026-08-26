/* =========================================================================
 * store.js — データ保存層
 * すべてブラウザの localStorage に保存する。外部への送信は一切行わない。
 * ========================================================================= */
window.Store = (function () {
  'use strict';

  const KEY = 'sps.v1.db';

  const EMPTY = {
    version: 1,
    settings: { officeName: '', serviceType: '児童発達支援', manager: '', address: '', tel: '' },
    children: [],     // 児童
    plans: [],        // 個別支援計画
    splans: [],       // 専門的支援実施計画
    assessments: [],  // 発達アセスメント
    records: []       // 記録・文字起こし
  };

  let db = null;

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function load() {
    if (db) return db;
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(EMPTY));
    } catch (e) {
      console.error('保存データの読み込みに失敗しました', e);
      db = JSON.parse(JSON.stringify(EMPTY));
    }
    // 後方互換: 欠けているコレクションを補う
    Object.keys(EMPTY).forEach(function (k) {
      if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(EMPTY[k]));
    });
    return db;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(load()));
      return true;
    } catch (e) {
      alert('保存できませんでした。ブラウザの保存容量が上限に達している可能性があります。\n' +
            '「データ管理」からバックアップを取り、不要な記録を整理してください。');
      console.error(e);
      return false;
    }
  }

  /* ---- 汎用コレクション操作 -------------------------------------------- */
  function list(coll) { return load()[coll]; }

  function get(coll, id) {
    return list(coll).filter(function (r) { return r.id === id; })[0] || null;
  }

  function byChild(coll, childId) {
    return list(coll).filter(function (r) { return r.childId === childId; });
  }

  function put(coll, obj) {
    const now = new Date().toISOString();
    const arr = list(coll);
    if (!obj.id) {
      obj.id = uid(coll.slice(0, 3));
      obj.createdAt = now;
      obj.updatedAt = now;
      arr.push(obj);
    } else {
      const i = arr.findIndex(function (r) { return r.id === obj.id; });
      obj.updatedAt = now;
      if (i >= 0) { obj.createdAt = arr[i].createdAt || now; arr[i] = obj; }
      else { obj.createdAt = now; arr.push(obj); }
    }
    save();
    return obj;
  }

  function remove(coll, id) {
    const arr = list(coll);
    const i = arr.findIndex(function (r) { return r.id === id; });
    if (i >= 0) { arr.splice(i, 1); save(); }
  }

  /* 児童を消すと、その児童に紐づく計画・アセスメント・記録もすべて消す */
  function removeChild(childId) {
    ['plans', 'splans', 'assessments', 'records'].forEach(function (coll) {
      const arr = list(coll);
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].childId === childId) arr.splice(i, 1);
      }
    });
    remove('children', childId);
  }

  /* ---- 設定 ------------------------------------------------------------ */
  function settings(patch) {
    const d = load();
    if (patch) { Object.assign(d.settings, patch); save(); }
    return d.settings;
  }

  /* ---- バックアップ ---------------------------------------------------- */
  function exportJson() {
    return JSON.stringify(load(), null, 2);
  }

  function importJson(text, mode) {
    const incoming = JSON.parse(text);
    if (!incoming || !Array.isArray(incoming.children)) {
      throw new Error('このファイルはこのアプリのバックアップではないようです。');
    }
    if (mode === 'replace') {
      db = incoming;
      Object.keys(EMPTY).forEach(function (k) {
        if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(EMPTY[k]));
      });
    } else {
      // 追加: 既存と同じ id のものは取り込まない
      const d = load();
      ['children', 'plans', 'splans', 'assessments', 'records'].forEach(function (coll) {
        const have = {};
        d[coll].forEach(function (r) { have[r.id] = true; });
        (incoming[coll] || []).forEach(function (r) { if (!have[r.id]) d[coll].push(r); });
      });
    }
    save();
  }

  function clearAll() {
    db = JSON.parse(JSON.stringify(EMPTY));
    save();
  }

  /* 保存容量の目安(バイト) */
  function usedBytes() {
    try { return new Blob([localStorage.getItem(KEY) || '']).size; } catch (e) { return 0; }
  }

  return {
    uid: uid, load: load, save: save,
    list: list, get: get, byChild: byChild, put: put, remove: remove,
    removeChild: removeChild, settings: settings,
    exportJson: exportJson, importJson: importJson, clearAll: clearAll, usedBytes: usedBytes
  };
})();
