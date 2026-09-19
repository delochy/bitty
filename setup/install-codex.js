#!/usr/bin/env node
'use strict';

/**
 * Configures Codex CLI three ways:
 *
 * 1) Registers the AI Side Quest MCP server via `codex mcp add` (official
 *    CLI path, no config.toml surgery needed for this part).
 * 2) `command` hooks in ~/.codex/hooks.json → setup/codex-hook-relay.js, for
 *    WORKING (UserPromptSubmit, PreToolUse) / NEEDS_INPUT (PermissionRequest) / DONE (Stop).
 *    13차: 예전엔 mcp_tool 핸들러였는데 실제로 이벤트가 안 들어와서, Claude
 *    쪽과 같은 command 방식으로 바꿨다. Codex는 새 훅을 처음 한 번 사용자가
 *    승인(신뢰)해야 실행할 수 있다.
 * 3) `notify` in ~/.codex/config.toml — 완료 신호 보조 경로. notify는 한
 *    프로그램만 걸 수 있어서, 이미 다른 게 걸려 있으면 덮어쓰지 않는다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SERVER_NAME = 'ai-side-quest';
const mcpServerPath = path.join(__dirname, '..', 'mcp', 'server.js');
const relayPath = path.join(__dirname, 'codex-notify-relay.js');
const hookRelayPath = path.join(__dirname, 'codex-hook-relay.js');
const codexDir = path.join(os.homedir(), '.codex');
const configPath = path.join(codexDir, 'config.toml');
const hooksPath = path.join(codexDir, 'hooks.json');

function backup(file) {
  if (fs.existsSync(file)) {
    const b = `${file}.bak-${Date.now()}`;
    fs.copyFileSync(file, b);
    console.log(`Backed up ${file} -> ${b}`);
  }
}

function registerMcpServer() {
  try {
    execFileSync('codex', ['--version'], { stdio: 'ignore' });
  } catch (err) {
    console.warn(
      "'codex' CLI를 찾지 못했어요. Codex CLI가 설치된 환경에서 아래 명령을 직접 실행해주세요:\n" +
        `  codex mcp add ${SERVER_NAME} -- node ${JSON.stringify(mcpServerPath)}`
    );
    return;
  }

  try {
    const out = execFileSync('codex', ['mcp', 'add', SERVER_NAME, '--', 'node', mcpServerPath], {
      encoding: 'utf8',
    });
    console.log(out.trim() || `Registered MCP server '${SERVER_NAME}' with Codex.`);
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    console.warn(
      `'codex mcp add' failed (아마 이미 등록되어 있을 수 있어요). 출력:\n${output.trim() || err.message}`
    );
  }
}

function installNotify() {
  fs.mkdirSync(codexDir, { recursive: true });
  let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const line = `notify = ["node", ${JSON.stringify(relayPath)}]`;

  if (/^notify\s*=.*$/m.test(text)) {
    if (text.includes(relayPath)) {
      console.log('Codex notify already points at the Side Quest relay — nothing changed.');
    } else {
      // 다른 도구가 이미 notify를 쓰고 있다 — 덮어쓰지 않는다. 완료 신호는 Stop 훅으로도 받는다.
      console.log('Codex notify is already used by another tool — left it alone (Stop hook covers DONE).');
    }
    return;
  } else {
    backup(configPath);
    text = (text.trimEnd() + (text.trim() ? '\n\n' : '') + line + '\n').trimStart();
  }
  fs.writeFileSync(configPath, text);
  console.log(`Configured Codex notify in ${configPath}`);
}

function commandHook() {
  return {
    matcher: '',
    // process.execPath: 설치할 때 쓴 node의 절대 경로 — Codex 앱의 PATH에 node가 없어도 동작하게.
    hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookRelayPath)}` }],
  };
}

// 예전 mcp_tool 방식으로 설치된 것도 우리 것으로 보고 교체한다.
function isOurHookGroup(group) {
  return (group.hooks || []).some(
    (h) =>
      (h.type === 'mcp_tool' && h.server === SERVER_NAME && h.tool === 'sidequest_report_event') ||
      (h.type === 'command' && typeof h.command === 'string' && h.command.includes('codex-hook-relay.js'))
  );
}

// Update-safe: replaces any previously-installed group for this server/tool
// instead of skipping when one exists, so re-running after a code change
// actually picks up the new template (see install-claude.js for the same fix).
function ensureHookEntry(hooksConfig, eventName) {
  hooksConfig.hooks = hooksConfig.hooks || {};
  hooksConfig.hooks[eventName] = hooksConfig.hooks[eventName] || [];
  const before = JSON.stringify(hooksConfig.hooks[eventName]);
  hooksConfig.hooks[eventName] = hooksConfig.hooks[eventName].filter((group) => !isOurHookGroup(group));
  hooksConfig.hooks[eventName].push(commandHook());
  return JSON.stringify(hooksConfig.hooks[eventName]) !== before;
}

function installHooks() {
  let hooksConfig = {};
  if (fs.existsSync(hooksPath)) {
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    } catch (err) {
      console.warn(`Could not parse ${hooksPath} — skipping hooks install.`);
      return;
    }
  }

  let changed = false;
  // PreToolUse: 데스크톱 앱에서 UserPromptSubmit이 빠지는 턴도 작업 중으로 잡기 위해 (lib/state.js 참고)
  for (const evt of ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop']) {
    if (ensureHookEntry(hooksConfig, evt)) changed = true;
  }

  if (changed) {
    backup(hooksPath);
    fs.writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2) + '\n');
    console.log(`Installed Codex hooks into ${hooksPath}.`);
    console.log('⚠️  Codex는 새 훅을 신뢰해줘야 실행해요 — 터미널에서 `codex`를 한 번 실행해 "Hooks need review" 화면에서 Trust all and continue를 고르세요.');
  } else {
    console.log('Codex hooks already present — nothing changed.');
  }
}

function main() {
  registerMcpServer();
  try {
    installHooks();
  } catch (err) {
    console.warn('Skipping Codex hooks install:', err.message);
  }
  installNotify();
  console.log('\nRestart Codex CLI sessions for the changes to take effect.');
}

main();
