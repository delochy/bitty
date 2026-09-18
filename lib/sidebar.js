'use strict';

/**
 * "오른쪽 사이드바에 저절로 뜨게" (2026-09-18, 4차 요청), 이후 "30초 넘게
 * 걸릴 때만, 마스코트처럼" (5차 요청)으로 다듬어졌다.
 *
 * Why AppleScript/Safari instead of Electron/Tauri: this session checked —
 * the sandboxed bridge has no working npm registry (403 Forbidden) and no
 * cargo/rustc, and there's no way to compile/test a native app bundle from
 * here at all (the remote-devices bridge runs commands in an isolated Linux
 * VM, not real macOS — it can't build or run a macOS GUI app either way).
 * `osascript` driving Safari is the only zero-new-dependency path: it's
 * already used for OS notifications (lib/notify.js, verified working), adds
 * no install step. It does NOT give a truly transparent/chromeless floating
 * mascot — that needs a native app shell (2단계, see architecture-
 * research.md) — so what ships here is a small widget-sized Safari window
 * (normal title bar) docked to the bottom-right corner, with a CSS mascot
 * drawn inside the page (mcp/quest-http.js).
 *
 * NEW PERMISSION SURFACE: the first time this runs, macOS will prompt for
 * "Automation" access (System Settings → Privacy & Security → Automation)
 * for whatever process runs node (Terminal, or Claude Code itself) to
 * control Safari.
 *
 * UNVERIFIED: written from documented Safari/AppleScript scripting-dictionary
 * patterns, but this session has no way to execute real macOS GUI scripting
 * to test it. Needs a live check on the user's Mac.
 */

const { execFile, spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = process.env.SIDE_QUEST_PORT ? Number(process.env.SIDE_QUEST_PORT) : 4317;
const WINDOW_MARKER = 'AI Side Quest'; // matches mcp/quest-http.js <title>, used to find/reuse our window
const WIDGET_WIDTH = 300;
const WIDGET_HEIGHT = 360;
const DEFAULT_DELAY_MS = process.env.SIDE_QUEST_SIDEBAR_DELAY_MS
  ? Number(process.env.SIDE_QUEST_SIDEBAR_DELAY_MS)
  : 30000; // 5차: "30초 이상 걸리면 그때만" — 즉답으로 끝나는 프롬프트엔 안 뜬다

function runOsa(script) {
  try {
    execFile('osascript', ['-e', script], (err) => {
      if (err) console.error('[side-quest] sidebar osascript failed:', err.message);
    });
  } catch (err) {
    console.error('[side-quest] sidebar failed to spawn osascript:', err.message);
  }
}

/**
 * Opens (or reuses + re-navigates) a small widget-sized Safari window
 * docked to the bottom-right corner of the main screen, showing the
 * mascot/quest page fresh. Best-effort only — must never throw or block
 * the caller. Called only after scheduleSidebar()'s 30s check passes — see
 * below — so calling this directly (as before 5차) would skip that delay.
 */
function showSidebar() {
  if (os.platform() !== 'darwin') return; // v1 macOS-only, same scope as lib/notify.js
  const url = `http://127.0.0.1:${PORT}/quest`;
  const script = `
    tell application "Safari"
      activate
      set targetWin to missing value
      repeat with w in windows
        try
          if name of w contains "${WINDOW_MARKER}" then
            set targetWin to w
            exit repeat
          end if
        end try
      end repeat
      if targetWin is missing value then
        set targetWin to make new document with properties {URL:"${url}"}
      else
        set URL of current tab of targetWin to "${url}"
      end if
      try
        tell application "Finder" to set screenBounds to bounds of window of desktop
        set screenW to item 3 of screenBounds
        set screenH to item 4 of screenBounds
        set bounds of targetWin to {screenW - ${WIDGET_WIDTH} - 20, screenH - ${WIDGET_HEIGHT} - 20, screenW - 20, screenH - 20}
      end try
    end tell
  `;
  runOsa(script);
}

/**
 * 5차: only pop the sidebar if the turn is STILL running `delayMs` later —
 * a quick prompt that finishes in a few seconds shouldn't flash a mascot on
 * screen and immediately have to say goodbye again (잔소리 금지 원칙).
 *
 * Spawns a detached, unref'd child process to do the actual waiting,
 * because the caller (a Claude Code hook script) exits right after this
 * returns — an in-process setTimeout here would never get to fire.
 * Best-effort: a failure to schedule just means no popup, never an error
 * that could block the hook.
 */
function scheduleSidebar(sessionId, startedAt, turnSeq, delayMs) {
  if (os.platform() !== 'darwin') return;
  if (!sessionId || !startedAt) return;
  try {
    const scriptPath = path.join(__dirname, 'sidebar-delay-check.js');
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        String(sessionId),
        String(startedAt),
        String(turnSeq),
        String(delayMs || DEFAULT_DELAY_MS),
      ],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
  } catch (err) {
    console.error('[side-quest] failed to schedule sidebar:', err.message);
  }
}

/**
 * Not called automatically today (see mcp/quest-http.js — the page already
 * polls /state and shows a "돌아갈 시간이에요" banner in place on DONE, so
 * closing the window isn't necessary and would risk yanking focus/losing
 * whatever the user was reading). Exported for manual/future use.
 */
function closeSidebar() {
  if (os.platform() !== 'darwin') return;
  const script = `
    tell application "Safari"
      repeat with w in windows
        try
          if name of w contains "${WINDOW_MARKER}" then close w
        end try
      end repeat
    end tell
  `;
  runOsa(script);
}

module.exports = { showSidebar, scheduleSidebar, closeSidebar };
