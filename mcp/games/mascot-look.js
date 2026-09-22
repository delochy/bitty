// Idle Buddy — 마스코트 꾸미기 적용 (16차)
//
// 레벨·열린 아이템은 서버(/mascot, lib/stats.js)가 기록으로 계산하고, 뭘 입었는지는
// 이 창의 localStorage에 둔다. 추천 화면·꾸미기·리포트가 같이 쓴다.
(function () {
  const KEY = 'idle-mascot-equip';
  const css = document.createElement('style');
  css.textContent = `
    .mascot { background: var(--mascot-bg, linear-gradient(160deg, #7dd3fc, #6366f1)); }
    .mascot .acc { position: absolute; left: 50%; line-height: 1; pointer-events: none; }
    .mascot .acc-hat { top: -0.34em; font-size: 0.46em; transform: translateX(-50%) rotate(-8deg); }
    .mascot .acc-face { top: 0.24em; font-size: 0.5em; transform: translateX(-50%); }
    .lv { position: absolute; right: -14px; bottom: -4px; font-size: 10px; font-weight: 800; color: #fff;
          background: #111827; border-radius: 999px; padding: 1px 6px; font-family: -apple-system, sans-serif;
          text-decoration: none; cursor: pointer; transition: transform 0.15s, background 0.15s; }
    a.lv:hover { transform: scale(1.08); background: #6366f1; }
  `;
  document.head.appendChild(css);

  window.IdleMascot = {
    equip() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
    },
    setEquip(equip) {
      try { localStorage.setItem(KEY, JSON.stringify(equip)); } catch (e) {}
    },
    // el: .mascot 요소, info: /mascot 응답
    apply(el, info, equip) {
      if (!el || !info) return;
      equip = equip || this.equip();
      const byId = {};
      info.items.forEach((it) => (byId[it.id] = it));
      const color = byId[equip.color];
      if (color && color.unlocked) el.style.setProperty('--mascot-bg', color.css);
      else el.style.removeProperty('--mascot-bg');
      el.querySelectorAll('.acc, .lv').forEach((n) => n.remove());
      for (const slot of ['hat', 'face']) {
        const it = byId[equip[slot]];
        if (it && it.unlocked) {
          const s = document.createElement('span');
          s.className = 'acc acc-' + slot;
          s.textContent = it.emoji;
          el.appendChild(s);
        }
      }
    },
    // 22차: 레벨 배지를 누르면 꾸미기로 간다 — 꾸미기가 캐러셀 속 퀘스트 한 장에만
    // 숨어 있어서 있는 줄도 몰랐다. 마스코트를 누르면 쓰다듬기라, 배지 클릭은 거기로 안 번지게.
    badge(el, level) {
      if (!el) return;
      const b = document.createElement('a');
      b.className = 'lv';
      b.href = '/games/mascot';
      b.textContent = 'Lv.' + level;
      b.title = window.T ? T('마스코트 꾸미기') : '마스코트 꾸미기';
      b.addEventListener('click', (e) => e.stopPropagation());
      el.appendChild(b);
    },
    async load() {
      try { return await (await fetch('/mascot')).json(); } catch (e) { return null; }
    },
  };
})();
