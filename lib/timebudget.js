'use strict';

/**
 * Time-budget → quest bucket mapping (product decision, 2026-09-18).
 *
 * IMPORTANT: these are NOT AI work-time estimates. The user picks how long
 * THEY want to play a quest while waiting (boredom relief, not "going away"); Codex/Claude's actual completion time is unrelated
 * and always wins (see lib/state.js — a DONE/NEEDS_INPUT transition fires
 * immediately regardless of the chosen time budget, there is no timer that
 * forces a quest to run its full length).
 */

const QUESTS = require('./quests.json');

// 5 / 10 / 20 minutes, or "UNTIL_DONE" (끝날 때까지 — no time pressure at all).
const BUDGET_OPTIONS = [
  { key: '5', minutes: 5, label: '5분' },
  { key: '10', minutes: 10, label: '10분' },
  { key: '20', minutes: 20, label: '20분' },
  { key: 'UNTIL_DONE', minutes: null, label: '끝날 때까지' },
];

// Which quest buckets to draw from for each choice. 5min stays light (SHORT
// only); 20min and "끝날 때까지" lean into MEDIUM/LONG since there's no rush.
const BUCKET_MAP = {
  5: ['SHORT'],
  10: ['SHORT', 'MEDIUM'],
  20: ['MEDIUM', 'LONG'],
  UNTIL_DONE: ['SHORT', 'MEDIUM', 'LONG'],
};

function normalizeKey(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toUpperCase();
  if (s === 'UNTIL_DONE' || s === '끝날때까지' || s === '끝날 때까지' || s === 'DONE') return 'UNTIL_DONE';
  const n = parseInt(s, 10);
  if (n === 5 || n === 10 || n === 20) return String(n);
  // be forgiving about anything close to the three fixed options
  if (!Number.isNaN(n)) {
    if (n <= 7) return '5';
    if (n <= 15) return '10';
    return '20';
  }
  return null;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Returns 1-3 quest suggestions for a given time-budget key ('5'|'10'|'20'|'UNTIL_DONE').
 * Never the whole list — the brief's "잔소리 금지" rule.
 */
function pickQuests(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) return { key: null, quests: [] };

  return { key, quests: pickQuestsFromBuckets(BUCKET_MAP[key] || ['MEDIUM']) };
}

function pickQuestsFromBuckets(buckets, limit = 3) {
  // Tag each quest with its source bucket (quests.json itself doesn't carry
  // one — items are just grouped by top-level key) so callers like the
  // sidebar page can still record which bucket a choice came from.
  const pool = buckets.flatMap((b) => (QUESTS[b] || []).map((q) => ({ ...q, bucket: b })));
  return shuffle(pool).slice(0, limit);
}

module.exports = { BUDGET_OPTIONS, BUCKET_MAP, normalizeKey, pickQuests, pickQuestsFromBuckets };
