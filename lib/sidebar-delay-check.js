#!/usr/bin/env node
'use strict';

/**
 * Entry point for the detached "30초 넘게 걸리면 그때만 뜬다" delay check
 * (2026-09-18, 5차 추가 요청). Spawned by lib/sidebar.js's scheduleSidebar()
 * as a detached, unref'd child process — it has to be a SEPARATE process
 * because the hook script that triggers WORKING (setup/claude-userprompt-
 * relay.js) exits immediately after printing its stdout (Claude Code hooks
 * don't stay alive), so an in-process setTimeout there would never fire.
 *
 * Sleeps `delayMs`, then re-reads the shared data/state.json. Only pops the
 * sidebar if the SAME turn is still WORKING — matched by sessionId +
 * turnSeq (a counter incremented on every WORKING transition for that
 * session, lib/state.js), so a stale timer from an earlier prompt in the
 * same session (or a session that already finished and started a new turn)
 * never fires for the wrong turn. (Local testing found that startedAt alone
 * — millisecond timestamps — can collide when two turns happen very close
 * together, so turnSeq is the authoritative check; startedAt is kept as a
 * secondary sanity check.)
 *
 * argv: [sessionId, startedAt, turnSeq, delayMs]
 */

const [, , sessionId, startedAtArg, turnSeqArg, delayMsArg] = process.argv;
const delayMs = Number(delayMsArg) || 30000;

setTimeout(() => {
  try {
    const state = require('./state');
    const { showSidebar } = require('./sidebar');
    const sessions = state.getState().sessions || {};
    const rec = sessions[sessionId];
    const sameTurn =
      rec &&
      rec.state === 'WORKING' &&
      String(rec.turnSeq) === String(turnSeqArg) &&
      String(rec.startedAt) === String(startedAtArg);
    if (sameTurn) {
      showSidebar();
    }
    // else: turn already finished (DONE/NEEDS_INPUT) or moved on to a new
    // prompt before 30s — intentionally silent, no popup needed.
  } catch (err) {
    // best-effort background job — never worth surfacing an error for
  }
  process.exit(0);
}, delayMs);
