**한국어** | [English](#english)

# 기여하기

Bitty에 관심 가져주셔서 고마워요. 버그 제보, 아이디어, 번역, 코드 모두 환영해요.

## 이 프로젝트의 원칙

기여하기 전에 이것만 알아두세요. 이 원칙에 어긋나는 변경은 받기 어려워요.

- **자리를 비우라는 앱이 아니에요.** AI를 기다리는 동안 심심하지 않게 할 거리를 건네는 앱이에요. "얼마나 자리 비우실 거예요?", "다녀오세요" 같은 말은 쓰지 않아요. "N분 걸려요"처럼 작업 시간을 단정하지도 않아요.
- **모든 게 내 맥 안에서만 돌아요.** 데이터는 `data/` 폴더에만 남고 어디로도 보내지 않아요. 외부 서버, 계정, 분석 도구를 붙이는 변경은 받지 않아요.
- **의존성 없이 가볍게.** 데몬과 화면(`lib/`, `mcp/`)은 Node.js 기본 모듈만 써요. npm 패키지를 추가해야 한다면 이슈에서 먼저 얘기해 주세요.
- **방해하지 않기.** 위젯은 포커스를 뺏지 않고, 타이핑 중엔 뜨지 않아요.

## 버그 제보·아이디어

[이슈](https://github.com/delochy/bitty/issues/new/choose)에서 템플릿을 골라 써 주세요. 사용법 질문이나 가벼운 얘기는 [토론](https://github.com/delochy/bitty/discussions)이 편해요.

버그 제보에 로그를 붙일 땐 `data/` 폴더의 파일을 **그대로 올리지 마세요.** `worklog.local.jsonl`에는 프롬프트 앞 200자가, `events.local.jsonl`에는 작업 폴더 경로가 들어 있어요. 필요한 줄만 골라서, 개인 정보는 지우고 붙여 주세요.

## 개발 환경

macOS, Node.js 18 이상이 필요해요. 위젯 앱(Rust/Tauri)을 고칠 때만 Rust가 있으면 돼요.

```bash
git clone https://github.com/delochy/bitty.git
cd bitty
sh install.sh
```

**화면·데몬(`mcp/`, `lib/`)을 고쳤을 때** — 위젯 앱을 다시 켜면 데몬도 새 코드로 떠요.

```bash
pkill -f "Bitty.app"; open ~/Applications/Bitty.app
```

화면은 브라우저에서 `http://127.0.0.1:4318/quest`로 열어 봐도 돼요.

**위젯 앱(`native-widget/`)을 고쳤을 때**

```bash
sh setup/install-widget.sh
```

## 올리기 전에 확인

```bash
node --check mcp/quest-http.js lib/state.js lib/stats.js   # 고친 JS 파일
node setup/check-i18n.js                                    # 번역 빠진 문구
```

화면을 바꿨다면 라이트·다크 모드와 영어(위젯 왼쪽 위 🌐)에서 한 번씩 봐 주세요. 위젯 창은 300×360이라 글자가 넘치기 쉬워요.

## 자주 하는 기여

| 하고 싶은 것 | 방법 |
|---|---|
| 언어 추가 | `mcp/locales/en.json`을 복사해 `<언어>.json`으로 만들고 값만 번역 → `node setup/check-i18n.js <언어>` |
| 유머·퀴즈·타자 문장 추가 | `mcp/games/jokes.json`, `quiz.json`, `typing.json` (영어는 `-en.json`) |
| 미니 게임 추가 | `mcp/games/<이름>.html`을 만들고 `lib/quests.json`에 `"open": "/games/<이름>"` 추가 |
| 퀘스트 추가 | `lib/quests.json` — 이름은 한국어 원문, 영어는 `mcp/locales/en.json`에 |

화면 문구는 한국어 원문이 곧 번역 키예요. 새 문구는 `T('한국어')` 또는 `data-i18n`으로 쓰고, `mcp/locales/en.json`에 영어를 넣어 주세요.

## 풀 리퀘스트

- 하나의 PR에는 하나의 변경만 담아 주세요.
- 무엇을 **왜** 바꿨는지 적어 주세요. 화면이 바뀌면 스크린샷을 붙여 주세요.
- 커밋 메시지는 한국어도 영어도 괜찮아요.

기여한 코드는 [MIT 라이선스](LICENSE)로 배포돼요.

---

<a id="english"></a>

# Contributing

Thanks for your interest in Bitty. Bug reports, ideas, translations and code are all welcome.

## Principles

Changes that go against these are hard to accept.

- **It's not an away-from-keyboard app.** It hands you something to do while you wait on AI. Don't ask how long the user will be away, don't tell them to step away, and don't promise "this takes N minutes".
- **Everything stays on your Mac.** Data lives only in `data/` and is never sent anywhere. No external servers, accounts or analytics.
- **No dependencies.** The daemon and pages (`lib/`, `mcp/`) use only Node.js built-ins. Open an issue first if you think a package is needed.
- **Don't get in the way.** The widget never steals focus and waits while you're typing.

## Bugs and ideas

Pick a template on [Issues](https://github.com/delochy/bitty/issues/new/choose). For questions and casual chat, use [Discussions](https://github.com/delochy/bitty/discussions).

Don't attach files from `data/` as-is: `worklog.local.jsonl` holds the first 200 characters of your prompts and `events.local.jsonl` holds working-folder paths. Paste only the lines you need, with personal details removed.

## Development

You need macOS and Node.js 18+. Rust is only needed to change the widget app.

```bash
git clone https://github.com/delochy/bitty.git
cd bitty
sh install.sh
```

After changing pages or the daemon (`mcp/`, `lib/`), relaunch the widget app to reload the daemon:

```bash
pkill -f "Bitty.app"; open ~/Applications/Bitty.app
```

You can also open `http://127.0.0.1:4318/quest` in a browser. After changing the widget app (`native-widget/`), run `sh setup/install-widget.sh`.

## Before you open a PR

```bash
node --check mcp/quest-http.js lib/state.js lib/stats.js   # the JS files you changed
node setup/check-i18n.js                                    # missing translations
```

If you changed the UI, check light mode, dark mode and English (🌐 in the widget). The window is only 300×360.

## Common contributions

| What | How |
|---|---|
| Add a language | Copy `mcp/locales/en.json` to `<lang>.json`, translate the values, then `node setup/check-i18n.js <lang>` |
| Jokes, riddles, typing lines | `mcp/games/jokes.json`, `quiz.json`, `typing.json` (English: `-en.json`) |
| Add a mini game | Create `mcp/games/<name>.html` and add `"open": "/games/<name>"` to `lib/quests.json` |

UI text uses the Korean source as the translation key: write `T('한국어')` or `data-i18n`, and add the English to `mcp/locales/en.json`.

## Pull requests

Keep one change per PR, explain what changed and **why**, and attach screenshots for UI changes. Contributions are released under the [MIT License](LICENSE).
