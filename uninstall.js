#!/usr/bin/env node
'use strict';

/**
 * AI Side Quest 제거 — install.sh가 한 일을 되돌린다.
 *   - ~/.claude/settings.json 에서 우리 훅과 (우리가 설치한) statusLine 제거
 *   - Claude Code / Codex 에서 MCP 서버 'ai-side-quest' 등록 해제
 *   - ~/.codex/hooks.json 에서 우리 훅 제거, config.toml의 notify가 우리 것이면 제거
 *   - 마스코트 위젯 종료 + ~/Applications 에서 삭제
 * 바꾸는 파일은 먼저 .bak-<시간> 으로 백업한다. 저장소 폴더와 data/ 기록은 건드리지 않는다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SERVER_NAME = 'ai-side-quest';
const MARKERS = ['claude-userprompt-relay.js', 'statusline.js', 'codex-hook-relay.js', 'codex-notify-relay.js'];

function backup(file) {
  const b = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, b);
  return b;
}

function isOurs(h) {
  if (!h) return false;
  if (h.type === 'mcp_tool' && h.server === SERVER_NAME) return true;
  return typeof h.command === 'string' && MARKERS.some((m) => h.command.includes(m));
}

function stripHooks(config) {
  let changed = false;
  for (const [evt, groups] of Object.entries(config.hooks || {})) {
    const kept = [];
    for (const g of groups) {
      const hooks = (g.hooks || []).filter((h) => !isOurs(h));
      if (hooks.length !== (g.hooks || []).length) changed = true;
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) config.hooks[evt] = kept;
    else delete config.hooks[evt];
  }
  if (config.hooks && !Object.keys(config.hooks).length) delete config.hooks;
  return changed;
}

function editJson(file, fn) {
  if (!fs.existsSync(file)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`${file} 을 읽지 못해서 건너뛰었어요.`);
    return;
  }
  if (fn(data)) {
    const b = backup(file);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    console.log(`✓ ${file} 정리 (백업: ${b})`);
  }
}

function tryRun(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// Claude Code
editJson(path.join(os.homedir(), '.claude', 'settings.json'), (s) => {
  let changed = stripHooks(s);
  if (s.statusLine && isOurs(s.statusLine)) {
    delete s.statusLine;
    changed = true;
  }
  return changed;
});
if (tryRun('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']) || tryRun('claude', ['mcp', 'remove', SERVER_NAME])) {
  console.log('✓ Claude Code MCP 서버 등록 해제');
}

// Codex
const codexDir = path.join(os.homedir(), '.codex');
editJson(path.join(codexDir, 'hooks.json'), stripHooks);
const tomlPath = path.join(codexDir, 'config.toml');
if (fs.existsSync(tomlPath)) {
  const text = fs.readFileSync(tomlPath, 'utf8');
  const next = text.replace(/^notify\s*=.*codex-notify-relay\.js.*\n?/m, '');
  if (next !== text) {
    const b = backup(tomlPath);
    fs.writeFileSync(tomlPath, next);
    console.log(`✓ ${tomlPath} 의 notify 제거 (백업: ${b})`);
  }
}
if (tryRun('codex', ['mcp', 'remove', SERVER_NAME])) console.log('✓ Codex MCP 서버 등록 해제');

// 마스코트 위젯
tryRun('pkill', ['-f', 'AI Side Quest Mascot.app']);
tryRun('pkill', ['-f', 'side-quest-daemon.js']);
const appDir = process.env.AI_SIDE_QUEST_APP_DIR || path.join(os.homedir(), 'Applications');
const app = path.join(appDir, 'AI Side Quest Mascot.app');
if (fs.existsSync(app)) {
  fs.rmSync(app, { recursive: true, force: true });
  console.log(`✓ ${app} 삭제`);
}

console.log('\n제거 완료. 실행 중인 Claude Code / Codex 세션을 새로 열면 적용돼요.');
