#!/usr/bin/env node
'use strict';

/**
 * AI Side Quest — 로컬 위젯 서버 데몬 (8차, 2026-09-18)
 *
 * 배경: 사용자가 실제로 쓰는 화면은 Claude 데스크톱 앱의 채팅 화면이고,
 * 거기엔 Claude Code CLI 같은 공식 hooks가 없다는 게 확인됐다
 * (architecture-research.md 8차, GitHub anthropics/claude-code#92288).
 * 그래서 자동 감지/자동 팝업은 포기하고, 마스코트를 수동으로 켜고 끄는
 * 네이티브 위젯 앱(native-widget/)으로 방향을 바꿨다.
 *
 * 근데 그 위젯이 보여줄 내용(마스코트+시간예산+퀘스트, mcp/quest-http.js)은
 * 원래 Claude Code CLI가 MCP 서버(mcp/server.js)를 stdio로 띄울 때만
 * 같이 떠 있었다 — 사용자가 CLI를 안 쓰면 그 로컬 HTTP 서버 자체가 아예 안
 * 뜬다는 뜻. 이 스크립트는 그 문제를 풀기 위해 딱 HTTP 서버만 독립적으로
 * 띄운다 — MCP stdio JSON-RPC 프로토콜은 전혀 안 한다.
 *
 * native-widget(Tauri 앱)이 시작될 때 이 스크립트를 자식 프로세스로 띄운다.
 * 포트가 이미 사용 중이면(예: Claude Code CLI를 그날 따로 켰으면)
 * mcp/quest-http.js가 EADDRINUSE를 조용히 무시하도록 이미 만들어져 있어서
 * 여러 프로세스가 동시에 떠도 안전하다 — 상태는 공유 파일(data/state.json)로
 * 맞춰진다.
 */

require('../mcp/quest-http').start();

// 데몬이라 그냥 살아있기만 하면 된다. Tauri 앱이 종료되면 이 자식
// 프로세스도 같이 정리되는 게 이상적이지만(부모-자식 관계), 혹시 고아
// 프로세스로 남더라도 로컬 HTTP 서버만 떠 있는 것뿐이라 위험하지 않다.
setInterval(() => {}, 1 << 30);
