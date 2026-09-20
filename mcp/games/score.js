// Idle Buddy — 게임별 기록 (18차)
//
// 각 게임이 한 판 끝날 때 IdleScore.add()를 부르면, 판수·최고·평균·마지막 기록이
// 이 창(localStorage)에 쌓인다. 🏆 게임 기록 화면(/games/stats)이 이걸 읽어서 보여준다.
//   kind: 'high' = 점수가 높을수록 좋음 (2048, 스네이크…)
//         'low'  = 낮을수록 좋음 (반응속도 ms, 짝 맞추기 시도 횟수, 스도쿠 시간)
(function () {
  const KEY = 'idle-scores';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  };
  const write = (all) => {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  };
  window.IdleScore = {
    all: read,
    /** 한 판 끝. value가 없으면 판수만 올린다 (예: 지뢰찾기에서 졌을 때). */
    add(game, value, kind) {
      const all = read();
      const r = (all[game] = all[game] || { plays: 0, sum: 0, count: 0, best: null, last: null, at: 0, kind });
      r.kind = kind || r.kind || 'high';
      r.plays += 1;
      r.at = Date.now();
      if (typeof value === 'number' && isFinite(value)) {
        r.last = value;
        r.sum += value;
        r.count += 1;
        const better = r.kind === 'low' ? r.best === null || value < r.best : r.best === null || value > r.best;
        if (better) r.best = value;
      }
      write(all);
    },
    /** 승/무/패처럼 세는 기록 (틱택토). */
    tally(game, key) {
      const all = read();
      const r = (all[game] = all[game] || { plays: 0, sum: 0, count: 0, best: null, last: null, at: 0, kind: 'tally' });
      r.kind = 'tally';
      r.tally = r.tally || {};
      r.tally[key] = (r.tally[key] || 0) + 1;
      r.plays += 1;
      r.at = Date.now();
      write(all);
    },
  };
})();
