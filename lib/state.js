'use strict';

/**
 * Shared state store, used by both the MCP server (mcp/server.js) and the
 * Codex notify relay (setup/codex-notify-relay.js).
 *
 * Claude Code and Codex each spawn their OWN copy of the MCP server process
 * (stdio transport — one subprocess per connected client), so state can't
 * just live in memory. Instead every process reads/writes the same local
 * data/state.json file. This also means everything stays local-only, with
 * no server and no account, matching the product constraints.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const EVENTS_LOG = path.join(DATA_DIR, 'events.local.jsonl');
const CHOICES_LOG = path.join(DATA_DIR, 'choices.local.jsonl');
// V2(수동 측정)/V3(개인 ETA)를 대비한 실제 작업시간 기록. ETA 계산 로직은 아직
// 없다 — 여기엔 "나중에 계산할 수 있는 재료"만 쌓는다 (2026-09-18 개발 지시 4번).
const WORKLOG = path.join(DATA_DIR, 'worklog.local.jsonl');
const QUESTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'quests.json'), 'utf8'));

fs.mkdirSync(DATA_DIR, { recursive: true });

function appendJsonl(file, obj) {
  try {
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch (err) {
    console.error('[side-quest] failed to write log', file, err.message);
  }
}

const PROMPT_PREVIEW_MAX = 200;

/**
 * Best-effort, non-fatal extraction of a short preview of the user's last
 * prompt from a Claude Code transcript file (JSONL). Codex hook payloads
 * don't give us an equivalent path today, so this only ever fills in for
 * `source: "claude"`. Never throws — a parsing miss just means no preview,
 * not a broken hook call. Truncated hard at PROMPT_PREVIEW_MAX chars so we
 * never accidentally hoard a full prompt locally.
 */
function extractPromptPreview(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch (e) {
        continue;
      }
      if (entry.type !== 'user') continue;
      const msg = entry.message || entry;
      let text = null;
      if (typeof msg.content === 'string') text = msg.content;
      else if (Array.isArray(msg.content)) {
        const block = msg.content.find((c) => c && c.type === 'text' && c.text);
        if (block) text = block.text;
      }
      if (text) return text.slice(0, PROMPT_PREVIEW_MAX);
      break;
    }
  } catch (err) {
    return null; // best-effort only, e.g. file not found/unreadable
  }
  return null;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.sessions = parsed.sessions || {};
    return parsed;
  } catch (err) {
    return { sessions: {} };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[side-quest] failed to write state file', err.message);
  }
}

/**
 * Map a (source, event) pair to WORKING / NEEDS_INPUT / DONE / FAILED, or
 * null to ignore. `source` distinguishes where the event came from since
 * Claude Code and Codex use different event names for the same meaning.
 *
 *  - "claude":       Claude Code hooks (hook_event_name)
 *  - "codex-hook":   Codex's newer hooks system (mirrors Claude Code's names)
 *  - "codex-notify": Codex's `notify` config (kebab-case event types)
 */
function toQuestState(source, event) {
  if (source === 'claude') {
    if (event === 'UserPromptSubmit') return 'WORKING';
    if (event === 'Notification') return 'NEEDS_INPUT'; // idle_prompt / permission_prompt 등을 뭉뚱그림
    // 11차: SubagentStop은 서브에이전트 하나가 끝난 것뿐이고 메인 작업은 계속된다 —
    // DONE으로 보면 마스코트가 작업 도중에 사라진다. 메인 turn의 Stop만 DONE.
    if (event === 'Stop') return 'DONE';
    return null;
  }
  if (source === 'codex-hook') {
    if (event === 'UserPromptSubmit') return 'WORKING';
    // 17차: Codex 데스크톱 앱은 UserPromptSubmit이 잘 안 온다 (종료 536번 대비 시작 23번 —
    // 스스로 이어가는 턴, 진행 중에 보낸 메시지 등). 도구를 쓰기 직전 신호로도 작업 중을 잡는다.
    if (event === 'PreToolUse') return 'WORKING';
    if (event === 'PermissionRequest') return 'NEEDS_INPUT';
    if (event === 'Stop') return 'DONE';
    return null;
  }
  if (source === 'codex-notify') {
    if (event === 'agent-turn-complete') return 'DONE';
    if (event === 'agent-turn-failed' || event === 'turn-failed') return 'FAILED';
    return null;
  }
  return null;
}

const TERMINAL_STATES = new Set(['DONE', 'FAILED']);

/**
 * Record a lifecycle event and update that session's state.
 * `context` is optional, best-effort extra data passed in from the hook
 * (cwd, transcriptPath) — see the 2026-09-18 데이터 모델 조사: only fields
 * Codex/Claude officially expose end up here, nothing is guessed at.
 * Returns { ok, ignored?, sessionId, state, transitioned, workedMs? }.
 * `transitioned` tells the caller whether this is a NEW state (so it can
 * decide whether to fire an OS notification / ask the time-budget question,
 * avoiding repeat spam).
 */
function reportEvent({ source, event, sessionId, raw, context }) {
  const nextState = toQuestState(source, event);
  // Claude Code의 UserPromptSubmit command 훅은 프롬프트 원문을 stdin JSON으로
  // 바로 준다 (공식 문서 확인, 2026-09-18) — 그게 있으면 그대로 쓰고, 없으면
  // (예: mcp_tool 경로) transcript 파일에서 best-effort로 추출한다.
  let promptPreview = null;
  if (context && typeof context.prompt === 'string' && context.prompt) {
    promptPreview = context.prompt.slice(0, PROMPT_PREVIEW_MAX);
  } else if (context && context.transcriptPath) {
    promptPreview = extractPromptPreview(context.transcriptPath);
  }

  appendJsonl(EVENTS_LOG, {
    at: new Date().toISOString(),
    source,
    event,
    sessionId,
    nextState,
    cwd: (context && context.cwd) || undefined,
    raw,
  });

  if (!nextState) return { ok: true, ignored: true };

  const sid = sessionId || `${source}-default`;
  const state = loadState();
  const prev = state.sessions[sid];
  const prevState = prev ? prev.state : null;
  const transitioned = nextState !== prevState;
  const now = Date.now();

  const sessionRecord = {
    state: nextState,
    source,
    lastEvent: event,
    updatedAt: now,
    cwd: (context && context.cwd) || (prev && prev.cwd) || null,
    startedAt: prev && prev.startedAt ? prev.startedAt : null,
    timeBudget: prev ? prev.timeBudget : null,
    // 9차: Claude가 보고한 작업 규모 예상 (lib/estimate.js). 새 turn마다 리셋.
    estimate: prev ? prev.estimate || null : null,
    // 5차: 지연 사이드바 팝업이 "그 turn이 여전히 맞는지" 확인하는 용도.
    // startedAt(Date.now(), ms 단위)만으로는 같은 세션에서 turn이 아주
    // 빨리 연속되면(테스트에서 실측 — 같은 ms에 두 턴이 겹칠 수 있음)
    // 구분이 안 될 수 있어서, WORKING 전이마다 1씩 증가하는 카운터를 같이
    // 둔다. 실사용에서 두 턴이 1ms 안에 겹칠 일은 없지만 공짜로 더 안전해짐.
    turnSeq: prev ? prev.turnSeq || 0 : 0,
  };

  let workedMs = null;
  // 17차: Codex는 작업 하나를 여러 턴으로 끊어서 매 턴 끝에 Stop을 보낸다 (사용자 메시지 없이
  // 1~3분마다). Stop 직후 곧 다시 일을 시작하면 새 작업이 아니라 이어지는 같은 작업으로 본다.
  const CODEX_CONTINUE_MS = 60 * 1000;
  const continuing =
    nextState === 'WORKING' && transitioned && prev && prev.state === 'DONE' &&
    String(source).startsWith('codex') && now - (prev.updatedAt || 0) < CODEX_CONTINUE_MS;
  if (nextState === 'WORKING' && transitioned && !continuing) {
    sessionRecord.startedAt = now;
    sessionRecord.timeBudget = null; // 새 턴 시작이니 이전 선택은 리셋
    sessionRecord.estimate = null;
    sessionRecord.turnSeq = (sessionRecord.turnSeq || 0) + 1;
  }
  if (TERMINAL_STATES.has(nextState) && transitioned && sessionRecord.startedAt) {
    workedMs = now - sessionRecord.startedAt;
  }

  state.sessions[sid] = sessionRecord;
  saveState(state);

  if (transitioned) {
    // "나중에 계산할 수 있는 재료"만 쌓는다 — ETA 계산은 하지 않음 (V1 범위 밖).
    appendJsonl(WORKLOG, {
      at: new Date().toISOString(),
      sessionId: sid,
      source,
      event,
      state: nextState,
      cwd: sessionRecord.cwd,
      startedAt: sessionRecord.startedAt ? new Date(sessionRecord.startedAt).toISOString() : null,
      workedMs, // DONE/FAILED 전이 때만 채워짐 — 그 외엔 null
      promptPreview, // 확보 가능할 때만(현재는 Claude Code만), 최대 200자
      timeBudget: sessionRecord.timeBudget,
      // 9차: 나중에 지난 기록으로 예상을 보정할 수 있게, 예상 규모와 실제
      // workedMs를 같은 줄에 남긴다.
      estimate: sessionRecord.estimate ? sessionRecord.estimate.size : null,
    });
  }

  return {
    ok: true,
    sessionId: sid,
    state: nextState,
    transitioned,
    workedMs,
    promptPreview,
    startedAt: sessionRecord.startedAt,
    turnSeq: sessionRecord.turnSeq, // 5차: 지연 사이드바 팝업이 "그 turn이 맞는지" 확인하는 데 씀
  };
}

function getState() {
  return loadState();
}

/**
 * 20차: 작업 도중에 앱을 끄면 Stop 훅이 오지 않아서 세션이 WORKING으로 남는다
 * (Codex를 껐는데 위젯에 "Codex 작업 중"이 52분째 떠 있었다). 그 도구의 프로세스가
 * 아예 없으면 이 함수로 그 세션들을 끝난 것으로 정리한다. 프로세스 확인은 부르는
 * 쪽(quest-http.js)이 하고, 여기서는 source로 고르기만 한다.
 * 작업 시간은 마지막 이벤트까지로 잡는다 — 언제 꺼졌는지는 알 수 없어서.
 */
function endSessionsWhere(matchSource, reason) {
  const state = loadState();
  const ended = [];
  for (const [sid, rec] of Object.entries(state.sessions)) {
    if (!rec || TERMINAL_STATES.has(rec.state)) continue;
    if (!matchSource(String(rec.source || ''))) continue;
    const lastAt = rec.updatedAt || Date.now();
    const workedMs = rec.startedAt ? Math.max(0, lastAt - rec.startedAt) : null;
    state.sessions[sid] = { ...rec, state: 'DONE', lastEvent: reason, updatedAt: Date.now() };
    appendJsonl(WORKLOG, {
      at: new Date().toISOString(),
      sessionId: sid,
      source: rec.source,
      event: reason,
      state: 'DONE',
      cwd: rec.cwd,
      startedAt: rec.startedAt ? new Date(rec.startedAt).toISOString() : null,
      workedMs,
      promptPreview: null,
      timeBudget: rec.timeBudget,
      estimate: rec.estimate ? rec.estimate.size : null,
    });
    ended.push(sid);
  }
  if (ended.length) saveState(state);
  return ended;
}

/**
 * Sidebar UX (2026-09-18, 4차): the sidebar window needs to know which
 * session to attach a time-budget pick to, but it has no session_id of its
 * own (it's just a browser tab hitting our local HTTP server). Heuristic:
 * the most recently-started session currently in WORKING state. Good enough
 * for the product's real usage pattern (one person, one agent session at a
 * time) — if more than one is WORKING simultaneously we just pick the
 * newest, which is the one most likely to have just triggered the popup.
 */
function getActiveWorkingSessionId() {
  const state = loadState();
  let best = null;
  for (const [sid, rec] of Object.entries(state.sessions || {})) {
    if (rec.state !== 'WORKING') continue;
    if (!best || (rec.startedAt || 0) > (best.startedAt || 0)) {
      best = { sid, startedAt: rec.startedAt || 0 };
    }
  }
  return best ? best.sid : null;
}

function recordChoice({ sessionId, bucket, questId }) {
  appendJsonl(CHOICES_LOG, { at: new Date().toISOString(), sessionId, bucket, questId });
}

/**
 * Record the user's chosen time budget (5/10/20/UNTIL_DONE) for a session.
 * This is a time BUDGET the user wants to spend on a Side Quest, not an ETA
 * for Codex/Claude's work — see lib/timebudget.js.
 */
function recordTimeBudget({ sessionId, key, quests }) {
  const sid = sessionId || 'unknown-default';
  const state = loadState();
  if (state.sessions[sid]) {
    state.sessions[sid].timeBudget = key;
    saveState(state);
  }
  appendJsonl(CHOICES_LOG, {
    at: new Date().toISOString(),
    sessionId: sid,
    kind: 'time_budget',
    timeBudget: key,
    offeredQuests: (quests || []).map((q) => q.id),
  });
}

/**
 * 9차: Claude가 작업 시작 때 보고한 규모 예상(SHORT/MEDIUM/LONG)을 현재
 * turn에 붙인다. WORKING 중인 세션에만 붙인다 — 이미 끝난 turn에 늦게
 * 들어온 예상이 다음 turn으로 새지 않게.
 */
function recordEstimate({ sessionId, size, reason }) {
  const state = loadState();
  const rec = sessionId && state.sessions[sessionId];
  if (!rec || rec.state !== 'WORKING') return { ok: false };
  rec.estimate = { size, reason: reason ? String(reason).slice(0, 200) : null, at: Date.now() };
  saveState(state);
  appendJsonl(WORKLOG, {
    at: new Date().toISOString(),
    sessionId,
    kind: 'estimate',
    estimate: size,
    reason: rec.estimate.reason,
    turnSeq: rec.turnSeq,
  });
  return { ok: true };
}

function listQuests(bucket) {
  if (bucket && QUESTS[bucket]) return { [bucket]: QUESTS[bucket] };
  return QUESTS;
}

module.exports = {
  reportEvent,
  getState,
  endSessionsWhere,
  getActiveWorkingSessionId,
  recordChoice,
  recordTimeBudget,
  recordEstimate,
  listQuests,
  STATE_FILE,
  EVENTS_LOG,
  CHOICES_LOG,
  WORKLOG,
};
