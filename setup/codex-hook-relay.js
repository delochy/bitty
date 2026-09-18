#!/usr/bin/env node
'use strict';

/**
 * Codex hooks의 `command` 핸들러 (13차, 2026-09-18).
 *
 * 원래 Codex 쪽은 ~/.codex/hooks.json에서 mcp_tool 핸들러로 우리 MCP 서버의
 * sidequest_report_event를 부르게 했는데, Codex 세션을 많이 돌려도
 * data/events.local.jsonl에 codex-hook 이벤트가 한 번도 안 찍혔다. Claude 쪽도
 * 같은 이유(mcp_tool 경로가 불안정)로 setup/claude-userprompt-relay.js의 command
 * 방식으로 옮겼었으니, Codex도 같은 방식으로 맞춘다.
 *
 * Codex가 이 스크립트를 직접 실행하고 stdin으로 훅 JSON(hook_event_name,
 * session_id 등)을 준다. lib/state.js를 바로 갱신하면 마스코트 위젯
 * (native-widget/)이 state.json을 보고 Claude 때와 똑같이 뜨고 사라진다.
 *
 * Claude 쪽과 달리 stdout에는 아무것도 찍지 않는다 — 채팅 안내 문구나 작업 규모
 * 보고 지시(lib/working-prompt.js)는 Claude 도구 이름 기준이라 Codex에는 안 맞는다.
 * 실패해도 Codex 진행을 막으면 안 되므로 항상 exit 0.
 */

const state = require('../lib/state');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = raw ? JSON.parse(raw) : {};
    state.reportEvent({
      source: 'codex-hook',
      event: payload.hook_event_name || payload.event || process.argv[2],
      sessionId: payload.session_id || payload.thread_id,
      raw: payload,
      context: { cwd: payload.cwd, prompt: payload.prompt },
    });
  } catch (err) {
    // best-effort
  }
  process.exit(0);
}

main();
