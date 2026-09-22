**한국어** | [English](#english)

# 보안 정책

## 취약점 제보

보안 문제는 **공개 이슈로 올리지 말고** 저장소의 [Security → Report a vulnerability](https://github.com/delochy/bitty/security/advisories/new)로 비공개 제보해 주세요. 확인하는 대로 답하고, 고친 뒤 새 릴리스에 알려드릴게요.

지원하는 버전은 [최신 릴리스](https://github.com/delochy/bitty/releases/latest)예요.

## 이 앱이 건드리는 것

제보 범위를 판단하실 때 참고해 주세요.

- **로컬 서버**: 위젯 화면을 `127.0.0.1:4318`(MCP 서버는 `4317`)에서만 열어요. 바깥 네트워크에서는 접근할 수 없어요.
- **읽는 파일**: Claude Code(`~/.claude/projects`)와 Codex(`~/.codex`)가 남기는 기록에서 **토큰 사용량 숫자만** 읽어요. 대화 내용은 쓰지 않아요.
- **고치는 파일**: 설치할 때 `~/.claude/settings.json`, `~/.codex/hooks.json`에 훅을 추가해요. 고치기 전에 `.bak-<시간>` 파일로 백업해요.
- **저장하는 곳**: 모든 기록은 저장소의 `data/` 폴더에만 남고, 어디로도 보내지 않아요.
- **실행하는 것**: 퀘스트를 누르면 `quests.json`에 적힌 앱·폴더·URL만 열어요. 요청으로 받은 값으로는 아무것도 실행하지 않아요.

---

<a id="english"></a>

# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately via [Security → Report a vulnerability](https://github.com/delochy/bitty/security/advisories/new). You'll get a reply once it's been looked at, and the fix will be credited in the release notes.

Only the [latest release](https://github.com/delochy/bitty/releases/latest) is supported.

## What the app touches

- **Local server**: pages are served only on `127.0.0.1:4318` (MCP server on `4317`), unreachable from the network.
- **Files read**: only the **token usage numbers** in logs Claude Code (`~/.claude/projects`) and Codex (`~/.codex`) already keep. Conversation content is not used.
- **Files changed**: the installer adds hooks to `~/.claude/settings.json` and `~/.codex/hooks.json`, backing each up as `.bak-<timestamp>` first.
- **Storage**: everything stays in the repo's `data/` folder and is never sent anywhere.
- **What it launches**: tapping a quest opens only the app, folder or URL listed in `quests.json`. Nothing is executed from request input.
