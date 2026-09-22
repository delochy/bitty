// Bitty — 카드를 잡아 창 옮기기 (18차)
//
// 버튼·링크·입력칸·게임판처럼 "누르는 것"만 빼고, 카드 안 어디를 잡아도 창이 따라온다.
// 3px 넘게 움직여야 이동으로 보기 때문에, 마스코트를 그냥 누르면 쓰다듬기처럼 원래
// 동작이 그대로 된다.
// (Tauri가 로컬 주소로 띄운 페이지에는 드래그 감지가 자동으로 붙지 않고, 기본 창 이동
//  명령은 실제 마우스 입력에서만 동작해서 창 위치를 직접 옮기는 방식으로 만들었다.)
(function () {
  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== 'function') return;
  // 이 안에서 시작한 누름은 드래그로 보지 않는다
  const INTERACTIVE = 'a, button, input, textarea, select, canvas, label, [contenteditable], [data-no-drag], .quest, .item, .cell, .cardx, .sq, .c, .hole, .tile, .pad, .grid, .board, .field';
  const THRESHOLD = 3;
  let origin = null; // { dx, dy, x0, y0 } — 창 안에서의 커서 위치와 시작 지점
  let moving = false;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const el = e.target;
    if (el instanceof Element && el.closest(INTERACTIVE)) return;
    origin = { dx: e.clientX, dy: e.clientY, x0: e.screenX, y0: e.screenY };
    moving = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!origin) return;
    if (!moving) {
      if (Math.abs(e.screenX - origin.x0) < THRESHOLD && Math.abs(e.screenY - origin.y0) < THRESHOLD) return;
      moving = true;
      document.body.style.cursor = 'grabbing';
    }
    internals
      .invoke('plugin:window|set_position', {
        value: { Logical: { x: e.screenX - origin.dx, y: e.screenY - origin.dy } },
      })
      .catch(() => {});
  });

  const end = () => {
    origin = null;
    moving = false;
    document.body.style.cursor = '';
  };
  document.addEventListener('mouseup', end);
  document.addEventListener('mouseleave', end);
})();
