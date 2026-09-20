#!/bin/sh
# AI Side Quest — 마스코트 위젯(native-widget/) 빌드 + 설치 (macOS)
#
# ~/Applications/AI Side Quest Mascot.app 으로 설치하고 바로 실행한다.
# 빌드 결과물은 ~/Library/Caches 아래에 둔다 — 저장소가 외장 디스크(exFAT 등)에
# 있으면 macOS가 만드는 ._ 파일 때문에 Tauri 빌드가 깨지는 문제를 피하려고.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="AI Side Quest Mascot.app"
DEST="${AI_SIDE_QUEST_APP_DIR:-$HOME/Applications}"
TARGET="${CARGO_TARGET_DIR:-$HOME/Library/Caches/ai-side-quest-mascot-target}"

if [ "$(uname)" != "Darwin" ]; then
  echo "마스코트 위젯은 지금 macOS만 지원해요." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
fi

# 19차: 재부팅하면 아무도 위젯을 켜주지 않아서 조용히 사라졌다 — 로그인 항목으로 등록한다.
# 이미 있으면(경로가 바뀌었을 수도 있어서) 지우고 다시 넣는다. hidden:true 라서 로그인할 때
# 창이 튀어나오지 않는다. System Events 자동화 권한을 거부하면 조용히 건너뛰고 안내만 한다.
LOGIN_ITEM_NAME="$(basename "$APP_NAME" .app)"
register_login_item() {
  if osascript >/dev/null 2>&1 <<OSA
tell application "System Events"
  if login item "$LOGIN_ITEM_NAME" exists then delete login item "$LOGIN_ITEM_NAME"
  make login item at end with properties {path:"$DEST/$APP_NAME", hidden:true}
end tell
OSA
  then
    echo "✓ 로그인 항목에 등록 — 재부팅해도 알아서 켜져요"
  else
    echo "· 로그인 항목 등록은 건너뛰었어요 (자동화 권한 없음)."
    echo "  시스템 설정 → 일반 → 로그인 항목에서 '$LOGIN_ITEM_NAME'을 직접 추가하면 재부팅 후에도 켜져요."
  fi
}
# 17차: Rust가 없으면(또는 --prebuilt) 직접 빌드하지 않고 GitHub Releases의 빌드된 앱을 받는다.
PREBUILT_URL="https://github.com/delochy/idle-buddy/releases/latest/download/IdleBuddy-Mascot-macOS.zip"
if [ "$1" = "--prebuilt" ] || ! command -v cargo >/dev/null 2>&1; then
  echo "▶ 빌드된 마스코트 앱 받는 중 (Rust 없이 설치)…"
  TMP="$(mktemp -d)"
  curl -fsSL "$PREBUILT_URL" -o "$TMP/app.zip"
  ditto -x -k "$TMP/app.zip" "$TMP"
  mkdir -p "$DEST"
  pkill -f "$APP_NAME" 2>/dev/null || true
  pkill -f "side-quest-daemon.js" 2>/dev/null || true
  rm -rf "$DEST/$APP_NAME"
  cp -R "$TMP/$APP_NAME" "$DEST/"
  rm -rf "$TMP"
  open "$DEST/$APP_NAME"
  echo "✓ 마스코트 위젯 실행 중 (메뉴바·Dock에는 안 보여요 — 작업이 30초 넘게 걸리면 오른쪽 아래에 떠요)"
  register_login_item
  exit 0
fi

cd "$ROOT/native-widget"
echo "▶ 위젯 의존성 설치 (npm)…"
npm install --no-fund --no-audit --silent
if [ ! -f src-tauri/icons/icon.icns ]; then
  echo "▶ 앱 아이콘 생성"
  npx tauri icon mascot-icon-source.png >/dev/null
fi
# 외장 디스크(exFAT 등)에서는 macOS가 ._ 메타 파일을 만들어서 Tauri 빌드가 깨진다 — 미리 지운다.
find src-tauri -name '._*' -not -path '*/target/*' -delete 2>/dev/null || true
echo "▶ 위젯 빌드 중… (처음엔 몇 분 걸려요)"
CARGO_TARGET_DIR="$TARGET" npx tauri build --bundles app

echo "▶ $DEST 에 설치"
mkdir -p "$DEST"
pkill -f "$APP_NAME" 2>/dev/null || true
pkill -f "side-quest-daemon.js" 2>/dev/null || true
rm -rf "$DEST/$APP_NAME"
cp -R "$TARGET/release/bundle/macos/$APP_NAME" "$DEST/"
open "$DEST/$APP_NAME"
echo "✓ 마스코트 위젯 실행 중 (메뉴바·Dock에는 안 보여요 — 작업이 30초 넘게 걸리면 오른쪽 아래에 떠요)"
register_login_item
