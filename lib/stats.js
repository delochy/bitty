'use strict';

/**
 * 기다림 통계 + 마스코트 성장 (16차, 2026-09-19).
 *
 * 새로 쌓는 데이터는 activity.local.jsonl(게임·휴식 페이지에 머문 시간) 하나뿐이고,
 * 나머지는 이미 쌓이던 기록을 그대로 읽는다:
 *   - worklog.local.jsonl : 작업이 끝날 때 startedAt / workedMs (Claude·Codex)
 *   - choices.local.jsonl : 퀘스트를 고른 기록
 * 전부 로컬 파일이고 어디로도 보내지 않는다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const QUESTS = require('./quests.json');

const DATA = path.join(__dirname, '..', 'data');
const WORKLOG = path.join(DATA, 'worklog.local.jsonl');
const CHOICES = path.join(DATA, 'choices.local.jsonl');
const ACTIVITY = path.join(DATA, 'activity.local.jsonl');

const LONG_TURN_MS = 30 * 1000; // 마스코트가 뜨는 기준과 같게 "긴 작업"으로 센다

// 레벨 n에 도달하는 데 필요한 누적 경험치: 0, 20, 60, 120, 200, … (다음 레벨까지 20씩 더 필요)
const xpForLevel = (n) => 10 * (n - 1) * n;

// 레벨이 오르면 열리는 꾸미기. slot마다 하나씩 입을 수 있다.
const ITEMS = [
  { level: 1, slot: 'color', id: 'blue', label: '기본 파랑', label_en: 'Classic blue', css: 'linear-gradient(160deg,#7dd3fc,#6366f1)' },
  { level: 2, slot: 'hat', id: 'ribbon', label: '리본', label_en: 'Ribbon', emoji: '🎀' },
  { level: 3, slot: 'color', id: 'mint', label: '민트', label_en: 'Mint', css: 'linear-gradient(160deg,#a7f3d0,#10b981)' },
  { level: 4, slot: 'face', id: 'glasses', label: '안경', label_en: 'Glasses', emoji: '👓' },
  { level: 5, slot: 'hat', id: 'cap', label: '야구모자', label_en: 'Cap', emoji: '🧢' },
  { level: 6, slot: 'color', id: 'peach', label: '복숭아', label_en: 'Peach', css: 'linear-gradient(160deg,#fecaca,#fb7185)' },
  { level: 7, slot: 'face', id: 'shades', label: '선글라스', label_en: 'Sunglasses', emoji: '🕶️' },
  { level: 8, slot: 'hat', id: 'tophat', label: '실크햇', label_en: 'Top hat', emoji: '🎩' },
  { level: 9, slot: 'color', id: 'night', label: '밤하늘', label_en: 'Night sky', css: 'linear-gradient(160deg,#818cf8,#1e1b4b)' },
  { level: 10, slot: 'hat', id: 'crown', label: '왕관', label_en: 'Crown', emoji: '👑' },
  { level: 12, slot: 'color', id: 'gold', label: '황금', label_en: 'Gold', css: 'linear-gradient(160deg,#fde68a,#d97706)' },
  { level: 15, slot: 'hat', id: 'headphones', label: '헤드폰', label_en: 'Headphones', emoji: '🎧' },
];

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function appendActivity({ game, seconds }) {
  if (!/^[a-z0-9-]{1,32}$/.test(String(game || ''))) return false;
  const s = Math.max(0, Math.min(30, Number(seconds) || 0));
  if (!s) return false;
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(ACTIVITY, JSON.stringify({ at: new Date().toISOString(), game, seconds: s }) + '\n');
  return true;
}

// 끝난 작업들: { start, end, tool }
function turns() {
  return readJsonl(WORKLOG)
    .filter((r) => r.workedMs && r.startedAt && (r.state === 'DONE' || r.state === 'FAILED'))
    .map((r) => {
      const end = Date.parse(r.at);
      return { start: end - r.workedMs, end, tool: String(r.source || '').startsWith('codex') ? 'codex' : 'claude' };
    })
    .filter((t) => t.end > t.start);
}

// 겹치는 구간은 한 번만 센다 (Claude와 Codex가 동시에 돌면 기다린 시간은 그대로).
function unionMs(intervals) {
  const xs = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [s, e] of xs) {
    if (curE === null || s > curE) {
      if (curE !== null) total += curE - curS;
      curS = s; curE = e;
    } else if (e > curE) curE = e;
  }
  if (curE !== null) total += curE - curS;
  return total;
}

const questById = () => Object.values(QUESTS).flat().reduce((m, q) => ((m[q.id] = q), m), {});

function localDayBounds(day) {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return [start, start + 24 * 60 * 60 * 1000];
}

function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function mascot() {
  const allTurns = turns();
  const waitMin = unionMs(allTurns.map((t) => [t.start, t.end])) / 60000;
  const quests = readJsonl(CHOICES).filter((c) => c.questId).length;
  const playMin = readJsonl(ACTIVITY).reduce((s, a) => s + (a.seconds || 0), 0) / 60;
  const xp = Math.floor(waitMin + playMin + quests * 3);
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return {
    xp,
    level,
    levelXp: xp - xpForLevel(level),
    levelNeed: xpForLevel(level + 1) - xpForLevel(level),
    items: ITEMS.map((it) => ({ ...it, unlocked: level >= it.level })),
  };
}

// 16차: 그날 쓴 토큰 — 각 도구가 원래 남기는 대화 기록에서 사용량 숫자만 읽는다
// (대화 내용은 쓰지 않는다).
//   Claude: ~/.claude/projects/**/*.jsonl 의 assistant 메시지 usage (같은 메시지는 한 번만)
//   Codex : ~/.codex/sessions/**/*.jsonl 의 token_count 이벤트 last_token_usage
// 오래 켜둔 세션 기록은 수 GB까지 커지므로, 파일마다 어디까지 읽었는지와 날짜별 합계를
// data/token-cache.json에 기억해두고 새로 붙은 부분만 읽는다.
const TOKEN_CACHE = path.join(DATA, 'token-cache.json');
let tokenCache = null;

function loadTokenCache() {
  if (tokenCache) return tokenCache;
  try { tokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')); } catch (e) { tokenCache = {}; }
  return tokenCache;
}

function jsonlFilesSince(dir, since) {
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 5) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl') && !e.name.startsWith('._')) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= since) out.push({ file: p, size: st.size });
        } catch (err) {}
      }
    }
  };
  walk(dir, 0);
  return out;
}

// start 바이트부터 끝까지 읽으면서 marker가 들어 있는 줄만 문자열로 넘긴다.
// 마지막 줄이 아직 덜 써졌으면 그 앞까지만 읽은 것으로 치고 위치를 돌려준다.
function scanLines(file, start, marker, onLine) {
  const fd = fs.openSync(file, 'r');
  const CHUNK = 8 * 1024 * 1024;
  const mark = Buffer.from(marker);
  let pos = start, carry = Buffer.alloc(0), done = start;
  try {
    for (;;) {
      const buf = Buffer.allocUnsafe(CHUNK);
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let lineStart = 0, nl;
      while ((nl = data.indexOf(10, lineStart)) !== -1) {
        const line = data.subarray(lineStart, nl);
        if (line.indexOf(mark) !== -1) onLine(line.toString('utf8'));
        lineStart = nl + 1;
      }
      done = pos - (data.length - lineStart);
      carry = Buffer.from(data.subarray(lineStart));
    }
  } finally {
    fs.closeSync(fd);
  }
  return done;
}

function addTokens(days, at, total, output) {
  if (!(at > 0)) return;
  const k = todayKey(new Date(at));
  const d = (days[k] = days[k] || { total: 0, output: 0 });
  d.total += total;
  d.output += output;
}

function refreshTokens(from) {
  const cache = loadTokenCache();
  let changed = false;
  const sources = [
    ['claude', path.join(os.homedir(), '.claude', 'projects'), '"usage"'],
    ['codex', path.join(os.homedir(), '.codex', 'sessions'), '"token_count"'],
  ];
  for (const [tool, dir, marker] of sources) {
    for (const { file, size } of jsonlFilesSince(dir, from)) {
      let ent = cache[file];
      if (!ent || ent.pos > size) ent = cache[file] = { tool, pos: 0, days: {}, lastKey: '' };
      if (ent.pos === size) continue;
      ent.pos = scanLines(file, ent.pos, marker, (line) => {
        let r;
        try { r = JSON.parse(line); } catch (e) { return; }
        const at = Date.parse(r.timestamp);
        if (tool === 'claude') {
          const u = r.message && r.message.usage;
          if (!u) return;
          // 한 응답이 여러 줄로 나뉘어 기록되면 같은 usage가 반복된다 — 연달아 나오는 같은 메시지는 한 번만.
          const key = (r.message.id || '') + '|' + (r.requestId || '');
          if (key !== '|' && key === ent.lastKey) return;
          ent.lastKey = key;
          const out = u.output_tokens || 0;
          addTokens(ent.days, at, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + out, out);
        } else {
          const p = r.payload;
          if (!p || p.type !== 'token_count' || !p.info || !p.info.last_token_usage) return;
          const u = p.info.last_token_usage;
          addTokens(ent.days, at, u.total_tokens || 0, u.output_tokens || 0);
        }
      });
      changed = true;
    }
  }
  if (changed) {
    try { fs.writeFileSync(TOKEN_CACHE, JSON.stringify(cache)); } catch (e) {}
  }
  return cache;
}

function tokenStats(from, day) {
  const cache = refreshTokens(from);
  const res = { claude: { total: 0, output: 0 }, codex: { total: 0, output: 0 } };
  for (const ent of Object.values(cache)) {
    const d = ent.days[day];
    if (!d) continue;
    res[ent.tool].total += d.total;
    res[ent.tool].output += d.output;
  }
  return res;
}

function dayStats(day = todayKey()) {
  const [from, to] = localDayBounds(day);
  const inDay = turns()
    .map((t) => ({ ...t, start: Math.max(t.start, from), end: Math.min(t.end, to) }))
    .filter((t) => t.end > t.start);
  const long = inDay.filter((t) => t.end - t.start >= LONG_TURN_MS);
  const byId = questById();
  const games = {};
  for (const a of readJsonl(ACTIVITY)) {
    const at = Date.parse(a.at);
    if (at < from || at >= to) continue;
    games[a.game] = (games[a.game] || 0) + (a.seconds || 0);
  }
  const quests = readJsonl(CHOICES).filter((c) => {
    const at = Date.parse(c.at);
    return c.questId && at >= from && at < to;
  }).length;
  return {
    day,
    waitMs: unionMs(inDay.map((t) => [t.start, t.end])),
    longTurns: long.length,
    tools: {
      claude: long.filter((t) => t.tool === 'claude').length,
      codex: long.filter((t) => t.tool === 'codex').length,
    },
    longestMs: inDay.reduce((m, t) => Math.max(m, t.end - t.start), 0),
    games: Object.entries(games)
      .map(([id, seconds]) => ({
        id, seconds,
        label: byId[id] ? byId[id].label : id,
        label_en: byId[id] ? byId[id].label_en || byId[id].label : id,
        emoji: byId[id] ? byId[id].emoji : '🎮',
      }))
      .sort((a, b) => b.seconds - a.seconds),
    quests,
    tokens: tokenStats(from, day),
    mascot: mascot(),
  };
}

module.exports = { appendActivity, dayStats, mascot, todayKey, ITEMS };
