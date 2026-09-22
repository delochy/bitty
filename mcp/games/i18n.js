// Bitty — 다국어 (19차)
//
// 한국어 원문이 곧 키다 (gettext의 msgid와 같은 방식). 번역은 locales/<언어>.json 한 장에
// 모여 있고, 데몬이 i18n.js 앞에 window.__idleDicts로 붙여준다. 언어를 늘리려면
// locales/ 에 JSON 파일 하나만 더 놓으면 되고, 화면 코드는 건드릴 필요가 없다.
//
//   - HTML: 한국어를 그대로 쓰고 data-i18n 만 달아둔다.
//       <span data-i18n>시작</span>
//       <input data-i18n-placeholder placeholder="살 것 적기" />
//       <button data-i18n-title title="떨구기">⤓</button>
//   - JS  : T('시작')  ·  값이 끼는 문장은 {이름} 자리를 쓴다
//       T('{n}점 · {lines}줄', { n: score, lines: lines })
//
// 번역이 없는 문구는 한국어 원문이 그대로 나온다 — 빠뜨려도 화면이 깨지지 않는다.
// 맥 시스템 언어는 데몬이 알려주는 window.__idleSysLang을 먼저 본다. 위젯 앱 번들에
// 한국어 로컬라이즈가 없어서 navigator.language는 맥 설정과 상관없이 늘 en-US로
// 나오기 때문이다 (브라우저에서 열었을 때만 navigator를 쓴다).
(function () {
  const dicts = window.__idleDicts || {};
  // 한국어는 원문 자체라 사전이 없다 — 목록엔 항상 먼저 넣는다.
  const available = ['ko'].concat(Object.keys(dicts).filter((c) => c !== 'ko'));

  let lang = null;
  try { lang = localStorage.getItem('idle-lang'); } catch (e) {}
  if (available.indexOf(lang) < 0) {
    const sys = (window.__idleSysLang || navigator.language || '').replace('_', '-');
    // ko-KR → ko 처럼 지역 코드는 떼고 맞춰 본다. 없으면 영어, 영어도 없으면 한국어.
    const base = sys.split('-')[0].toLowerCase();
    lang = available.indexOf(base) >= 0 ? base : available.indexOf('en') >= 0 ? 'en' : 'ko';
  }
  const dict = dicts[lang] || null;

  window.L = lang;
  window.LANGS = available;
  /** 한국어 원문을 번역해 돌려준다. vars를 주면 {이름} 자리를 채운다. */
  window.T = (ko, vars) => {
    // 번역이 빈 문자열인 경우도 있다 (예: '마리' → 영어에선 단위를 안 붙인다).
    // || 로 고르면 빈 값이 한국어로 되돌아가므로 키가 있는지로 판단한다.
    let out = dict && ko in dict ? dict[ko] : ko;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return out;
  };
  /** 다음 언어로 넘긴다 (🌐 버튼). 인자를 주면 그 언어로 고정한다. */
  window.setLang = (next) => {
    if (!next) next = available[(available.indexOf(lang) + 1) % available.length];
    try { localStorage.setItem('idle-lang', next); } catch (e) {}
    location.reload();
  };

  // 두 번 돌려도 안전하도록, 처음 볼 때의 한국어 원문을 element에 기억해 둔다
  // (applyI18n은 새로 그린 조각에도 다시 부른다).
  function src(el, slot, read) {
    const k = '__i18n_' + slot;
    if (!(k in el)) el[k] = read();
    return el[k];
  }
  function apply(root) {
    if (!dict) return;
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = T(src(el, 'text', () => el.textContent.trim()));
    });
    r.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = T(src(el, 'ph', () => el.placeholder));
    });
    r.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = T(src(el, 'title', () => el.title));
    });
  }
  window.applyI18n = apply;

  // 유머·퀴즈·타자 지문처럼 언어마다 내용 자체가 달라야 하는 것 (말장난은 번역이 안 된다).
  //   games/<이름>.json = 한국어 · games/<이름>-<언어>.json = 그 언어
  // 그 언어 파일이 없으면 영어로 대신한다.
  window.localizedJSON = (name) => {
    const tries = (lang === 'ko' ? [] : ['/games/' + name + '-' + lang + '.json', '/games/' + name + '-en.json'])
      .concat('/games/' + name + '.json');
    const next = (i) =>
      fetch(tries[i]).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .catch((e) => (i + 1 < tries.length ? next(i + 1) : Promise.reject(e)));
    return next(0);
  };
  /** 언어별로 기록을 따로 쌓아야 하는 localStorage 키 (한국어는 접미사 없음). */
  window.langKey = (base) => base + (lang === 'ko' ? '' : '-' + lang);
  document.documentElement.lang = lang;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply());
  else apply();
})();
