/*
 * .ds と config.js の項目名を機械的に突き合わせる。
 *
 *   node verify/schema-check.js <path/to/App.ds> <path/to/config.js>
 *
 * 対応表と .ds がずれると、画面は動いているのにデータが空になる、という
 * 気づきにくい壊れ方をする。手で見比べず、必ずこれを通すこと。
 */
const fs = require('fs');

const dsPath = process.argv[2];
const cfgPath = process.argv[3];
if (!dsPath || !cfgPath) {
  console.error('使い方: node verify/schema-check.js <App.ds> <config.js>');
  process.exit(2);
}

eval(fs.readFileSync(cfgPath, 'utf8'));
const ds = fs.readFileSync(dsPath, 'utf8');

/* .ds の forms ブロックから、フォームごとのフィールド名を拾う */
const formsBlock = ds.slice(ds.indexOf('\tforms\n\t{'), ds.indexOf('\treports\n\t{'));
const dsForms = {};
let cur = null;
formsBlock.split('\n').forEach(line => {
  let m = line.match(/^\t\tform (\w+)/);
  if (m) { cur = m[1]; dsForms[cur] = new Set(); return; }
  m = line.match(/^\t\t\t(\w+)$/);
  if (m && cur && m[1] !== 'Section' && m[1] !== 'actions') dsForms[cur].add(m[1]);
});

const reportsBlock = ds.slice(ds.indexOf('\treports\n\t{'), ds.indexOf('\tpages\n\t{'));

let bad = 0, total = 0;
Object.keys(CFG.FIELD_MAP).forEach(entity => {
  const form = CFG.FORMS[entity];
  const fields = dsForms[form];
  if (!fields) { console.log('✗ .ds に form がありません:', entity, '→', form); bad++; return; }
  const map = CFG.FIELD_MAP[entity];
  const missing = Object.values(map).filter(f => !fields.has(f));
  total += Object.keys(map).length;
  if (missing.length) {
    console.log('✗', entity, '(' + form + ') .ds に無い項目:', missing.join(', '));
    bad += missing.length;
  } else {
    console.log('✓', entity.padEnd(14), form.padEnd(22), Object.keys(map).length + '項目 一致');
  }
});

Object.keys(CFG.REPORTS).forEach(entity => {
  const r = CFG.REPORTS[entity];
  if (!new RegExp('list ' + r + '\\b').test(reportsBlock)) {
    console.log('✗ .ds に report がありません:', r);
    bad++;
  }
});

console.log('\n照合', total, '項目 / 不一致', bad);
process.exit(bad ? 1 : 0);
