#!/usr/bin/env node
'use strict';
/**
 * 번역 빠진 곳 찾기 (19차)
 *
 * 화면 코드의 T('한국어') 와 data-i18n 자리를 전부 훑어서, mcp/locales/<언어>.json 에
 * 그 키가 있는지 본다. 빠진 게 있으면 목록으로 보여주고 1번으로 끝난다 — 언어를 새로
 * 넣을 때 뭘 더 번역해야 하는지 이걸로 확인하면 된다.
 *
 *   node setup/check-i18n.js          # 모든 언어
 *   node setup/check-i18n.js en       # 한 언어만
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'mcp/games');
const LOCALES = path.join(ROOT, 'mcp/locales');

const files = fs
  .readdirSync(GAMES)
  .filter((f) => f.endsWith('.html'))
  .map((f) => path.join('mcp/games', f))
  .concat(['mcp/quest-http.js']);

// 코드에서 쓰는 키 모으기
const keys = new Map(); // 키 → 처음 본 자리
const T_RE = /\bT\((['"])((?:(?!\1)[^\\]|\\.)*?)\1\s*[,)]/g;
const TAG_RE = /data-i18n(?:-placeholder|-title)?[^<>]*?>([^<>]*)</g;
const ATTR_RE = /(?:placeholder|title)="([^"$]*)"[^<>]*?data-i18n-(?:placeholder|title)|data-i18n-(?:placeholder|title)[^<>]*?(?:placeholder|title)="([^"$]*)"/g;

for (const rel of files) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const note = (k, line) => {
    k = k.replace(/\\(['"])/g, '$1');
    // 값이 끼는 자리는 통째로 키가 아니고, ✕ ▲ 같은 기호는 번역할 게 없다
    if (!k.trim() || k.includes('${') || !/[가-힣a-zA-Z]/.test(k)) return;
    if (!keys.has(k)) keys.set(k, `${rel}:${line}`);
  };
  const lineOf = (i) => s.slice(0, i).split('\n').length;
  let m;
  T_RE.lastIndex = 0;
  while ((m = T_RE.exec(s))) note(m[2], lineOf(m.index));
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) note(m[1].trim(), lineOf(m.index));
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(s))) note((m[1] || m[2] || '').trim(), lineOf(m.index));
}

// 서버가 값으로 넘기는 이름들 (퀘스트·마스코트 아이템)도 번역 대상이다
for (const list of Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/quests.json'), 'utf8')))) {
  for (const q of Array.isArray(list) ? list : []) if (q.label) keys.set(q.label, 'lib/quests.json');
}
const statsSrc = fs.readFileSync(path.join(ROOT, 'lib/stats.js'), 'utf8');
for (const m of statsSrc.matchAll(/label: '([^']+)'/g)) keys.set(m[1], 'lib/stats.js');
const estSrc = fs.readFileSync(path.join(ROOT, 'lib/estimate.js'), 'utf8');
for (const m of estSrc.matchAll(/return '([^']+)';|: '([^']+)',/g)) {
  const k = m[1] || m[2];
  if (/[가-힣]/.test(k)) keys.set(k, 'lib/estimate.js');
}

const only = process.argv[2];
const codes = fs
  .readdirSync(LOCALES)
  .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  .map((f) => f.slice(0, -5))
  .filter((c) => !only || c === only);

if (!codes.length) {
  console.error(only ? `mcp/locales/${only}.json 이 없어요.` : 'mcp/locales 에 번역 파일이 없어요.');
  process.exit(1);
}

let bad = 0;
for (const code of codes) {
  const dict = JSON.parse(fs.readFileSync(path.join(LOCALES, code + '.json'), 'utf8'));
  const missing = [...keys].filter(([k]) => !(k in dict));
  const unused = Object.keys(dict).filter((k) => !keys.has(k));
  console.log(`\n[${code}] 쓰는 문구 ${keys.size}개 · 번역 ${Object.keys(dict).length}개`);
  if (missing.length) {
    bad = 1;
    console.log(`  빠진 번역 ${missing.length}개:`);
    for (const [k, where] of missing) console.log(`    ${JSON.stringify(k)}  (${where})`);
  } else {
    console.log('  빠진 번역 없음 ✓');
  }
  if (unused.length) console.log(`  안 쓰는 번역 ${unused.length}개: ${unused.slice(0, 8).map((k) => JSON.stringify(k)).join(', ')}${unused.length > 8 ? ' …' : ''}`);
}
process.exit(bad);
