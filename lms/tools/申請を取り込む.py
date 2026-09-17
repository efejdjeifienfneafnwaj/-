#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
社内申請システム（shinsei/）を、統合ウィジェット（lms-widget/）に取り込む。

・shinsei/app/js/*.js  → lms-widget/app/js/shinsei/*.js   （最小限の差し替えを入れる）
・shinsei/app/css/style.css → lms-widget/app/css/shinsei.css（#shinsei の中だけに効くようにする）

先方からもらった shinsei/ は手で触らない。直したいときはこのスクリプトを直して
もう一度流す。差し替え箇所には ★統合 の印を付けてある。
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shinsei', 'app')
DST = os.path.join(ROOT, 'lms-widget', 'app')

def read(p): return io.open(p, encoding='utf-8').read()
def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    io.open(p, 'w', encoding='utf-8').write(s)

def sub(s, old, new, n=1, where=''):
    c = s.count(old)
    if c != n:
        raise SystemExit('差し替え箇所が %d か所（%d を想定）: %s\n%s' % (c, n, where, old[:80]))
    return s.replace(old, new)

# ────────────────────────────────────────────────────────────
# app.js : 自動起動をやめ、統合側から mount() で起動する
# ────────────────────────────────────────────────────────────
def patch_app(s):
    s = sub(s, """document.addEventListener('DOMContentLoaded', function () {
  App.initChrome();
  App.boot();
});""", """/* ★統合：自動起動はしない。統合側（widget.html）が App.mount() で起動する */""", where='app.js autoboot')

    s = sub(s, """  function boot() {
    initTheme();
    Access.loadPending();          // 前回送り切れなかった証跡を引き継ぐ
    document.getElementById('view').innerHTML = UI.skeleton(7);
    DB.init().then(function (res) {""",
"""  /* ★統合：統合側の枠の中で動くための印
       active  … いま社内申請の画面が表に出ているか（キー操作や hash の監視を止めるため）
       mounted … 一度起動したか（二重起動しない） */
  var active = false, mounted = false;
  function setActive(v) { active = !!v; }
  function isActive() { return active; }
  function mount() {
    if (mounted) return Promise.resolve();
    mounted = true;
    initChrome();
    return boot();
  }
  /* 承認待ちの件数（統合側の左メニューにも出す） */
  function pendingCount() {
    var pending = 0;
    state.requests.forEach(function (r) {
      if (r.Status !== CFG.STATUS.ACTIVE) return;
      var rt; try { rt = JSON.parse(r.Route_JSON || '[]'); } catch (e) { rt = []; }
      var cur = WF.currentStep(rt);
      var st = rt.filter(function (s) { return s.step_no === cur; })[0];
      if (st && WF.canAct(st, me().ID) && !st.action) pending++;
    });
    return pending;
  }
  function boot() {
    /* ★統合：テーマは統合側が持つので、ここでは触らない */
    Access.loadPending();          // 前回送り切れなかった証跡を引き継ぐ
    document.getElementById('view').innerHTML = UI.skeleton(7);
    return DB.init().then(function (res) {""", where='app.js boot')

    s = sub(s, """    window.addEventListener('hashchange', function () {
      /* ブラウザバックや画面遷移で開いたままのドロワーを閉じる。
         閉じ処理を通さないと閲覧終了（滞在時間）が記録されない。 */
      UI.closeDrawer();
      render();
    });""",
"""    window.addEventListener('hashchange', function () {
      if (!active) return;          /* ★統合：他のアプリを見ているあいだは動かさない */
      /* ブラウザバックや画面遷移で開いたままのドロワーを閉じる。
         閉じ処理を通さないと閲覧終了（滞在時間）が記録されない。 */
      UI.closeDrawer();
      render();
    });""", where='app.js hashchange')

    s = sub(s, """    document.addEventListener('keydown', function (e) {
      if (/input|textarea|select/i.test((e.target.tagName || ''))) {""",
"""    document.addEventListener('keydown', function (e) {
      if (!active) return;          /* ★統合：e-ラーニングの画面で n や a を押しても反応させない */
      if (/input|textarea|select/i.test((e.target.tagName || ''))) {""", where='app.js keys')

    # 描き終わったら統合側に知らせる（左メニューの光る場所・パンくずを合わせる）
    s = sub(s, """    renderNav();
    /* 社員マスタを編集したあとも一覧が古いままにならないよう、描画のたびに作り直す */
    renderUserSwitch();
    el.focus();
  }""",
"""    renderNav();
    /* 社員マスタを編集したあとも一覧が古いままにならないよう、描画のたびに作り直す */
    renderUserSwitch();
    el.focus();
    if (typeof window.SHINSEI_ON_RENDER === 'function') window.SHINSEI_ON_RENDER(route.name);   /* ★統合 */
  }""", where='app.js render tail')

    s = sub(s, """  return {
    boot: boot, initChrome: initChrome, go: go, param: param, refresh: refresh, render: render,""",
"""  return {
    mount: mount, setActive: setActive, isActive: isActive, pendingCount: pendingCount,   /* ★統合 */
    boot: boot, initChrome: initChrome, go: go, param: param, refresh: refresh, render: render,""", where='app.js exports')
    return s

# ────────────────────────────────────────────────────────────
# data.js : SDK の判定、更新メソッド名、社員・部署を統合側の名簿から読む
# ────────────────────────────────────────────────────────────
def patch_data(s):
    s = sub(s, """  function init() {
    return new Promise(function (resolve) {
      var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
      if (!hasSDK) { startDemo('SDK未検出'); return resolve({ connected: false, kind: 'demo' }); }""",
"""  /* ★統合：ログイン情報は統合側がすでに持っている。
     SDK の getInitParams は版によって Promise を返し、同期では取れないため */
  function bridgeParams() {
    return (typeof window !== 'undefined' && window.SHINSEI_BRIDGE) ? window.SHINSEI_BRIDGE.initParams() : null;
  }
  function init() {
    return new Promise(function (resolve) {
      /* ★統合：DATA があれば接続済みとみなす。init() が無い版の SDK もある */
      var hasData = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && ZOHO.CREATOR.DATA);
      if (hasData && typeof ZOHO.CREATOR.init !== 'function') {
        connected = true; sdkKind = 'data';
        initParams = bridgeParams() || {};
        return resolve({ connected: true, kind: sdkKind });
      }
      var hasSDK = (typeof ZOHO !== 'undefined' && ZOHO.CREATOR && typeof ZOHO.CREATOR.init === 'function');
      if (!hasSDK) { startDemo('SDK未検出'); return resolve({ connected: false, kind: 'demo' }); }""", where='data.js init')

    s = sub(s, """          try { initParams = (ZOHO.CREATOR.UTIL && ZOHO.CREATOR.UTIL.getInitParams) ? (ZOHO.CREATOR.UTIL.getInitParams() || {}) : {}; } catch (e) { initParams = {}; }""",
"""          initParams = bridgeParams() || {};   /* ★統合 */""", where='data.js initParams')

    s = sub(s, """  function sdkUpdate(reportName, id, data) {
    return ZOHO.CREATOR.DATA.updateRecord({ report_name: reportName, id: String(id), payload: { data: data } });
  }""",
"""  function sdkUpdate(reportName, id, data) {
    /* ★統合：実際に使えるのは updateRecordById（updateRecord は無い版がある） */
    var d = ZOHO.CREATOR.DATA;
    var fn = d.updateRecordById || d.updateRecord;
    return fn.call(d, { report_name: reportName, id: String(id), payload: { data: data } });
  }""", where='data.js sdkUpdate')

    s = sub(s, """  function list(entity, criteria) {
    if (sdkKind === 'demo') {""",
"""  /* ★統合：社員と部署は、統合側の名簿と職種をそのまま使う（名簿を2つ持たない） */
  function bridged(entity) {
    var b = (typeof window !== 'undefined') && window.SHINSEI_BRIDGE;
    if (!b) return null;
    if (entity === 'Employees' || entity === 'Departments') return b;
    return null;
  }
  function list(entity, criteria) {
    var b = bridged(entity);
    if (b) return Promise.resolve(b.list(entity));
    if (sdkKind === 'demo') {""", where='data.js list')

    s = sub(s, """  function add(entity, obj) {
    if (sdkKind === 'demo') {""",
"""  function add(entity, obj) {
    var b = bridged(entity);
    if (b) return Promise.resolve(b.add(entity, obj));
    if (sdkKind === 'demo') {""", where='data.js add')

    s = sub(s, """  function update(entity, id, patch) {
    if (sdkKind === 'demo') {""",
"""  function update(entity, id, patch) {
    var b = bridged(entity);
    if (b) return Promise.resolve(b.update(entity, id, patch));
    if (sdkKind === 'demo') {""", where='data.js update')

    s = sub(s, """    initParams: function () { return initParams; },""",
"""    initParams: function () { return bridgeParams() || initParams; },   /* ★統合 */""", where='data.js initParams export')
    return s

# ────────────────────────────────────────────────────────────
# CSS : #shinsei の中だけに効かせる
# ────────────────────────────────────────────────────────────
def scope_selector(sel):
    sel = sel.strip()
    if not sel: return sel
    out = []
    for part in sel.split(','):
        p = part.strip()
        if not p: continue
        if p == ':root': out.append('#shinsei'); continue
        if p == '[data-theme="dark"]': out.append('#shinsei[data-theme="dark"]'); continue
        if p == '*': out.append('#shinsei *'); continue
        if p in ('html', 'html,body', 'body'): out.append('#shinsei'); continue
        if p.startswith('body '): out.append('#shinsei ' + p[5:]); continue
        if p.startswith('body.'): out.append('#shinsei' + p[4:]); continue
        out.append('#shinsei ' + p)
    return ', '.join(out)

def scope_css(css):
    # コメントを落とす
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    i, n, out = 0, len(css), []
    def block_end(start):
        depth = 0
        for k in range(start, n):
            if css[k] == '{': depth += 1
            elif css[k] == '}':
                depth -= 1
                if depth == 0: return k
        return n - 1
    while i < n:
        j = css.find('{', i)
        if j < 0: break
        head = css[i:j].strip()
        end = block_end(j)
        body = css[j+1:end]
        if head.startswith('@'):
            if head.startswith('@keyframes') or head.startswith('@font-face') or head.startswith('@page'):
                out.append(head + '{' + body + '}')
            elif head.startswith('@media print'):
                # 印刷は統合側で別途扱う。ここでは中身だけ範囲を付けて残す
                out.append(head + '{' + scope_css(body) + '}')
            else:
                out.append(head + '{' + scope_css(body) + '}')
        else:
            if head in ('html,body', 'html, body'):
                pass                                  # 高さ100%はいらない
            elif head == '*':
                pass                                  # 全要素のリセットは統合側に効かせない
            else:
                out.append(scope_selector(head) + '{' + body.strip() + '}')
        i = end + 1
    return '\n'.join(out)

# ────────────────────────────────────────────────────────────
# views.js / masters.js : 社員・部署のタブは統合の「職員登録」に一本化する
# ────────────────────────────────────────────────────────────
def patch_views(s):
    s = sub(s, """    var tab = App.param('tab') || 'Employees';""",
"""    /* ★統合：社員・部署は統合側の「職員登録」で扱う（登録する場所を1つにする） */
    var bridged = (typeof window !== 'undefined') && window.SHINSEI_BRIDGE;
    var tab = App.param('tab') || (bridged ? 'Vendors' : 'Employees');
    if (bridged && (tab === 'Employees' || tab === 'Departments')) { window.SHINSEI_BRIDGE.openStaff(); return; }""", where='views.js admin tab')
    s = sub(s, """      Object.keys(Masters.DEFS).map(function (k) {""",
"""      Object.keys(Masters.DEFS).filter(function (k) { return !(bridged && (k === 'Employees' || k === 'Departments')); }).map(function (k) {""", where='views.js admin tabs')
    return s

def patch_masters(s):
    s = sub(s, """    var key = which || 'Employees';
    var def = DEFS[key];""",
"""    /* ★統合：社員・部署は統合側の「職員登録」で扱う */
    var bridged = (typeof window !== 'undefined') && window.SHINSEI_BRIDGE;
    var key = which || (bridged ? 'Vendors' : 'Employees');
    if (bridged && (key === 'Employees' || key === 'Departments')) { window.SHINSEI_BRIDGE.openStaff(); return; }
    var def = DEFS[key];""", where='masters.js render')
    s = sub(s, """      Object.keys(DEFS).map(function (k) {""",
"""      Object.keys(DEFS).filter(function (k) { return !(bridged && (k === 'Employees' || k === 'Departments')); }).map(function (k) {""", where='masters.js tabs')
    return s

def main():
    # JS
    files = ['config', 'data', 'routes', 'workflow', 'ui', 'views', 'editor', 'masters', 'setup', 'app']
    for f in files:
        s = read(os.path.join(SRC, 'js', f + '.js'))
        if f == 'app': s = patch_app(s)
        if f == 'data': s = patch_data(s)
        if f == 'views': s = patch_views(s)
        if f == 'masters': s = patch_masters(s)
        write(os.path.join(DST, 'js', 'shinsei', f + '.js'), s)
    # CSS
    css = read(os.path.join(SRC, 'css', 'style.css'))
    scoped = scope_css(css)
    head = ('/* 社内申請システムの見た目。tools/申請を取り込む.py が shinsei/app/css/style.css から作る。\n'
            '   手で直さない。#shinsei の中だけに効く。 */\n')
    write(os.path.join(DST, 'css', 'shinsei.css'), head + scoped + '\n')
    print('ok: js %d files, css %d chars' % (len(files), len(scoped)))

if __name__ == '__main__':
    main()
