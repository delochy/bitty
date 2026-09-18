#!/usr/bin/env node
'use strict';

/**
 * Claude Code's UserPromptSubmit hook, `command` handler (NOT mcp_tool).
 *
 * 2026-09-18 실측: mcp_tool 훅으로 UserPromptSubmit을 걸었을 때, 우리 MCP
 * 서버가 돌려준 텍스트가 실제로는 Claude의 응답에 컨텍스트로 반영되지
 * 않았다 (WORKING 전이/알림/로그는 전부 정상 동작했지만, 시간예산 질문이
 * 답변에 안 붙었음). 반면 Claude Code 공식 문서는 UserPromptSubmit에서
 * "plain-text stdout"만 "Claude가 보고 행동할 수 있는 컨텍스트"라고 명시한다
 * — mcp_tool의 도구 반환값은 그 경로에 해당하지 않는 것으로 보인다.
 *
 * 그래서 이 이벤트만 command 핸들러로 바꿨다: Claude Code가 이 스크립트를
 * 직접 실행하고, stdin으로 JSON(session_id, cwd, transcript_path, prompt 등)을
 * 준다. lib/state.js를 직접 require해서 MCP 프로토콜을 거치지 않고 상태를
 * 갱신하고, WORKING으로 전이됐을 때만 시간예산 질문을 stdout에 찍는다.
 *
 * 실패해도 Claude Code 자체가 막히면 안 되므로 항상 exit 0으로 끝낸다.
 */

const state = require('../lib/state');
const { buildWorkingInstruction } = require('../lib/working-prompt');
const { scheduleSidebar } = require('../lib/sidebar');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    // stdin이 아예 안 들어오는 상황(터미널 등) 대비, 너무 오래 걸리지 않게.
    setTimeout(() => resolve(data), 2000);
  });
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    process.exit(0); // 파싱 실패해도 Claude Code 진행에는 영향 주지 않는다
    return;
  }

  try {
    const result = state.reportEvent({
      source: 'claude',
      event: payload.hook_event_name || 'UserPromptSubmit',
      sessionId: payload.session_id,
      context: {
        cwd: payload.cwd,
        transcriptPath: payload.transcript_path,
        prompt: payload.prompt,
      },
    });

    // 10차: OS 알림은 없앴다 — 끝났다는 신호는 마스코트 위젯의 배너와 삐빅 소리로 준다.

    if (result.transitioned && result.state === 'WORKING') {
      // 9차: 30초 지연 팝업은 이제 네이티브 마스코트 앱(native-widget/)이
      // state.json을 폴링해서 직접 한다. Safari 창 팝업은 겹쳐 뜨지 않게 끔.
      // 네이티브 앱 없이 Safari 방식으로 되돌리려면 SIDE_QUEST_SAFARI_POPUP=1.
      if (process.env.SIDE_QUEST_SAFARI_POPUP === '1') {
        scheduleSidebar(result.sessionId || payload.session_id, result.startedAt, result.turnSeq);
      }
      process.stdout.write(buildWorkingInstruction(result.sessionId || payload.session_id));
    }
  } catch (err) {
    // best-effort — 훅이 실패해도 Claude Code 진행을 막지 않는다
  }

  process.exit(0);
}

main();
