// Idle Buddy — 이어하기 (14차)
//
// 작업이 끝나면 마스코트 창이 사라지는데, 하던 게임·장보기는 그대로 두고 싶다는 요청.
// 각 페이지가 진행 상황을 이 창(위젯)의 localStorage에 저장하고, 마지막으로 하던 것을
// 'idle-last-game'에 적어둔다. 다음에 마스코트가 뜨면 추천 화면이 이걸 보고
// "▶ 하던 ○○ 이어서 하기" 버튼을 보여준다.
(function () {
  const LAST = 'idle-last-game';
  const key = (id) => 'idle-save-' + id;
  const read = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch (e) {
      return null;
    }
  };
  window.IdleSave = {
    load(id) {
      return read(key(id));
    },
    // data를 저장하고, 이 페이지를 "하던 것"으로 표시한다.
    save(id, data, label) {
      try {
        if (data !== undefined) localStorage.setItem(key(id), JSON.stringify(data));
        localStorage.setItem(LAST, JSON.stringify({ id, label, path: location.pathname, at: Date.now() }));
      } catch (e) {}
    },
    // 끝난 게임은 지우고, "하던 것" 표시도 그 게임이면 지운다.
    clear(id) {
      try {
        localStorage.removeItem(key(id));
        const last = read(LAST);
        if (last && last.id === id) localStorage.removeItem(LAST);
      } catch (e) {}
    },
  };
})();
