// Bitty — 게임·휴식 페이지에서 논 시간 기록 (16차)
// 마스코트 경험치와 "오늘의 기다림 리포트"의 "기다리면서 한 것"에 쓴다.
// 17차: 화면이 열려 있기만 한 시간은 세지 않는다 — 마지막으로 클릭·키 입력·스크롤한 뒤
// 90초 안일 때만 센다. 창이 숨겨진 동안도 세지 않는다 (위젯 앱이 window.__idleHidden을 켠다).
(function () {
  const m = location.pathname.match(/^\/games\/([a-z0-9-]+)$/);
  if (!m) return;
  const id = m[1];
  const ACTIVE_MS = 90 * 1000;
  let lastInput = 0;
  const mark = () => (lastInput = Date.now());
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, mark, { passive: true, capture: true }));
  setInterval(() => {
    if (window.__idleHidden || Date.now() - lastInput > ACTIVE_MS) return;
    fetch('/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: id, seconds: 10 }),
    }).catch(() => {});
  }, 10000);
})();
