'use strict';

/**
 * Local quest-picker page at http://127.0.0.1:4317/quest — what the
 * auto-popup sidebar widget (lib/sidebar.js) points at. Since 5차
 * (2026-09-18, "마스코트 같은걸로") this is drawn as a small CSS mascot
 * character in a speech-bubble layout instead of a plain form — the widget
 * window itself is sized small (300x360, see lib/sidebar.js) to read more
 * like a desktop pet than a full sidebar pane. A real transparent/
 * chromeless floating mascot isn't possible with a Safari window (no native
 * app shell in this environment — see architecture-research.md 5차); this
 * is the mascot look achievable inside an ordinary browser window.
 *
 * Landing view is the time-budget question (5/10/20분/끝날때까지) — a
 * click here does the same thing typing "10분" in the agent chat does, same
 * pickQuests()/recordTimeBudget() underneath (see lib/timebudget.js,
 * lib/state.js).
 *
 * Claude Code and Codex each spawn their own copy of the MCP server, so more
 * than one process may call start() concurrently. That's fine — whichever
 * one wins the port serves the page for everyone, since state lives in the
 * shared data/state.json file either way. Losing the bind is silently
 * ignored (EADDRINUSE), not an error.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const state = require('../lib/state');
const { pickQuests, pickQuestsFromBuckets } = require('../lib/timebudget');
const { LEVEL_BUCKETS, effectiveLevel, headlineFor } = require('../lib/estimate');
const stats = require('../lib/stats');

const PORT = process.env.SIDE_QUEST_PORT ? Number(process.env.SIDE_QUEST_PORT) : 4317;
const HOST = '127.0.0.1';

// 19차: 위젯 앱 번들에는 한국어 로컬라이즈가 들어있지 않아서, 맥이 한국어로 설정돼
// 있어도 웹뷰의 navigator.language가 늘 en-US로 나온다 (그래서 한국어 사용자한테도
// 영어로 떴다). 데몬이 맥 시스템 언어를 직접 읽어서 i18n.js 앞에 붙여준다.
let sysLang = null;
function systemLang() {
  if (sysLang) return sysLang;
  sysLang = 'en';
  let first = '';
  try {
    first = (require('child_process')
      .execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8' })
      .match(/"([^"]+)"/) || [])[1] || '';
  } catch (e) {
    first = process.env.LANG || '';
  }
  const base = first.replace('_', '-').split('-')[0].toLowerCase();
  if (base && localeCodes().indexOf(base) >= 0) sysLang = base;
  return sysLang;
}

// 19차: 번역은 mcp/locales/<언어>.json 한 장씩이고, 한국어 원문이 곧 키다.
// 언어를 늘리려면 이 폴더에 파일 하나만 더 놓으면 된다 (mcp/games/i18n.js 설명 참고).
// 화면 코드가 동기적으로 T()를 쓰기 때문에, 사전은 i18n.js 앞에 통째로 붙여 보낸다.
const LOCALE_DIR = path.join(__dirname, 'locales');
function localeCodes() {
  try {
    return ['ko'].concat(
      // macOS가 외장 디스크에 만드는 ._ 메타 파일은 건너뛴다 (언어로 오해하면 안 된다)
      fs.readdirSync(LOCALE_DIR)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => f.slice(0, -5))
    );
  } catch (e) {
    return ['ko'];
  }
}
function localeDicts() {
  const out = {};
  for (const code of localeCodes()) {
    if (code === 'ko') continue; // 한국어는 원문 자체라 사전이 없다
    try {
      out[code] = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, code + '.json'), 'utf8'));
    } catch (e) {}
  }
  return out;
}

function pageShell(bodyHtml) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Idle Buddy</title>
<script src="/games/i18n.js"></script>
<script src="/games/drag.js"></script>
<style>
  /* 14차: 창이 투명이라 뒤 화면에 따라 글자가 묻혔다(특히 라이트 모드). 이제 불투명 카드
     위에 그리고, 라이트/다크 색을 따로 잡는다. */
  :root {
    color-scheme: normal; /* 14차: light dark로 두면 WebKit이 창 바탕을 불투명하게 칠해서 투명 창이 네모로 보였다 */
    --card: #ffffff; --ink: #1f2937; --muted: #6b7280; --line: rgba(15,23,42,0.14);
    --soft: #f3f4f6; --soft-2: #e5e7eb; --accent: #6366f1; --focus-bg: #eef2ff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --card: #1c1f26; --ink: #e5e7eb; --muted: #9ca3af; --line: rgba(255,255,255,0.14);
      --soft: #262a33; --soft-2: #323744; --accent: #818cf8; --focus-bg: rgba(129,140,248,0.16);
    }
  }
  * { box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    margin: 0; padding: 0; overflow-x: hidden;
    /* 8차: 네이티브 위젯(native-widget/, Tauri transparent 창)이 이 페이지를
       그대로 불러온다 — 배경을 투명하게 해야 브라우저 틀 없이 마스코트만
       둥실 떠 보인다. Safari 창(5·6차)으로 볼 때는 그냥 평범한 배경처럼
       보이니 문제 없음. */
    background: transparent;
  }
  /* 14차: 카드는 body가 아니라 .panel에 그린다 — html 배경이 투명이면 CSS 규칙상 body
     배경이 화면 전체로 번져서, 둥근 카드 뒤에 네모 틀이 생겼다. */
  body { margin: 0; }
  .panel {
    margin: 6px; padding: 12px 12px; min-height: calc(100vh - 12px); border-radius: 16px;
    background: var(--card); color: var(--ink); border: 1px solid var(--line);
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    animation: appear 0.35s ease-out 1;
  }
  @keyframes appear { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  /* 10차: 메뉴바 아이콘을 없애서, 창을 닫는 건 이 버튼뿐이다 (native-widget이 /__close 이동을 가로채 창을 숨김). */
  .close {
    position: fixed; top: 14px; right: 14px; width: 22px; height: 22px; line-height: 22px; text-align: center;
    border-radius: 50%; font-size: 12px; color: var(--muted); text-decoration: none; background: var(--soft);
  }
  .close:hover { background: var(--soft-2); }
  /* 17차: 한국어 / English 전환 */
  .lang {
    position: fixed; top: 14px; left: 14px; width: 22px; height: 22px; border-radius: 50%; border: none;
    font-size: 12px; background: var(--soft); cursor: pointer; padding: 0;
  }

  /* --- 마스코트 --- */
  .mascot-wrap { display: flex; flex-direction: column; align-items: center; margin-bottom: 8px; }
  .mascot {
    width: 56px; height: 56px; font-size: 56px; /* 16차: 꾸미기 소품 크기 기준(em) */ border-radius: 40% 40% 45% 45%;
    background: linear-gradient(160deg, #7dd3fc, #6366f1);
    /* 10차: 계속 뛰는 애니메이션은 정신없다는 피드백으로 뺐다. 퀘스트를
       고를 때만 한 번 톡 튄다(.hop). */
    position: relative;
    box-shadow: 0 4px 10px rgba(99,102,241,0.25);
  }
  .mascot.state-done { background: linear-gradient(160deg, #86efac, #16a34a); }
  .mascot.state-needs-input { background: linear-gradient(160deg, #fde68a, #f59e0b); }
  .mascot.hop { animation: hop 0.45s ease-out 1; }
  .mascot { cursor: pointer; }
  /* 쓰다듬으면 눈이 ^^ 모양으로 웃고 볼이 발그레해진다. */
  .mascot.happy::before, .mascot.happy::after { height: 4px; top: 24px; border-radius: 4px 4px 0 0; }
  .mascot.happy { box-shadow: 0 4px 10px rgba(99,102,241,0.25), inset 10px -8px 0 -6px rgba(244,114,182,0.6), inset -10px -8px 0 -6px rgba(244,114,182,0.6); }
  .mascot::before, .mascot::after {
    content: ""; position: absolute; top: 22px; width: 8px; height: 8px;
    background: #111; border-radius: 50%;
  }
  .mascot::before { left: 15px; }
  .mascot::after { right: 15px; }
  .mascot.state-done::before, .mascot.state-done::after { height: 4px; top: 24px; border-radius: 2px; }
  @keyframes hop { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-8px) scale(1.04); } }

  .bubble {
    /* 14차: 카드 안에 상자를 또 두지 않는다 — 말풍선은 글자만. */
    text-align: center; margin-top: 8px; max-width: 260px; padding: 0 8px;
  }
  /* 14차: 어떤 도구가 작업 중인지 (Claude / Codex) */
  .who { display: flex; justify-content: center; gap: 4px; margin-bottom: 4px; min-height: 0; }
  .who span { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; color: #fff; }
  .who .claude { background: #c96442; }
  .who .codex { background: #111827; }
  @media (prefers-color-scheme: dark) { .who .codex { background: #e5e7eb; color: #111827; } }
  /* 14차: 하던 게임·장보기 이어서 하기 */
  .resume {
    display: inline-block; margin-top: 6px; padding: 5px 12px; border-radius: 999px; background: #6366f1;
    color: #fff; font-size: 12px; font-weight: 700; text-decoration: none;
  }
  h1 { font-size: 14px; margin: 0 0 2px; line-height: 1.35; word-break: keep-all; }
  p.sub { color: var(--muted); font-size: 11px; margin: 4px 0 0; line-height: 1.4; word-break: keep-all; }

  .budget { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .budget a {
    flex: 1 1 40%; text-align: center; padding: 10px 6px; border-radius: 10px;
    border: 1px solid #ccc; text-decoration: none; color: inherit; font-size: 13px; font-weight: 600;
  }
  .budget a:hover { background: rgba(0,0,0,0.06); }
  .quest {
    display: flex; align-items: center; gap: 8px; width: 100%; height: 40px; text-align: left;
    padding: 0 12px; border-radius: 10px; border: none;
    background: transparent; color: var(--ink); font-size: 13px; cursor: pointer; font-family: inherit;
    transition: transform 0.12s, background 0.12s; flex-shrink: 0;
  }
  .quest span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .quest:hover { background: var(--soft); }
  .quest:active { transform: scale(0.97); }
  .quest .go { margin-left: auto; font-size: 11px; color: var(--muted); flex-shrink: 0; }

  /* 11차: 자동으로 굴러가는 룰렛형 세로 캐러셀. 창이 뜨면 빠르게 돌다가 감속해 멈추고,
     그 뒤로는 몇 초마다 살짝 튕기듯 한 칸씩 넘어간다. 가운데 칸이 "지금 추천". 끝없이
     돌 수 있게 목록을 3벌 그려두고(renderCarousel), 가운데 벌 안에서만 위치를 유지한다. */
  .carousel { display: flex; gap: 6px; align-items: stretch; }
  /* 12차: 카테고리 탭 */
  .cats { display: flex; gap: 3px; margin: 0 0 8px; overflow-x: auto; scrollbar-width: none; }
  /* 17차: 넘치지 않으면 가운데, 넘치면(영어) 왼쪽부터 스크롤 — justify-content: center는 양쪽이 잘린다 */
  .cats > :first-child { margin-left: auto; }
  .cats > :last-child { margin-right: auto; }
  .cats::-webkit-scrollbar { display: none; }
  .cats button {
    flex-shrink: 0; border: 1px solid var(--line); background: var(--card); color: var(--ink);
    border-radius: 999px; padding: 3px 7px; font-size: 11px; cursor: pointer; font-family: inherit;
  }
  .cats button.on { background: #6366f1; border-color: #6366f1; color: #fff; }
  .cats button:not(.on):hover { background: var(--soft); }
  #quests {
    flex: 1; height: 132px; overflow: hidden; position: relative;
    -webkit-mask-image: linear-gradient(transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
            mask-image: linear-gradient(transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
  }
  .track { display: flex; flex-direction: column; gap: 6px; will-change: transform; }
  .track .quest { opacity: 0.5; transform: scale(0.94); transition: opacity 0.25s, transform 0.25s, border-color 0.25s, background 0.25s; }
  .track .quest.focus {
    opacity: 1; transform: scale(1); background: var(--focus-bg); color: var(--ink); font-weight: 600;
  }
  .track .quest.focus:active { transform: scale(0.97); }
  .rail { width: 22px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
  .rail button {
    width: 22px; height: 22px; border-radius: 50%; border: none; background: var(--soft);
    color: var(--ink); font-size: 9px; cursor: pointer; padding: 0;
  }
  .rail .count { font-size: 10px; color: var(--muted); writing-mode: horizontal-tb; }

  /* 21차: 기본 화면 — 지금 작업이 태우는 토큰. 캐러셀 자리(132px)를 그대로 쓰고,
     칸으로 감싸지 않고 글자 크기와 간격으로만 위계를 준다. */
  #burn { height: 132px; display: flex; flex-direction: column; }
  #burn .num {
    display: flex; align-items: baseline; justify-content: center; gap: 6px;
    font-size: 26px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.1; font-variant-numeric: tabular-nums;
  }
  #burn .flame { font-size: 18px; display: inline-block; transform-origin: 50% 90%; opacity: 0.3; filter: grayscale(0.6); transition: opacity 0.4s, filter 0.4s; }
  #burn.hot .flame { opacity: 1; filter: none; animation: flicker var(--flick, 0.9s) ease-in-out infinite alternate; }
  @keyframes flicker { from { transform: scale(0.9) rotate(-4deg); } to { transform: scale(1.14) rotate(4deg); } }
  #burn .label { text-align: center; font-size: 11px; color: var(--muted); margin-top: 3px; }
  #burn .chart { flex: 1; position: relative; margin-top: 10px; min-height: 0; }
  #burn svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  #burn .idle { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; font-size: 11px; color: var(--muted); word-break: keep-all; padding: 0 12px; }
  #burn.resting svg { display: none; }
  #burn.resting .idle { display: flex; }
  #burn .meta { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
  #burn .dot { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { #burn.hot .flame, #burn .dot { animation: none; } }

  /* 퀘스트를 고르면 보이는 화면 */
  #picked { display: none; text-align: center; }
  #picked .card {
    display: flex; align-items: center; justify-content: center; gap: 8px; height: 48px; border-radius: 12px;
    background: rgba(22,163,74,0.14); border: 1px solid rgba(22,163,74,0.5); font-size: 14px; font-weight: 600;
    animation: pop 0.3s ease-out 1;
  }
  #picked .again { margin-top: 10px; background: none; border: none; color: var(--muted); font-size: 11px; cursor: pointer; font-family: inherit; }
  @keyframes pop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
  .emoji { font-size: 17px; }
  .back { display: inline-block; margin-top: 4px; font-size: 11px; color: #888; text-decoration: none; }
</style>
</head>
<body>
<div class="panel" data-tauri-drag-region>
  <a class="close" href="/__close" title="닫기" data-i18n-title>✕</a>
  <button class="lang" id="lang" title="Language">🌐</button>
${bodyHtml}
</div>
<script src="/games/mascot-look.js"></script>
<script>
  // 8차 이어서: 네이티브 위젯은 Claude Code CLI 없이 수동으로 켜지기 때문에,
  // data/state.json엔 며칠 전 실측 테스트 때 남은 DONE 세션들이 그대로 남아있을
  // 수 있다. "최근에(30분 이내) 갱신된 세션"만 보게 해서, 오래된 기록 때문에
  // 위젯을 열자마자 "돌아갈 시간이에요" 배너가 잘못 뜨는 걸 막는다.
  const RELEVANT_MS = 30 * 60 * 1000;
  async function poll() {
    try {
      const res = await fetch('/state');
      const data = await res.json();
      const now = Date.now();
      const sessions = Object.values(data.sessions || {}).filter(
        (s) => now - (s.updatedAt || 0) < RELEVANT_MS
      );
      const mascotEl = document.querySelector('.mascot');
      // 10차: 다른 세션이 끝났어도, 아직 작업 중인 세션이 있으면 배너를 안 띄운다.
      const anyWorking = sessions.some((s) => s.state === 'WORKING');
      const anyDone = sessions.some((s) => s.state === 'DONE' || s.state === 'NEEDS_INPUT');
      const finished = anyDone && !anyWorking;
      // 10차: "작업 끝났어요" 배너는 뺐다 — 끝난 건 삐빅 소리와 마스코트 색으로만 알린다.
      // 14차: 지금 작업 중인 도구(Claude / Codex)를 말풍선 위에 표시.
      const who = document.getElementById('who');
      if (who) {
        // 15차: 도구별로 몇 개가 돌고 있는지도 — 하나면 "작업 중", 여럿이면 "작업 N개".
        const counts = {};
        Object.values(data.sessions || {}).forEach((x) => {
          const codex = String(x.source || '').startsWith('codex');
          // Codex는 턴 사이 Stop 뒤 잠깐(20초)은 아직 작업 중으로 센다 (위젯 앱과 같은 기준)
          const between = codex && x.state === 'DONE' && now - (x.updatedAt || 0) < 20 * 1000;
          if ((x.state === 'WORKING' || between) && now - (x.startedAt || x.updatedAt || 0) < 2 * 60 * 60 * 1000) {
            const t = codex ? 'codex' : 'claude';
            counts[t] = (counts[t] || 0) + 1;
          }
        });
        who.innerHTML = Object.keys(counts).sort()
          .map((t) => '<span class="' + t + '">' + (t === 'codex' ? 'Codex' : 'Claude') +
            (counts[t] > 1 ? T(' 작업 {n}개', { n: counts[t] }) : T(' 작업 중')) + '</span>')
          .join('');
      }
      if (mascotEl) {
        mascotEl.classList.remove('state-needs-input', 'state-done');
        if (finished) {
          mascotEl.classList.add(sessions.some((s) => s.state === 'NEEDS_INPUT') ? 'state-needs-input' : 'state-done');
        }
      }
    } catch (e) {}
  }
  setInterval(poll, 3000);
  poll();

  // 9차: 예상 단계가 바뀌면(Claude의 예상이 늦게 들어왔거나, 생각보다 길어졌으면)
  // 그 단계에 맞게 추천을 새로 뿌린다. 이미 퀘스트를 하나 골랐으면 건드리지 않는다.
  let questChosen = false;
  async function pollLevel() {
    const list = document.getElementById('quests');
    if (!list || questChosen || !('level' in list.dataset)) return;
    try {
      const info = await (await fetch('/quest/level')).json();
      const level = info.level || '';
      const escalated = info.escalated ? '1' : '0';
      if (level && (level !== list.dataset.level || escalated !== list.dataset.escalated)) {
        location.reload();
      }
    } catch (e) {}
  }
  setInterval(pollLevel, 5000);

  // 14차: 마스코트가 자동으로 뜰 때(?auto=1)는 버튼을 누를 필요 없이 마지막에 하던
  // 게임·장보기로 바로 간다. 주소에서 auto를 먼저 지워서, 나중에 새로고침하거나
  // "← 퀘스트"로 돌아왔을 때는 다시 튕기지 않게 한다.
  (function () {
    const params = new URLSearchParams(location.search);
    if (!params.has('auto')) return;
    history.replaceState(null, '', location.pathname);
    let last = null;
    try { last = JSON.parse(localStorage.getItem('idle-last-game') || 'null'); } catch (e) {}
    if (last && last.path && Date.now() - (last.at || 0) < 7 * 24 * 60 * 60 * 1000) {
      location.replace(last.path);
    }
  })();

  // 14차: 마스코트가 사라질 때 하던 게임·장보기가 있으면 "이어서 하기" 버튼을 보여준다
  // (각 게임이 /games/save.js로 'idle-last-game'에 적어둔다). 설명 문장 자리를 대신한다.
  (function () {
    const subEl = document.querySelector('.bubble p.sub');
    if (!subEl || !document.getElementById('quests')) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem('idle-last-game') || 'null'); } catch (e) {}
    if (!last || !last.path || Date.now() - (last.at || 0) > 7 * 24 * 60 * 60 * 1000) return;
    const a = document.createElement('a');
    a.className = 'resume';
    a.href = last.path;
    // 17차: 이름은 목록에 있는 (언어에 맞춘) 퀘스트 이름을 쓴다.
    const q = document.querySelector('.track .quest[data-id="' + last.id + '"]');
    // 이 스크립트는 DOMContentLoaded(=applyI18n)보다 먼저 돌 수 있어서, 목록 글자가
    // 아직 한국어일 수 있다 — 그래서 한 번 더 T()에 통과시킨다 (이미 번역됐으면 그대로).
    const name = q
      ? q.querySelector('.emoji').textContent + ' ' + T(q.querySelector('[data-i18n]').textContent.trim())
      : T(last.label);
    a.textContent = T('▶ 하던 {name} 이어서 하기', { name: name });
    subEl.replaceWith(a);
  })();

  // 12차: 캐러셀이 버튼을 복제·재구성하므로 클릭은 목록 쪽에서 위임받아 처리한다.
  function onQuestClick(btn) {
    questChosen = true;
    fetch('/quest/choice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: btn.dataset.bucket, questId: btn.dataset.id }),
    }).catch(() => {});
    // 9차: 바로 할 수 있는 퀘스트(예: 스도쿠)는 누르면 창 안에서 그 게임을 연다.
    if (btn.dataset.open) {
      location.href = btn.dataset.open;
      return;
    }
    // 11차: "마스코트 쓰다듬기"는 화면을 바꾸지 않고 마스코트만 반응한다.
    if (btn.dataset.pet) {
      questChosen = false;
      pet();
      return;
    }
    // 10차: 맥에서 바로 할 수 있는 퀘스트(바탕화면 정리 등)는 그 화면을 열어준다.
    // 뭘 열지는 서버가 quests.json에서 정한다 — 페이지는 퀘스트 id만 보낸다.
    if (btn.dataset.launch) {
      fetch('/quest/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questId: btn.dataset.id }),
      }).catch(() => {});
    }
    showPicked(btn);
  }

  // 10차: 퀘스트를 누르면 반응이 보이게 — 마스코트가 한 번 톡 튀고, 말풍선이
  // "시작!"으로 바뀌고, 목록 대신 고른 퀘스트 카드가 뜬다.
  const h1 = document.querySelector('.bubble h1');
  const sub = document.querySelector('.bubble p.sub');
  // 19차: i18n.js가 이미 번역해 둔 상태라 화면 글자를 그대로 기억했다가 되돌린다.
  const original = { h1: h1 && h1.textContent, sub: sub && sub.textContent };
  function hop() {
    const m = document.querySelector('.mascot');
    if (!m) return;
    m.classList.remove('hop');
    void m.offsetWidth; // 애니메이션 다시 시작
    m.classList.add('hop');
  }
  // 11차: 마스코트를 누르거나 "쓰다듬기" 퀘스트를 고르면 좋아한다.
  const PET_LINES = L === 'en'
    ? ['Hehe 🥰', 'That tickles!', 'I like that 💕', 'More please~', 'Feeling powered up! 💪', 'Yay 😆']
    : ['헤헤 🥰', '간지러워요!', '기분 좋아요 💕', '더 해줘요~', '힘이 나요! 💪', '냐하하 😆'];
  let petTimer = null;
  function pet() {
    hop();
    const m = document.querySelector('.mascot');
    if (m) {
      m.classList.add('happy');
      clearTimeout(petTimer);
      petTimer = setTimeout(() => {
        m.classList.remove('happy');
        if (h1 && !document.getElementById('picked').style.display.includes('block')) {
          h1.textContent = original.h1;
          if (sub) sub.textContent = original.sub;
        }
      }, 1800);
    }
    if (h1) h1.textContent = PET_LINES[Math.floor(Math.random() * PET_LINES.length)];
    if (sub) sub.textContent = T('마스코트가 좋아해요');
  }
  const langBtn = document.getElementById('lang');
  if (langBtn) langBtn.addEventListener('click', () => setLang()); // 다음 언어로

  const mascotBody = document.querySelector('.mascot');
  if (mascotBody) mascotBody.addEventListener('click', pet);

  // 16차: 마스코트 키우기 — 입힌 꾸미기와 레벨을 보여주고, 레벨이 올랐으면 축하한다.
  if (window.IdleMascot && mascotBody) {
    IdleMascot.load().then((info) => {
      if (!info) return;
      IdleMascot.apply(mascotBody, info);
      IdleMascot.badge(mascotBody, info.level);
      let prev = 0;
      try { prev = Number(localStorage.getItem('idle-mascot-level')) || 0; } catch (e) {}
      try { localStorage.setItem('idle-mascot-level', String(info.level)); } catch (e) {}
      if (prev && info.level > prev && h1) {
        const got = info.items.filter((it) => it.level > prev && it.level <= info.level);
        h1.textContent = T('레벨 업! Lv.') + info.level + ' 🎉';
        if (sub) sub.textContent = got.length
          ? (T('새 아이템: ') + got.map((it) => (it.emoji || '🎨') + ' ' + T(it.label)).join(', ') +
             T(' · 🐣 마스코트 꾸미기에서 입혀보세요'))
          : T('계속 키워주셔서 고마워요');
        hop();
      }
    });
  }

  function showPicked(btn) {
    const label = btn.querySelector('span:nth-child(2)').textContent;
    const emoji = btn.querySelector('.emoji').textContent;
    if (h1) h1.textContent = T('좋아요! 퀘스트 시작 🎯');
    if (sub) sub.textContent = T('끝나면 바로 알려드릴게요.');
    document.querySelector('#picked .card').textContent = emoji + ' ' + label + ' ✓';
    document.querySelector('.carousel').style.display = 'none';
    document.getElementById('picked').style.display = 'block';
    hop();
  }
  const againBtn = document.querySelector('#picked .again');
  if (againBtn) {
    againBtn.addEventListener('click', () => {
      questChosen = false;
      if (h1) h1.textContent = original.h1;
      if (sub) sub.textContent = original.sub;
      document.getElementById('picked').style.display = 'none';
      document.querySelector('.carousel').style.display = 'flex';
    });
  }

  // 11차: 룰렛형 자동 캐러셀 (CSS 설명은 .track 위 주석 참고).
  // 12차: 카테고리 탭 — 고른 카테고리만 추려서 캐러셀을 다시 짠다.
  const list = document.getElementById('quests');
  const track = list && list.querySelector('.track');
  if (track) {
    const originals = [...track.querySelectorAll('.quest')];
    const up = document.getElementById('up');
    const down = document.getElementById('down');
    const count = document.getElementById('count');
    const STEP = 46; // 버튼 높이 40 + 간격 6
    const AUTO_MS = 5000; // 자동으로 한 칸 넘어가는 간격 (11차: 2.6초는 너무 빠르다는 피드백으로 늘림)
    const PAUSE_MS = 8000; // 직접 만지면 이만큼 쉬었다가 다시 돈다
    const STEP_EASE = 'transform 0.8s cubic-bezier(.34,1.3,.64,1)'; // 살짝 튕기는 오버슈트
    const SPIN_EASE = 'transform 1.6s cubic-bezier(.12,.75,.15,1)'; // 빠르게 돌다 감속
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let n = 0, all = [], loop = false;
    let top = 0; // 맨 위에 보이는 칸의 인덱스 (가운데 칸 = top + 1)
    let pausedUntil = 0;
    let hovering = false;

    const place = (ease) => {
      track.style.transition = ease || 'none';
      track.style.transform = 'translateY(' + -top * STEP + 'px)';
      const focus = loop ? top + 1 : -1;
      all.forEach((el, i) => el.classList.toggle('focus', i === focus || (!loop && n > 0)));
      if (count) count.textContent = loop ? ((top + 1) % n) + 1 + '/' + n : T('{n}개', { n: n });
    };
    // 3벌 중 가운데 벌 안으로 되돌린다 — 보이는 모습은 똑같아서 티가 안 난다.
    const normalize = () => {
      if (!loop) return;
      if (top >= 2 * n - 1 || top < n - 1) {
        top = ((top - (n - 1)) % n + n) % n + (n - 1);
        place(null);
      }
    };
    track.addEventListener('transitionend', (e) => {
      if (e.target === track) normalize();
    });
    const step = (delta, ease) => {
      top += delta;
      place(ease || STEP_EASE);
    };
    const nudge = (delta) => {
      if (!loop) return;
      pausedUntil = Date.now() + PAUSE_MS;
      normalize();
      step(delta);
    };

    // 고른 카테고리로 캐러셀을 다시 짠다. 3개 이하면 굴릴 필요 없이 그냥 나열.
    let buildId = 0;
    function build(cat, spin) {
      const myBuild = ++buildId;
      const items = originals.filter((el) => cat === 'all' || el.dataset.cat === cat);
      n = items.length;
      loop = n > 3;
      track.innerHTML = '';
      const copies = loop ? 3 : 1;
      for (let c = 0; c < copies; c++) items.forEach((el) => track.appendChild(el.cloneNode(true)));
      all = [...track.querySelectorAll('.quest')];
      if (up) up.style.visibility = loop ? '' : 'hidden';
      if (down) down.style.visibility = loop ? '' : 'hidden';
      if (!loop || reduced || !spin) {
        top = loop ? n - 1 : 0;
        place(null);
        return;
      }
      // 등장 연출: 첫 벌 맨 위에서 출발해 가운데 벌의 아무 칸까지 한 바퀴 넘게 굴린다.
      top = 0;
      place(null);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (myBuild !== buildId) return; // 그 사이 탭을 또 바꿨으면 이 연출은 버린다
          top = n - 1 + Math.floor(Math.random() * n);
          place(SPIN_EASE);
        })
      );
      pausedUntil = Date.now() + 1600;
    }

    track.addEventListener('click', (e) => {
      const btn = e.target.closest('.quest');
      if (btn) onQuestClick(btn);
    });

    // 21차: 토큰 화면이 있으면(기본 화면) 탭을 고를 때까지 캐러셀은 숨겨 둔다.
    const burnEl = document.getElementById('burn');
    const carouselEl = document.querySelector('.carousel');
    const showBurn = (on) => {
      if (!burnEl) return;
      burnEl.style.display = on ? '' : 'none';
      carouselEl.style.display = on ? 'none' : 'flex';
      document.getElementById('picked').style.display = 'none';
      if (on) window.dispatchEvent(new Event('burn:show'));
    };

    // 카테고리 탭: 목록에 실제로 있는 카테고리만 보여준다.
    const cats = document.getElementById('cats');
    if (cats) {
      const present = new Set(originals.map((el) => el.dataset.cat));
      cats.querySelectorAll('button').forEach((b) => {
        if (b.dataset.cat !== 'all' && !present.has(b.dataset.cat)) b.remove();
      });
      cats.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.classList.contains('on')) {
          // 같은 탭을 다시 누르면 토큰 화면으로 돌아간다
          if (!burnEl) return;
          b.classList.remove('on');
          showBurn(true);
          return;
        }
        cats.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        questChosen = false;
        showBurn(false);
        build(b.dataset.cat, true);
      });
    }

    if (!burnEl) build('all', true);
    setInterval(() => {
      if (!loop || reduced || questChosen || hovering || Date.now() < pausedUntil) return;
      normalize();
      step(1);
    }, AUTO_MS);

    list.addEventListener('mouseenter', () => (hovering = true));
    list.addEventListener('mouseleave', () => (hovering = false));
    if (up) up.addEventListener('click', () => nudge(-1));
    if (down) down.addEventListener('click', () => nudge(1));
    let wheelLock = 0;
    list.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (Date.now() < wheelLock || Math.abs(e.deltaY) < 4) return;
        wheelLock = Date.now() + 350;
        nudge(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
  }

  // 21차: 기본 화면 — 지금 작업이 태우는 토큰을 2초마다 새로 그린다.
  // 작업이 없으면 오늘 합계만 보여준다. 불꽃은 최근 1분 동안 탄 양에 따라 빨리 흔들린다.
  (function () {
    const burn = document.getElementById('burn');
    if (!burn) return;
    const $ = (id) => document.getElementById(id);
    const numEl = $('burnNum'), labelEl = $('burnLabel'), svg = $('burnChart');
    const area = $('burnArea'), line = $('burnLine'), dot = $('burnDot');
    const rateEl = $('burnRate'), todayEl = $('burnToday');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 리포트(games/report.html)와 같은 표기: 3,251만 / 10.9억 · 영어는 32.5M
    function tok(n) {
      n = Math.round(n || 0);
      if (L === 'en') {
        if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\\.0$/, '') + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
        if (n >= 1e3) return Math.round(n / 1e3) + 'K';
        return String(n);
      }
      if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\\.0$/, '') + '억';
      if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
      return n.toLocaleString('ko-KR');
    }

    // 숫자는 올라가는 게 보이게 0.7초 동안 굴린다
    let shown = null, anim = 0;
    function countTo(v) {
      if (reduced || shown === null) { shown = v; numEl.textContent = tok(v); return; }
      const from = shown, t0 = performance.now(), my = ++anim;
      const frame = (t) => {
        if (my !== anim) return;
        const k = Math.min(1, (t - t0) / 700);
        shown = from + (v - from) * (1 - Math.pow(1 - k, 3));
        numEl.textContent = tok(shown);
        if (k < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    function draw(series) {
      const r = svg.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      if (series.length < 2) { line.setAttribute('d', ''); area.setAttribute('d', ''); dot.setAttribute('r', 0); return; }
      const t0 = series[0][0], t1 = Math.max(series[series.length - 1][0], t0 + 1);
      const max = Math.max(1, series[series.length - 1][1]);
      const P = 4;
      const pts = series.map(([t, v]) => [P + (t - t0) / (t1 - t0) * (W - 2 * P), H - P - v / max * (H - 2 * P)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const last = pts[pts.length - 1];
      line.setAttribute('d', d);
      area.setAttribute('d', d + ' L' + last[0].toFixed(1) + ' ' + H + ' L' + pts[0][0].toFixed(1) + ' ' + H + ' Z');
      dot.setAttribute('r', 3);
      dot.setAttribute('cx', last[0].toFixed(1));
      dot.setAttribute('cy', last[1].toFixed(1));
    }

    function render(d) {
      const live = d.live || {};
      const t = d.today || { claude: { total: 0 }, codex: { total: 0 } };
      const today = t.claude.total + t.codex.total;
      const resting = !d.working;
      burn.classList.toggle('resting', resting);
      if (resting) {
        labelEl.textContent = T('오늘 태운 토큰');
        burn.classList.remove('hot');
        countTo(today);
        rateEl.textContent = t.claude.total ? 'Claude ' + tok(t.claude.total) : '';
        todayEl.textContent = t.codex.total ? 'Codex ' + tok(t.codex.total) : '';
        return;
      }
      labelEl.textContent = T('이번 작업에서 태운 토큰');
      const rate = live.recent || 0;
      burn.classList.toggle('hot', rate > 0);
      burn.style.setProperty('--flick', rate > 2e6 ? '0.35s' : rate > 5e5 ? '0.55s' : '0.9s');
      countTo(live.total || 0);
      rateEl.textContent = T('분당 {n}', { n: tok(rate) });
      todayEl.textContent = T('오늘 {n}', { n: tok(today) });
      draw(live.series || []);
    }

    async function tick() {
      if (window.__idleHidden || document.hidden || burn.style.display === 'none') return;
      try { render(await (await fetch('/tokens/live')).json()); } catch (e) {}
    }
    tick();
    setInterval(tick, 2000);
    window.addEventListener('burn:show', tick);
  })();
</script>
</body>
</html>`;
}

function mascotHeader(headerHtml) {
  return `  <div class="mascot-wrap">
    <div class="mascot"></div>
    <div class="bubble">
      <div class="who" id="who"></div>
${headerHtml}
    </div>
  </div>`;
}

// Landing view (9차, 2026-09-18): 시간을 묻지 않는다. 이 기능의 목적은
// 사용자를 자리에서 떠나보내는 게 아니라, 작업이 길어져서 기다리는 동안
// 심심하지 않게 할 일을 "먼저 뿌려주는" 것 — 그래서 마스코트가 뜨자마자
// 추천 퀘스트 1~3개를 바로 보여준다. /quest/pick(시간예산 경로)은 채팅
// 도구(sidequest_select_time_budget)와의 호환을 위해 그대로 남겨둔다.
function renderQuestList(quests) {
  return quests
    .map(
      (q) => `      <button class="quest" data-bucket="${q.bucket || ''}" data-id="${q.id}" data-cat="${q.cat || ''}"${q.open ? ` data-open="${q.open}"` : ''}${q.launch ? ' data-launch="1"' : ''}${q.pet ? ' data-pet="1"' : ''}>
        <span class="emoji">${q.emoji}</span><span data-i18n>${q.label}</span>${q.open || q.launch ? '<span class="go" data-i18n>바로 하기 ›</span>' : ''}
      </button>`
    )
    .join('\n');
}

// 21차: tokenFirst면 탭 아래 기본 화면이 캐러셀이 아니라 "지금 태우는 토큰" 그래프다.
// 카테고리 탭을 누르면 그때 캐러셀이 나오고, 같은 탭을 다시 누르면 그래프로 돌아온다.
function renderCarousel(quests, listAttrs, opts = {}) {
  const tokenFirst = Boolean(opts.tokenFirst);
  return `
  <div class="cats" id="cats">
    <button${tokenFirst ? '' : ' class="on"'} data-cat="all" data-i18n>전체</button>
    <button data-cat="game" data-i18n>🎮 게임</button>
    <button data-cat="fun" data-i18n>😂 웃음</button>
    <button data-cat="rest" data-i18n>🧘 휴식</button>
    <button data-cat="todo" data-i18n>📋 할 일</button>
  </div>${tokenFirst ? `
  <div id="burn">
    <div class="num"><span class="flame">🔥</span><span id="burnNum">-</span></div>
    <div class="label" id="burnLabel" data-i18n>이번 작업에서 태운 토큰</div>
    <div class="chart">
      <svg id="burnChart" aria-hidden="true">
        <defs><linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c96442" stop-opacity=".32"/><stop offset="1" stop-color="#c96442" stop-opacity="0"/>
        </linearGradient></defs>
        <path id="burnArea" fill="url(#burnFill)"/>
        <path id="burnLine" fill="none" stroke="#c96442" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle id="burnDot" class="dot" r="3" fill="#c96442"/>
      </svg>
      <div class="idle" id="burnIdle" data-i18n>작업이 시작되면 토큰이 타는 게 여기 보여요</div>
    </div>
    <div class="meta"><span id="burnRate"></span><span id="burnToday"></span></div>
  </div>` : ''}
  <div class="carousel"${tokenFirst ? ' style="display:none"' : ''}>
    <div id="quests" ${listAttrs}>
      <div class="track">
${renderQuestList(quests)}
      </div>
    </div>
    <div class="rail">
      <button id="up" title="위로" data-i18n-title>▲</button>
      <span class="count" id="count"></span>
      <button id="down" title="아래로" data-i18n-title>▼</button>
    </div>
  </div>
  <div id="picked">
    <div class="card"></div>
    <button class="again" data-i18n>다른 거 고를래요</button>
  </div>`;
}

// 지금 진행 중인 turn의 예상 단계 (없으면 null) — lib/estimate.js 참고.
function currentLevelInfo() {
  const sid = state.getActiveWorkingSessionId();
  const rec = sid ? state.getState().sessions[sid] : null;
  return effectiveLevel(rec);
}

function renderRecommendationPage() {
  const info = currentLevelInfo();
  const level = info ? info.level : 'SHORT';
  // 10차: 3개만 뽑아 새로고침하던 걸, 그 단계의 퀘스트 전부를 섞어 캐러셀로 보여준다.
  const quests = pickQuestsFromBuckets(LEVEL_BUCKETS[level], Infinity);
  // 11차: 창 안에서 바로 하는 게임(open 항목)은 예상 단계와 상관없이 항상 섞는다 —
  // "짧음" 단계에서 스도쿠 같은 게임이 아예 안 보인다는 피드백.
  for (const [bucket, list] of Object.entries(state.listQuests())) {
    for (const q of list) {
      if (!q.open || quests.some((p) => p.id === q.id)) continue;
      quests.splice(Math.floor(Math.random() * (quests.length + 1)), 0, { ...q, bucket });
    }
  }
  const sub = info ? '기다리는 동안 할 수 있는 일을 추천해봤어요. 끝나면 바로 알려드릴게요.' : '할 수 있는 일을 추천해봤어요.';
  return (
    mascotHeader(`      <h1 data-i18n>${headlineFor(info)}</h1>
      <p class="sub" data-i18n>${sub}</p>`) +
    renderCarousel(quests, `data-level="${info ? info.level : ''}" data-escalated="${info && info.escalated ? 1 : 0}"`, { tokenFirst: true })
  );
}

function renderQuestPickedPage(key, quests) {
  const title = key === 'UNTIL_DONE' ? '끝날 때까지 할 퀘스트예요!' : `${key}분짜리 퀘스트예요!`;
  return (
    mascotHeader(`      <h1 data-i18n>${title}</h1>
      <p class="sub" data-i18n>하나 골라서 해보세요 🎯</p>`) +
    renderCarousel(quests, '')
  );
}

/**
 * 10차: 퀘스트의 launch 항목(lib/quests.json)대로 macOS에서 해당 화면을 연다.
 * path(Finder 폴더) / url(기본 브라우저) / app(앱 이름) 중 하나. 열 대상은
 * quests.json에 적힌 것만 쓰고, 요청에서 받은 건 퀘스트 id뿐이다.
 */
function launchQuest(questId) {
  if (os.platform() !== 'darwin') return false;
  const quest = Object.values(state.listQuests())
    .flat()
    .find((q) => q.id === questId);
  const launch = quest && quest.launch;
  if (!launch) return false;
  let args;
  if (launch.path) args = [launch.path.replace(/^~(?=\/|$)/, os.homedir())];
  else if (launch.url) args = [launch.url];
  else if (launch.app) args = ['-a', launch.app];
  else return false;
  execFile('open', args, (err) => {
    if (err) console.error('[side-quest] launch failed:', questId, err.message);
  });
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

let todayMemo = null; // /tokens/live 의 오늘 합계 캐시

function start() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.getState()));
        return;
      }

      // 위젯 밖(일반 브라우저)에서 ✕를 눌렀을 때 404 대신 조용히 무시.
      if (url.pathname === '/__close') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 11차: 창 안 미니 퀘스트(mcp/games/<이름>.html)와 공통 스타일. 이름은
      // 영문 소문자/숫자/하이픈만 받아서 games 폴더 밖 파일은 못 읽게 한다.
      const game = req.method === 'GET' && url.pathname.match(/^\/games\/([a-z0-9-]+)(\.css|\.json|\.js)?$/);
      if (game) {
        const ext = game[2] || '.html';
        const TYPES = { '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.js': 'text/javascript' };
        const file = path.join(__dirname, 'games', game[1] + ext);
        if (fs.existsSync(file)) {
          let body = fs.readFileSync(file);
          // i18n.js 맨 앞에 맥 시스템 언어와 번역 사전을 붙여둔다 (위 설명 참고).
          if (game[1] === 'i18n' && ext === '.js') {
            const head =
              `window.__idleSysLang=${JSON.stringify(systemLang())};\n` +
              `window.__idleDicts=${JSON.stringify(localeDicts())};\n`;
            body = Buffer.concat([Buffer.from(head), body]);
          }
          res.writeHead(200, { 'Content-Type': TYPES[ext] + '; charset=utf-8' });
          res.end(body);
          return;
        }
      }

      // 16차: 게임·휴식 페이지에 머문 시간 (games/track.js가 10초마다 보냄)
      if (req.method === 'POST' && url.pathname === '/activity') {
        let body = {};
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const ok = stats.appendActivity(body);
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
        return;
      }

      // 16차: 오늘의 기다림 리포트 숫자 (?day=YYYY-MM-DD)
      if (req.method === 'GET' && url.pathname === '/stats') {
        const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : stats.todayKey();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats.dayStats(day)));
        return;
      }

      // 21차: 추천 화면 기본 뷰 — 지금 작업이 태우는 토큰 (2초마다 불린다)
      if (req.method === 'GET' && url.pathname === '/tokens/live') {
        const now = Date.now();
        // ?session=<id> — 22차: 터미널 상태줄(setup/statusline.js)이 자기 세션의 이번 작업
        // 토큰만 묻는다. 끝난(DONE) 작업도 마지막 작업 분량을 돌려준다.
        const only = url.searchParams.get('session');
        const working = Object.entries(state.getState().sessions)
          .filter(([id, r]) => r && r.startedAt && (only
            ? id === only
            : (r.state === 'WORKING' || r.state === 'NEEDS_INPUT') && now - r.startedAt < 6 * 3600 * 1000))
          .map(([id, r]) => ({ sessionId: id, tool: String(r.source).startsWith('codex') ? 'codex' : 'claude', startedAt: r.startedAt }));
        // 오늘 합계는 디렉터리를 훑어야 해서 15초에 한 번만 새로 센다
        if (!todayMemo || now - todayMemo.at > 15 * 1000) todayMemo = { at: now, value: stats.todayTokens() };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ now, session: only || undefined, working: working.length, live: stats.liveTokens(working), today: todayMemo.value }));
        return;
      }

      // 18차: 게임 기록 화면용 — 퀘스트 목록과 게임별 총 논 시간
      if (req.method === 'GET' && url.pathname === '/games-info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ quests: Object.values(state.listQuests()).flat(), seconds: stats.gameTotals() }));
        return;
      }

      // 16차: 마스코트 레벨·경험치·꾸미기 목록
      if (req.method === 'GET' && url.pathname === '/mascot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats.mascot()));
        return;
      }

      // 16차: 리포트 카드 이미지를 ~/Downloads에 저장하고 Finder에서 보여준다.
      if (req.method === 'POST' && url.pathname === '/report/save') {
        let body = {};
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.png || ''));
        const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day || '') ? body.day : stats.todayKey();
        if (!m || m[1].length > 12 * 1024 * 1024) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        const dir = path.join(os.homedir(), 'Downloads');
        const file = path.join(dir, `idle-buddy-report-${day}.png`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
        if (os.platform() === 'darwin') execFile('open', ['-R', file], () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: path.basename(file) }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/quest/level') {
        const info = currentLevelInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info || { level: null }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/quest') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageShell(renderRecommendationPage()));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/quest/pick') {
        const { key, quests } = pickQuests(url.searchParams.get('minutes'));
        if (!key) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(pageShell(renderRecommendationPage()));
          return;
        }
        // 7차: setup/statusline.js의 OSC8 링크는 실제 session_id를 explicit
        // query param으로 붙여 보낸다 (터미널 상태줄은 Claude Code가 stdin으로
        // 정확한 session_id를 주기 때문에 추측할 필요가 없음). Safari 사이드바
        // 랜딩 페이지는 자기 sessionId가 없는 그냥 브라우저 탭이라 여전히
        // getActiveWorkingSessionId() 추정에 의존한다 — explicit 값이 있으면
        // 그게 항상 우선.
        const sessionId = url.searchParams.get('sessionId') || state.getActiveWorkingSessionId();
        state.recordTimeBudget({ sessionId, key, quests });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pageShell(renderQuestPickedPage(key, quests)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/quest/launch') {
        let body = {};
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (e) {
          // ignore malformed body
        }
        const ok = launchQuest(body.questId);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/quest/choice') {
        const raw = await readBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          // ignore malformed body
        }
        state.recordChoice(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('AI Side Quest local page is running.\nGET /quest  GET /state\n');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
    }
  });

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('[side-quest] quest page server error:', err.message);
    }
    // else: another instance is already serving the page — that's fine.
  });

  // 20차: 작업 도중에 Codex를 끄면 Stop 훅이 오지 않아서 "Codex 작업 중"이 2시간
  // (STALE_WORKING_MS) 동안 남아 있었다. Codex는 작업하는 동안 반드시 `codex`
  // 프로세스가 떠 있으니(ChatGPT 앱 안의 바이너리든 CLI든 이름이 같다), 그게 없으면
  // Codex 세션을 끝난 것으로 정리한다. 포트를 잡은 프로세스 하나만 돈다.
  server.on('listening', () => {
    const SWEEP_MS = 15 * 1000;
    setInterval(() => {
      execFile('pgrep', ['-x', 'codex'], (err) => {
        // pgrep: 0 = 있음, 1 = 없음, 그 밖 = pgrep 자체 실패 → 모르니 건드리지 않는다
        if (!err || err.code !== 1) return;
        const ended = state.endSessionsWhere((src) => src.startsWith('codex'), 'CodexClosed');
        if (ended.length) console.error('[side-quest] Codex가 꺼져 있어 작업을 정리:', ended.join(', '));
      });
    }, SWEEP_MS).unref();
  });

  server.listen(PORT, HOST);
}

module.exports = { start };
