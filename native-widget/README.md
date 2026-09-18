# 마스코트 위젯 (native-widget)

Idle Buddy의 마스코트 창을 띄우는 macOS 앱이에요. [Tauri](https://tauri.app)로 만들었어요.

- 메뉴바·Dock·Cmd+Tab 어디에도 안 보이는 백그라운드 앱이에요.
- `../data/state.json`을 2초마다 읽어요.
  - 한 작업이 30초 넘게 진행 중이고 사용자가 타이핑 중이 아니면, 오른쪽 아래에 투명·테두리 없는 창을 포커스를 뺏지 않고 띄워요.
  - 그 작업이 끝나면 삐빅 소리를 내고 스르륵 사라져요.
- 창 안 내용은 앱이 함께 띄우는 `../bin/side-quest-daemon.js` 로컬 서버(`http://127.0.0.1:4318/quest`)에서 받아와요.
- 창의 ✕를 누르면 닫혀요. 페이지가 `/__close`로 이동하면 앱이 그걸 가로채서 창을 숨겨요.

## 빌드·설치

저장소 루트에서 실행해요.

```bash
sh setup/install-widget.sh
```

빌드 결과물은 `~/Library/Caches/ai-side-quest-mascot-target`에 두고, 앱은 `~/Applications`에 설치해요. 외장 디스크(exFAT 등)에서 빌드하면 macOS가 만드는 `._` 파일 때문에 Tauri 빌드가 깨지는데, 이 문제를 피하려고 빌드 결과물을 내장 디스크에 둬요.

## 환경변수

| 변수 | 용도 |
|---|---|
| `AI_SIDE_QUEST_HOME` | 저장소 위치. 기본값은 빌드한 위치예요. 저장소를 옮겼다면 다시 빌드하거나 이 변수를 지정하세요. |
| `AI_SIDE_QUEST_NODE` | node 실행 파일 경로. nvm 등으로 설치해서 앱에서 `node`를 못 찾을 때 지정하세요. |
| `AI_SIDE_QUEST_APP_DIR` | 앱을 설치할 폴더. 기본값은 `~/Applications`예요. |
