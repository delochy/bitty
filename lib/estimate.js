'use strict';

/**
 * 작업 규모 예상 → 추천 퀘스트 단계 (9차, 2026-09-18).
 *
 * 두 신호 중 더 긴 쪽을 쓴다:
 *  1) Claude가 작업 시작 때 sidequest_report_estimate로 보고한 규모
 *     (SHORT/MEDIUM/LONG) — 작업 내용을 알고 하는 판단이라 초반에 유리.
 *  2) 실제로 흐른 시간 — 예상이 틀려도 길어지면 자동으로 단계를 올린다.
 *
 * 화면엔 분 단위 숫자를 절대 보여주지 않는다 ("좀 걸릴 것 같아요" 수준).
 * 숫자가 틀리면 신뢰가 깨지기 때문 (2026-09-18 결정).
 */

const LEVELS = ['SHORT', 'MEDIUM', 'LONG'];

// 흐른 시간이 이 이상이면 최소 이 단계로 본다.
const ELAPSED_LEVELS = [
  { minMs: 10 * 60 * 1000, level: 'LONG' },
  { minMs: 3 * 60 * 1000, level: 'MEDIUM' },
];

// 단계별로 섞어서 뽑을 퀘스트 버킷 (lib/quests.json의 최상위 키).
const LEVEL_BUCKETS = {
  SHORT: ['SHORT'],
  MEDIUM: ['SHORT', 'MEDIUM'],
  LONG: ['MEDIUM', 'LONG'],
};

const HEADLINES = {
  SHORT: '금방 끝날 것 같아요',
  MEDIUM: '좀 걸릴 것 같아요 ⏳',
  LONG: '꽤 오래 걸릴 것 같아요 ⏳',
};

function rank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

function normalizeSize(input) {
  const s = String(input || '').trim().toUpperCase();
  return LEVELS.includes(s) ? s : null;
}

function levelFromElapsed(ms) {
  for (const { minMs, level } of ELAPSED_LEVELS) {
    if (ms >= minMs) return level;
  }
  return 'SHORT';
}

/**
 * 세션 레코드(state.json의 sessions[sid])로 지금 보여줄 단계를 계산한다.
 * rec이 없으면(진행 중인 작업이 없으면) null.
 */
function effectiveLevel(rec, now = Date.now()) {
  if (!rec || rec.state !== 'WORKING' || !rec.startedAt) return null;
  const estimated = rec.estimate ? normalizeSize(rec.estimate.size) : null;
  const byElapsed = levelFromElapsed(now - rec.startedAt);
  const level = rank(byElapsed) > rank(estimated || 'SHORT') ? byElapsed : estimated || byElapsed;
  const escalated = Boolean(estimated) && rank(byElapsed) > rank(estimated);
  return { level, estimated, escalated };
}

const HEADLINES_EN = {
  SHORT: 'Should be done soon',
  MEDIUM: 'This might take a bit ⏳',
  LONG: 'This will take a while ⏳',
};

// 17차: lang = 'ko' | 'en'
function headlineFor(info, lang = 'ko') {
  const en = lang === 'en';
  if (!info) return en ? 'Nothing running right now' : '지금은 쉬는 중이에요';
  if (info.escalated) return en ? 'Taking longer than expected ⏳' : '생각보다 길어지고 있어요 ⏳';
  if (!info.estimated) return en ? 'Your AI is still working ⏳' : '작업이 길어지고 있어요 ⏳';
  return (en ? HEADLINES_EN : HEADLINES)[info.level];
}

module.exports = { LEVELS, LEVEL_BUCKETS, normalizeSize, levelFromElapsed, effectiveLevel, headlineFor };
