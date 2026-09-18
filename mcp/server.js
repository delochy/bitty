#!/usr/bin/env node
'use strict';

/**
 * AI Side Quest — MCP server (stdio transport).
 *
 * Registered as an official MCP server in both Claude Code and Codex CLI
 * (see setup/install-claude.js, setup/install-codex.js). Their `mcp_tool`
 * hooks call sidequest_report_event directly on lifecycle events, instead
 * of shelling out to curl — the "official" integration path per Claude
 * Code's and Codex's own hook documentation.
 *
 * Hand-rolled JSON-RPC 2.0 over stdio (newline-delimited JSON, no
 * Content-Length framing) — no @modelcontextprotocol/sdk dependency, so
 * there's nothing to `npm install` and nothing that can break if the
 * registry is unreachable. This implements just enough of the MCP spec
 * (initialize, tools/list, tools/call) for Claude Code and Codex's MCP
 * clients.
 */

const readline = require('readline');
const state = require('../lib/state');
const { BUDGET_OPTIONS, pickQuests } = require('../lib/timebudget');
const { buildWorkingInstruction, BUDGET_OPTIONS_TEXT } = require('../lib/working-prompt');
const { scheduleSidebar } = require('../lib/sidebar');
const { normalizeSize } = require('../lib/estimate');

function formatQuestLines(quests) {
  return quests.map((q) => `${q.emoji} ${q.label}`).join('\n');
}

const TOOLS = [
  {
    name: 'sidequest_report_event',
    description:
      'Claude Code/Codex 훅에서 호출된다. lifecycle 이벤트(UserPromptSubmit, Notification, ' +
      'PermissionRequest, Stop, SubagentStop 등)를 보고하면 세션 상태(WORKING/NEEDS_INPUT/' +
      'DONE/FAILED)를 갱신하고, 상태가 바뀌었을 때만 OS 알림을 띄운다.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['claude', 'codex-hook', 'codex-notify'],
          description: '이벤트 출처 (어느 에이전트/경로에서 왔는지)',
        },
        event: {
          type: 'string',
          description: '훅 이벤트 이름 (예: UserPromptSubmit, Stop, PermissionRequest, Notification)',
        },
        sessionId: { type: 'string', description: '세션/스레드 id' },
        context: {
          type: 'object',
          description:
            '훅에서 공식적으로 얻을 수 있는 부가 정보 (있으면). cwd(작업 디렉터리), ' +
            'transcriptPath(대화 기록 파일 경로 — 있으면 마지막 사용자 프롬프트 미리보기를 ' +
            '최대 200자까지 로컬에만 기록한다). 없으면 생략해도 된다.',
          properties: {
            cwd: { type: 'string' },
            transcriptPath: { type: 'string' },
          },
        },
      },
      required: ['source', 'event'],
    },
  },
  {
    name: 'sidequest_select_time_budget',
    description:
      '사용자가 "얼마 동안 자리 비울지"(5분/10분/20분/끝날 때까지)를 답했을 때 호출한다. ' +
      'Codex/Claude의 예상 작업시간이 아니라 사용자가 쓰고 싶은 Side Quest 시간 예산이다. ' +
      '이 시간을 강제 타이머로 쓰지 않는다 — Codex/Claude가 먼저 끝나면(DONE/NEEDS_INPUT) ' +
      '그 즉시 알림이 우선한다. 호출하면 그 시간에 맞는 로컬 Side Quest 1~3개를 반환한다.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: '[AI Side Quest] 지시문에서 알려준 세션 id를 그대로 전달할 것 — 임의로 만들거나 생략하지 말 것.',
        },
        minutes: {
          type: 'string',
          description: `사용자가 고른 값. 다음 중 하나로 정규화해서 전달: ${BUDGET_OPTIONS_TEXT}`,
        },
      },
      required: ['minutes'],
    },
  },
  {
    name: 'sidequest_report_estimate',
    description:
      '작업을 시작할 때 이번 작업의 대략적인 규모를 보고한다. 마스코트 위젯이 이 값으로 ' +
      '기다리는 동안 할 퀘스트의 길이를 고른다. 사용자에게 소요시간을 말하는 용도가 아니다.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: '[AI Side Quest] 지시문에서 알려준 세션 id를 그대로 전달할 것.',
        },
        size: {
          type: 'string',
          enum: ['SHORT', 'MEDIUM', 'LONG'],
          description:
            'SHORT: 작은 수정·간단한 조사 (대략 2분 이내). MEDIUM: 여러 파일 수정, 테스트 실행 (대략 2~10분). ' +
            'LONG: 빌드, 대규모 리팩터링, 긴 조사·에이전트 작업 (대략 10분 이상).',
        },
        reason: { type: 'string', description: '한 줄 근거 (선택, 로컬 기록용).' },
      },
      required: ['sessionId', 'size'],
    },
  },
  {
    name: 'sidequest_get_state',
    description: '현재 추적 중인 모든 세션의 상태(WORKING/NEEDS_INPUT/DONE/FAILED)를 반환한다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sidequest_list_quests',
    description: '로컬 Side Quest 목록을 반환한다 (SHORT: 1~5분, MEDIUM: 5~15분, LONG: 15~30분).',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string', enum: ['SHORT', 'MEDIUM', 'LONG'], description: '생략하면 전체 목록' },
      },
    },
  },
  {
    name: 'sidequest_record_choice',
    description: '사용자가 고른 Side Quest를 로컬에 기록한다 (V2 개인화 추천을 위한 데이터, 전부 로컬 전용).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        bucket: { type: 'string', enum: ['SHORT', 'MEDIUM', 'LONG'] },
        questId: { type: 'string' },
      },
      required: ['bucket', 'questId'],
    },
  },
];

function textResult(text, isError) {
  return { content: [{ type: 'text', text }], isError: !!isError };
}

function callTool(name, args) {
  args = args || {};

  if (name === 'sidequest_report_event') {
    const result = state.reportEvent(args);
    // 10차: OS 알림은 없앴다 — 끝났다는 신호는 마스코트 위젯의 배너와 삐빅 소리로 준다.
    if (result.ignored) return textResult('(인식되지 않는 이벤트라 무시했어요)');

    if (result.transitioned && result.state === 'WORKING') {
      // 2026-09-18 실측 결과: mcp_tool 훅의 반환값은 UserPromptSubmit에서 실제로
      // 컨텍스트로 반영되지 않았다 (Claude Code 공식 문서는 plain-text stdout만
      // "Claude가 보고 행동할 수 있는 컨텍스트"라고 명시 — mcp_tool 반환값은 여기
      // 해당 안 되는 것으로 보임). 그래서 UserPromptSubmit은 command 핸들러
      // (setup/claude-userprompt-relay.js)로 옮겼고, 거기서 lib/working-prompt.js의
      // 같은 문구를 stdout으로 직접 찍는다. 이 tools/call 경로로도 같은 문구를 주긴
      // 하지만, 실제로 컨텍스트에 반영되는 건 relay 스크립트 쪽이다 — 자세한 내용은
      // architecture-research.md 참고.
      // 9차: 지연 팝업은 네이티브 마스코트 앱이 한다 (setup/claude-userprompt-relay.js 참고).
      if (process.env.SIDE_QUEST_SAFARI_POPUP === '1') {
        scheduleSidebar(result.sessionId, result.startedAt, result.turnSeq);
      }
      return textResult(buildWorkingInstruction(result.sessionId));
    }

    const suffix = result.transitioned ? ' (상태 변경됨)' : '';
    return textResult(`상태: ${result.state}${suffix}`);
  }

  if (name === 'sidequest_select_time_budget') {
    const { key, quests } = pickQuests(args.minutes);
    if (!key) {
      return textResult(
        `"${args.minutes}"를 ${BUDGET_OPTIONS_TEXT} 중 하나로 이해하지 못했어요. 다시 물어봐줘.`,
        true
      );
    }
    state.recordTimeBudget({ sessionId: args.sessionId, key, quests });
    if (!quests.length) return textResult('추천할 Side Quest가 없어요 (퀘스트 목록이 비어있음).');
    return textResult(
      `${key === 'UNTIL_DONE' ? '끝날 때까지' : key + '분'}짜리 퀘스트예요!\n` +
        formatQuestLines(quests)
    );
  }

  if (name === 'sidequest_report_estimate') {
    const size = normalizeSize(args.size);
    if (!size) return textResult('size는 SHORT / MEDIUM / LONG 중 하나여야 해요.', true);
    const { ok } = state.recordEstimate({ sessionId: args.sessionId, size, reason: args.reason });
    return textResult(ok ? 'ok' : '(진행 중인 세션이 아니라 무시했어요)');
  }

  if (name === 'sidequest_get_state') {
    return textResult(JSON.stringify(state.getState(), null, 2));
  }

  if (name === 'sidequest_list_quests') {
    return textResult(JSON.stringify(state.listQuests(args.bucket), null, 2));
  }

  if (name === 'sidequest_record_choice') {
    if (!args.bucket || !args.questId) return textResult('bucket과 questId가 필요해요.', true);
    state.recordChoice(args);
    return textResult('기록했어요.');
  }

  return textResult(`Unknown tool: ${name}`, true);
}

// ---- minimal JSON-RPC 2.0 over stdio ----

const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return; // ignore malformed lines rather than crashing the server
  }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'ai-side-quest', version: '0.1.0' },
        },
      });
      return;
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return; // notification, no response expected
    }

    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      send({ jsonrpc: '2.0', id, result: callTool(name, args) });
      return;
    }

    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    // We don't offer resources/prompts, but answer gracefully if a client
    // asks anyway rather than erroring the whole connection.
    if (method === 'resources/list') {
      send({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    }
    if (method === 'prompts/list') {
      send({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return;
    }

    if (!isNotification) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    if (!isNotification) {
      send({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
    }
  }
});

// Bonus, best-effort: also serve the local quest-picker page over HTTP.
// Safe to fail (e.g. a sibling instance already bound the port) — see
// mcp/quest-http.js for details.
try {
  require('./quest-http').start();
} catch (err) {
  // non-fatal
}
