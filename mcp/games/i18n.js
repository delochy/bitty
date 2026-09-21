// Idle Buddy — 한국어 / English (17차)
//
// 맥 시스템 언어가 한국어면 한국어, 아니면 영어. 추천 화면의 🌐 버튼으로 바꾸면
// localStorage('idle-lang')에 기억한다.
//   - 19차: 시스템 언어는 데몬이 알려주는 window.__idleSysLang을 먼저 본다. 위젯 앱
//     번들에 한국어 로컬라이즈가 없어서 navigator.language는 맥 설정과 상관없이
//     늘 en-US로 나오기 때문이다 (브라우저에서 열었을 때만 navigator를 쓴다).
//   - HTML: 한국어 원문 옆에 data-en="English" (placeholder는 data-en-placeholder,
//     title은 data-en-title)를 달아두면 영어일 때 바꿔 끼운다.
//   - JS  : T('한국어', 'English')
(function () {
  let lang = null;
  try { lang = localStorage.getItem('idle-lang'); } catch (e) {}
  if (lang !== 'ko' && lang !== 'en') {
    const sys = window.__idleSysLang || navigator.language || '';
    lang = /^ko\b/i.test(sys) ? 'ko' : 'en';
  }
  window.L = lang;
  window.T = (ko, en) => (lang === 'en' ? en : ko);
  window.setLang = (next) => {
    try { localStorage.setItem('idle-lang', next); } catch (e) {}
    location.reload();
  };
  function apply(root) {
    if (lang !== 'en') return;
    (root || document).querySelectorAll('[data-en]').forEach((el) => (el.textContent = el.getAttribute('data-en')));
    (root || document).querySelectorAll('[data-en-placeholder]').forEach((el) => (el.placeholder = el.getAttribute('data-en-placeholder')));
    (root || document).querySelectorAll('[data-en-title]').forEach((el) => (el.title = el.getAttribute('data-en-title')));
  }
  window.applyI18n = apply;
  document.documentElement.lang = lang;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply());
  else apply();
})();
