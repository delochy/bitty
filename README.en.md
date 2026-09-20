[한국어](README.md) | **English**

# Idle Buddy 🫧

**A little desktop buddy that keeps you company while your AI works.**

Ever kicked off a Claude Code or Codex task and then just stared at the spinner?
When a task runs longer than 30 seconds, Idle Buddy pops a small mascot into the bottom-right corner of your screen and suggests something to do while you wait. When the task finishes, it chimes and fades away.

<p align="center"><img src="docs/widget.png" width="600" alt="Idle Buddy widget in light and dark mode: your AI is still working, category tabs and a quest carousel"></p>

- 🎮 **10 mini games right in the widget**: Block Stack, Sudoku, 2048, Minesweeper, Snake, Whack-a-mole, Tic-tac-toe, Memory Match, Reaction Test, Typing
- 😂 **Fun**: 69 dev jokes and 50 riddles (no repeats until you've seen them all)
- 🧘 **Chill**: a campfire 🔥 and an ocean view 🌊 (with optional ambient sound), breathing exercise, stretching
- 📋 **To-do**: shopping list, tidy your Desktop or Downloads, free up disk space… (tapping opens the right app)
- 🐣 **Grow your buddy**: time spent waiting, time spent playing, and quests you pick all earn XP. Level up to unlock ribbons, glasses, hats, crowns and colors.
- 📊 **Today's wait report**: how long you waited on AI today, tasks over 30s, tokens burned (Claude and Codex), what you did while waiting. Save it as a 1080×1350 image to share.
- 🔁 **Pick up where you left off**: if the widget closes mid-game, it reopens that game next time.
- 🖐 **Put it anywhere**: drag the card to move it; it remembers the spot.
- 🤝 **Claude and Codex together, one widget**: it shows which tool is working (and how many tasks), tells you which one finished, and uses a different sound for each.

No server, no account. Everything runs on your Mac.

## Tour

<table>
<tr><td><img src="docs/promo/01-recommend-dark.png" width="360" alt="Recommendations"></td><td><img src="docs/promo/02-fire.png" width="360" alt="Campfire"></td></tr>
<tr><td><img src="docs/promo/04-sudoku.png" width="360" alt="Sudoku"></td><td><img src="docs/promo/09-toast.png" width="360" alt="Claude and Codex notifications"></td></tr>
</table>

(The tour images show the Korean UI. The UI switches to English automatically when your Mac isn't set to Korean, or tap 🌐 in the widget.)

## How it works

```
Claude Code / Codex ──(hooks)──▶ data/state.json ◀──(polled every 2s)── mascot widget (macOS app)
                                                                         │
                                        local page http://127.0.0.1:4318/quest (games & quests)
```

1. When you send a prompt, a hook records "task started".
2. If it's still running after 30 seconds, the mascot appears. **If you're typing, it waits until you pause**, and it never steals focus.
3. Suggestions adapt to the task size. Claude reports a rough size (short / medium / long), and suggestions get longer if the task drags on. It never shows "this will take N minutes".
4. When the task ends, it chimes and fades out.

## Requirements

- **macOS** (the widget is macOS-only for now; Apple Silicon and Intel)
- **Node.js 18+**
- **Claude Code** and/or **Codex**
- Rust is **optional**: with Rust installed, the widget is built from source. Without it, the installer downloads the prebuilt app from [Releases](https://github.com/delochy/idle-buddy/releases).

## Install

```bash
git clone https://github.com/delochy/idle-buddy.git
cd idle-buddy
sh install.sh
```

The installer:

1. **Connects Claude Code**: adds hooks to `~/.claude/settings.json` and registers the MCP server.
2. **Connects Codex** (if installed): adds hooks to `~/.codex/hooks.json` and registers the MCP server.
3. **Installs the widget**: builds it (or downloads the prebuilt app) into `~/Applications/AI Side Quest Mascot.app` and launches it.

Every config file is backed up as `.bak-<timestamp>` before it's changed. **Restart any running Claude Code / Codex sessions** afterwards.

**Launch at login**: add `AI Side Quest Mascot` in System Settings → General → Login Items. It's a background app, so it doesn't appear in the menu bar or Dock.

**Codex users**: Codex only runs a new hook after you **trust** it; until then, the hooks are silently skipped. After installing, run `codex` once in a terminal, from a folder you already trust, and pick **Trust all and continue** on the "Hooks need review" screen. You need this step even if you only use the Codex desktop app.

## Update

```bash
git pull && sh install.sh
```

## Uninstall

```bash
node uninstall.js
```

Removes the hooks, the MCP server registration and the widget app. Changed files are backed up first; the repo folder and your `data/` history are left alone.

## Privacy

- All data stays in the `data/` folder and is never sent anywhere. It stores task start/end times, the working folder, the first 200 characters of each prompt, quests you picked, and time spent in games.
- Token counts in the report come from reading **only the usage numbers** in the logs Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`) already keep.
- Typing detection only checks **when a key was last pressed**. It can't see which key, so it needs no Input Monitoring permission.
- On each prompt, the Claude Code hook passes Claude a short note asking it to report the task size and not to ask how long you'll be away. That costs a few extra tokens per prompt.
- The only network use is opening external links from quests (such as Threads). The installer also downloads the prebuilt app when Rust isn't installed.

## Customize

| What | Where |
|---|---|
| Quest list (name, emoji, category, app/folder/URL to open) | `lib/quests.json` (`label` for Korean, `label_en` for English) |
| Jokes / riddles / typing lines | `mcp/games/jokes.json`, `quiz.json`, `typing.json` (Korean) · `jokes-en.json`, `quiz-en.json`, `typing-en.json` (English) |
| Add a mini game | create `mcp/games/<name>.html` and add `"open": "/games/<name>"` to `quests.json` |
| Popup delay (30s), typing pause (4s), fade speed | constants at the top of `native-widget/src-tauri/src/main.rs`, then rebuild with `sh setup/install-widget.sh` |

## Known limitations

- **The widget is macOS-only.** The hooks and quest page run elsewhere, but the floating window doesn't.
- **Codex needs its hooks trusted** (see above). Until then, the hooks are silently skipped.
- **The app isn't signed or notarized** by Apple.

## License

[MIT](LICENSE)
