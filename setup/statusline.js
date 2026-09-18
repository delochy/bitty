#!/usr/bin/env node
'use strict';

/**
 * Claude Code status line — the "Claude Code 창 안에서 바로 뜨게" version
 * (2026-09-18, 7차). Claude Code runs this script and shows whatever it
 * prints in a row at the bottom of the actual Claude Code window — no
 * separate app, no Safari window, no Automation permission needed. This is
 * the official mechanism (docs: code.claude.com/docs/en/statusline),
 * researched before building, same as everything else in this project.
 *
 * Claude Code sends this session's JSON on stdin, including `session_id` —
 * the exact one, not a guess — so this path doesn't need the
 * getActiveWorkingSessionId() heuristic mcp/quest-http.js's landing page
 * needs (that page is a browser tab with no session_id of its own).
 *
 * `refreshInterval` (set in settings.json by setup/install-claude.js) makes
 * Claude Code re-run this on a timer even when nothing else is happening,
 * so the elapsed-time readout ticks and a state change written by a hook
 * (setup/claude-userprompt-relay.js, mcp/server.js) shows up promptly
 * instead of only refreshing on the next assistant message.
 *
 * Trade-off worth knowing (from the docs): setting a custom statusLine
 * makes Claude Code stop showing most of its own footer hints (esc to
 * interrupt, ? for shortcuts, hold space to speak).
 */

const state = require('../lib/state');
const { BUDGET_OPTIONS } = require('../lib/timebudget');

const PORT = process.env.SIDE_QUEST_PORT ? Number(process.env.SIDE_QUEST_PORT) : 4317;
// 사이드바 팝업과 같은 기준 — 짧게 끝나는 작업엔 아무것도 안 보여준다 (잔소리 금지)
const QUIET_MS = process.env.SIDE_QUEST_SIDEBAR_DELAY_MS
  ? Number(process.env.SIDE_QUEST_SIDEBAR_DELAY_MS)
  : 30000;

function osc8(text, url) {
  // Cmd/Ctrl+click opens `url` in the default browser (OSC 8, per Claude
  // Code's statusline docs). This is how a status-line row gets to be
  // "clickable" at all — there's no button/form widget in a terminal.
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}분 ${rem}초` : `${m}분`;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    render(raw);
  });
  process.stdin.on('error', () => render(raw));
  // stdin이 막혀도 상태줄이 영원히 비어있지 않게 짧은 타임아웃
  setTimeout(() => render(raw), 1500);
}

let rendered = false;
function render(raw) {
  if (rendered) return; // setTimeout과 'end' 둘 다 걸릴 수 있음 — 한 번만
  rendered = true;

  try {
    const payload = raw ? JSON.parse(raw) : {};
    const sessionId = payload.session_id;
    const sessions = state.getState().sessions || {};
    const rec = sessionId ? sessions[sessionId] : null;

    if (!rec) {
      process.exit(0); // 아직 이 세션에 대한 기록이 없음 — 조용히 아무것도 안 보여줌
      return;
    }

    if (rec.state === 'WORKING') {
      const elapsedMs = rec.startedAt ? Date.now() - rec.startedAt : 0;
      if (elapsedMs < QUIET_MS) {
        console.log('🐣 AI Side Quest · 작업 중');
      } else if (rec.timeBudget) {
        const label = rec.timeBudget === 'UNTIL_DONE' ? '끝날 때까지' : `${rec.timeBudget}분`;
        console.log(`🐣 작업 중 (${formatElapsed(elapsedMs)}) · ${label} 자리 비우는 중 — 먼저 끝나면 알려드릴게요`);
      } else {
        const links = BUDGET_OPTIONS.map((o) =>
          osc8(o.label, `http://127.0.0.1:${PORT}/quest/pick?minutes=${encodeURIComponent(o.key)}&sessionId=${encodeURIComponent(sessionId)}`)
        ).join('  ');
        console.log(`🐣 작업 중 (${formatElapsed(elapsedMs)}) · 자리 비울 시간: ${links}`);
      }
    } else if (rec.state === 'NEEDS_INPUT') {
      console.log('❗ AI Side Quest · 입력이 필요해요 — 돌아와주세요');
    } else if (rec.state === 'DONE') {
      console.log('🔔 AI Side Quest · 작업 끝났어요 — 돌아올 시간이에요!');
    } else {
      process.exit(0);
      return;
    }
  } catch (err) {
    // best-effort — 상태줄 하나 때문에 Claude Code가 막히면 안 됨
    process.exit(0);
    return;
  }
  process.exit(0);
}

main();
