#!/usr/bin/env node
'use strict';

/**
 * Claude Code status line — 터미널에서 Claude Code를 쓸 때 맨 아래 줄에 뜬다
 * (공식 기능, docs: code.claude.com/docs/en/statusline). 데스크톱 앱에서는 돌지 않는다.
 *
 * 22차: 예전엔 여기서 "자리 비울 시간: 5분 10분 20분"을 물었는데, 이 프로젝트는 자리를
 * 비우라는 게 아니라 기다리는 동안 심심하지 않게 하는 게 목적이라 정반대였다. 이제는
 * 위젯과 같은 결로, 이번 작업에 걸린 시간과 태운 토큰만 담백하게 보여준다.
 *
 *   작업 중   🐣 작업 중 54초 · 🔥 1,407만
 *   입력 대기 ❗ 입력을 기다리고 있어요
 *   끝        ✅ 작업 끝 · 2분 13초 · 🔥 1,407만
 *
 * 토큰은 위젯 데몬(4318)이나 MCP 서버(4317)에 묻는다 — 이 스크립트는 2초마다 새로
 * 떠서, 직접 세션 기록(수십 MB~수 GB)을 읽으면 매번 처음부터 읽게 된다. 데몬은 읽은
 * 위치를 기억하고 있다. 둘 다 없으면 🔥 부분만 빼고 보여준다.
 *
 * Claude Code가 stdin으로 이 세션의 JSON(session_id 포함)을 준다. refreshInterval(설치
 * 스크립트가 settings.json에 넣는다) 덕분에 아무 일 없어도 주기적으로 다시 돌아서
 * 경과 시간이 흘러간다.
 */

const state = require('../lib/state');

const PORTS = [4318, process.env.SIDE_QUEST_PORT ? Number(process.env.SIDE_QUEST_PORT) : 4317];
// 터미널 언어를 따른다 (ko_KR.UTF-8 → 한국어, 그 밖엔 영어)
const KO = /^ko/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '');
const t = (ko, en) => (KO ? ko : en);

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t(`${s}초`, `${s}s`);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (!rem) return t(`${m}분`, `${m}m`);
  return t(`${m}분 ${rem}초`, `${m}m ${rem}s`);
}

// 위젯·리포트와 같은 표기: 1,407만 / 10.9억 · 영어는 14.1M
function tok(n) {
  n = Math.round(n || 0);
  if (!KO) {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
  }
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
}

async function turnTokens(sessionId) {
  for (const port of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/tokens/live?session=${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.timeout(400),
      });
      if (!r.ok) continue;
      const d = await r.json();
      // 옛 버전 서버는 ?session을 몰라서 전체 합계를 준다 — 세션을 되돌려줄 때만 믿는다
      if (d && d.session === sessionId && d.live && typeof d.live.total === 'number') return d.live.total;
    } catch (e) {}
  }
  return null;
}

async function render(raw) {
  const payload = raw ? JSON.parse(raw) : {};
  const sessionId = payload.session_id;
  const rec = sessionId ? (state.getState().sessions || {})[sessionId] : null;
  if (!rec) return ''; // 아직 이 세션 기록이 없음 — 조용히 비워 둔다

  const fire = async () => {
    const n = await turnTokens(sessionId);
    return n ? ` · 🔥 ${tok(n)}` : '';
  };

  if (rec.state === 'WORKING') {
    const elapsed = rec.startedAt ? Date.now() - rec.startedAt : 0;
    return `🐣 ${t('작업 중', 'Working')} ${formatElapsed(elapsed)}${await fire()}`;
  }
  if (rec.state === 'NEEDS_INPUT') {
    return `❗ ${t('입력을 기다리고 있어요', 'Waiting for your input')}`;
  }
  if (rec.state === 'DONE') {
    const took = rec.startedAt && rec.updatedAt ? ` · ${formatElapsed(rec.updatedAt - rec.startedAt)}` : '';
    return `✅ ${t('작업 끝', 'Done')}${took}${await fire()}`;
  }
  return '';
}

let raw = '';
let done = false;
function finish() {
  if (done) return; // 'end'와 타임아웃 둘 다 걸릴 수 있다 — 한 번만
  done = true;
  // best-effort — 상태줄 하나 때문에 Claude Code가 막히면 안 된다
  Promise.race([render(raw).catch(() => ''), new Promise((r) => setTimeout(() => r(''), 1200))])
    .then((line) => {
      if (line) console.log(line);
      process.exit(0);
    });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', finish);
process.stdin.on('error', finish);
setTimeout(finish, 1500); // stdin이 막혀도 영원히 기다리지 않게
