#!/usr/bin/env node
'use strict';

/**
 * 1) Registers the AI Side Quest MCP server with Claude Code by shelling
 *    out to `claude mcp add` (the official, safe way — avoids hand-editing
 *    Claude Code's own state file).
 * 2) Merges `mcp_tool` hooks into ~/.claude/settings.json (global scope) so
 *    UserPromptSubmit / Notification / Stop / SubagentStop call the MCP
 *    server's sidequest_report_event tool directly. Non-destructive: backs
 *    up the existing file, skips any hook that's already registered.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SERVER_NAME = 'ai-side-quest';
const mcpServerPath = path.join(__dirname, '..', 'mcp', 'server.js');
const userPromptRelayPath = path.join(__dirname, 'claude-userprompt-relay.js');
const statusLinePath = path.join(__dirname, 'statusline.js');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
// statusLine.command에 이 문자열이 들어있으면 "우리가 설치한 statusLine"으로
// 인정한다 (마커). ~/.claude/settings.json은 이 세션의 device bridge에서
// 읽을 수 없는 폴더라(항상 non-grantable) 기존 statusLine이 사용자가 직접
// 설정한 다른 것(git 브랜치, 비용 표시 등)인지 여기서 미리 확인할 방법이
// 없다 — 그래서 이 안전장치는 실제로 사용자 macOS에서 이 스크립트가 실행될
// 때 동작해야 한다.
const STATUSLINE_MARKER = 'ai-side-quest';

function registerMcpServer() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
  } catch (err) {
    console.warn(
      "'claude' CLI를 찾지 못했어요. Claude Code가 설치된 환경에서 아래 명령을 직접 실행해주세요:\n" +
        `  claude mcp add ${SERVER_NAME} --scope user -- node ${JSON.stringify(mcpServerPath)}`
    );
    return;
  }

  try {
    const out = execFileSync(
      'claude',
      ['mcp', 'add', SERVER_NAME, '--scope', 'user', '--', 'node', mcpServerPath],
      { encoding: 'utf8' }
    );
    console.log(out.trim() || `Registered MCP server '${SERVER_NAME}' with Claude Code.`);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    console.warn(
      `'claude mcp add' failed (아마 이미 등록되어 있을 수 있어요). 출력:\n${output.trim() || err.message}`
    );
  }
}

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON — fix or remove it before running this installer.`);
  }
}

function mcpToolHook() {
  return {
    matcher: '',
    hooks: [
      {
        type: 'mcp_tool',
        server: SERVER_NAME,
        tool: 'sidequest_report_event',
        input: { source: 'claude', event: '${hook_event_name}', sessionId: '${session_id}' },
      },
    ],
  };
}

// UserPromptSubmit만 command 핸들러를 쓴다 — 2026-09-18 실측 결과, mcp_tool
// 훅의 반환값은 이 이벤트에서 실제로 Claude의 컨텍스트에 반영되지 않았다.
// Claude Code 공식 문서는 UserPromptSubmit에서 "plain-text stdout"만
// "Claude가 보고 행동할 수 있는 컨텍스트"가 된다고 명시하는데, 이건 command
// 핸들러 전용 경로다. setup/claude-userprompt-relay.js가 그 stdout을 찍는다.
function commandHook() {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: `node ${JSON.stringify(userPromptRelayPath)}`,
      },
    ],
  };
}

function isOurHookGroup(group) {
  return (group.hooks || []).some(
    (h) =>
      (h.type === 'mcp_tool' && h.server === SERVER_NAME && h.tool === 'sidequest_report_event') ||
      (h.type === 'command' && typeof h.command === 'string' && h.command.includes('claude-userprompt-relay.js'))
  );
}

// Update-safe: always REPLACES any previously-installed group for this
// server/tool with the current template, instead of skipping when one is
// already present. Otherwise re-running this installer after a code change
// (e.g. switching UserPromptSubmit to a command hook, 2026-09-18) would
// silently keep serving the stale hook definition forever.
function ensureHookEntry(settings, eventName, builder) {
  settings.hooks = settings.hooks || {};
  settings.hooks[eventName] = settings.hooks[eventName] || [];
  const before = JSON.stringify(settings.hooks[eventName]);
  settings.hooks[eventName] = settings.hooks[eventName].filter((group) => !isOurHookGroup(group));
  settings.hooks[eventName].push(builder());
  return JSON.stringify(settings.hooks[eventName]) !== before;
}

// 7차: "Claude Code 창 안에서 바로 뜨게" — 공식 statusLine 기능
// (code.claude.com/docs/en/statusline) 등록. 기존에 사용자가 다른
// statusLine(예: git 브랜치, 토큰 비용 표시 스크립트)을 이미 설정해뒀을 수
// 있으므로 절대 무조건 덮어쓰지 않는다:
//   - statusLine 필드가 아예 없으면 → 설치.
//   - 있는데 command에 STATUSLINE_MARKER가 포함되어 있으면(=우리가 이전에
//     설치한 것) → 최신 내용으로 갱신(경로가 바뀌었을 수 있으니).
//   - 있는데 다른 걸 가리키면(=사용자가 직접 설정한 것) → 절대 건드리지
//     않고 경고만 출력.
function statusLineConfig() {
  return {
    type: 'command',
    command: `node ${JSON.stringify(statusLinePath)}`,
    padding: 0,
    // 최소 1초 — 문서상 refreshInterval의 최솟값. 이 정도는 되어야 경과
    // 시간이 "살아있는" 느낌으로 째깍거린다. 너무 짧으면 불필요하게 자주
    // 스크립트를 재실행하니 2초로.
    refreshInterval: 2000,
  };
}

function installStatusLine(settings) {
  const existing = settings.statusLine;
  if (!existing) {
    settings.statusLine = statusLineConfig();
    return { changed: true, skipped: false };
  }
  const isOurs =
    existing && typeof existing.command === 'string' && existing.command.includes(STATUSLINE_MARKER);
  if (isOurs) {
    const before = JSON.stringify(existing);
    settings.statusLine = statusLineConfig();
    return { changed: JSON.stringify(settings.statusLine) !== before, skipped: false };
  }
  // 사용자가 이미 다른 statusLine을 쓰고 있음 — 절대 덮어쓰지 않는다.
  return { changed: false, skipped: true };
}

function installHooks() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = loadJson(settingsPath);

  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${Date.now()}`;
    fs.copyFileSync(settingsPath, backup);
    console.log(`Backed up existing settings to ${backup}`);
  }

  let changed = false;
  if (ensureHookEntry(settings, 'UserPromptSubmit', commandHook)) changed = true;
  for (const evt of ['Notification', 'Stop', 'SubagentStop']) {
    if (ensureHookEntry(settings, evt, mcpToolHook)) changed = true;
  }

  const statusLineResult = installStatusLine(settings);
  if (statusLineResult.changed) changed = true;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(
    changed
      ? `Installed AI Side Quest hooks into ${settingsPath} (UserPromptSubmit=command, others=mcp_tool)`
      : `AI Side Quest hooks already present in ${settingsPath} (nothing changed)`
  );

  if (statusLineResult.skipped) {
    console.warn(
      '\n⚠️  이미 다른 statusLine이 settings.json에 설정되어 있어서 건드리지 않았어요.\n' +
        '   AI Side Quest 상태줄(작업 중/입력 필요/완료 + 시간예산 선택 링크)을 Claude Code 창 안에\n' +
        '   보고 싶다면, 기존 statusLine 설정을 직접 지우거나 아래 내용으로 바꿔주세요:\n' +
        `   ${JSON.stringify(statusLineConfig(), null, 2).split('\n').join('\n   ')}\n` +
        '   (참고: statusLine을 켜면 Claude Code 자체 하단 힌트(esc to interrupt 등) 일부가 안 보여요.)'
    );
  } else if (statusLineResult.changed) {
    console.log(
      'Installed status line into settings.json — Claude Code 창 하단에 AI Side Quest 상태가 표시돼요.\n' +
        '(참고: statusLine을 켜면 Claude Code 자체 하단 힌트(esc to interrupt 등) 일부가 안 보여요. ' +
        '없애려면 /statusline delete)'
    );
  }
}

function main() {
  registerMcpServer();
  installHooks();
  console.log('\nRestart Claude Code sessions for the changes to take effect.');
}

main();
