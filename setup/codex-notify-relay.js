#!/usr/bin/env node
'use strict';

/**
 * Registered as Codex's `notify` target (see setup/install-codex.js):
 *   notify = ["node", "<abs path to this file>"]
 *
 * This is the RELIABLE half of the Codex integration — `notify` is the
 * stable, documented mechanism and currently fires on `agent-turn-complete`.
 * It updates the same shared state file the MCP server uses (lib/state.js)
 * directly — no HTTP hop needed, since this always runs as a short-lived
 * local process anyway.
 *
 * Codex invokes this with the event JSON as the last CLI argument (observed
 * behavior of existing notify-based community tools). As a fallback in case
 * a given Codex version instead writes to stdin, this also reads stdin if
 * no argv payload is present.
 *
 * Must never throw / exit non-zero in a way that could disrupt Codex, so
 * every failure path is swallowed.
 */

const state = require('../lib/state');

function handle(payloadText) {
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (err) {
    return;
  }

  const event = payload.type || payload.event;
  if (!event) return;

  const sessionId = payload['thread-id'] || payload.thread_id || payload.session_id;

  try {
    const result = state.reportEvent({ source: 'codex-notify', event, sessionId, raw: payload });
    // 10차: OS 알림은 없앴다 — 끝났다는 신호는 마스코트 위젯의 배너와 삐빅 소리로 준다.
  } catch (err) {
    // swallow — this must never break Codex
  }
}

const argvPayload = process.argv.slice(2).join(' ').trim();

if (argvPayload) {
  handle(argvPayload);
} else {
  let chunks = '';
  process.stdin.on('data', (c) => (chunks += c));
  process.stdin.on('end', () => {
    if (chunks.trim()) handle(chunks.trim());
  });
  // Don't hang if nothing arrives on stdin.
  setTimeout(() => process.exit(0), 1500);
}
