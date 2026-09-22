#!/bin/sh
# AI Side Quest — 한 번에 설치 (macOS)
#   1) Claude Code 연결 (훅 + MCP 서버)
#   2) Codex 연결 (있으면)
#   3) 마스코트 위젯 빌드·설치·실행
# 기존 설정 파일은 바꾸기 전에 .bak-<시간> 으로 백업한다. 되돌리려면 `node uninstall.js`.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 이상이 필요해요: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 이상이 필요해요 (지금: $(node -v))" >&2
  exit 1
fi

# 위젯 앱이 저장소 위치를 찾을 수 있게 적어둔다 (미리 빌드한 앱을 받아 쓸 때 필요).
mkdir -p "$HOME/.config/bitty"
printf '%s\n' "$ROOT" > "$HOME/.config/bitty/home"

echo "▶ Claude Code 연결"
node setup/install-claude.js

if command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; then
  echo ""
  echo "▶ Codex 연결"
  node setup/install-codex.js
else
  echo ""
  echo "(Codex가 없어서 건너뛰었어요 — 나중에 설치했다면 node setup/install-codex.js)"
fi

echo ""
sh setup/install-widget.sh

echo ""
echo "완료! 실행 중인 Claude Code / Codex 세션을 새로 열면 적용돼요."
