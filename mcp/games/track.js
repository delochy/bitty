// Idle Buddy — 게임·휴식 페이지에 머문 시간 기록 (16차)
// 마스코트 경험치와 "오늘의 기다림 리포트"의 "많이 한 것"에 쓴다. 창이 숨겨진 동안은
// 세지 않는다 (숨길 때 위젯 앱이 window.__idleHidden = true 로 표시한다).
(function () {
  const m = location.pathname.match(/^\/games\/([a-z0-9-]+)$/);
  if (!m) return;
  const id = m[1];
  setInterval(() => {
    if (window.__idleHidden) return;
    fetch('/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: id, seconds: 10 }),
    }).catch(() => {});
  }, 10000);
})();
