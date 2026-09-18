// AI Side Quest — 네이티브 마스코트 위젯
//
// 메뉴바·Dock 어디에도 안 보이는 백그라운드 앱. Claude Code / Codex 훅이
// 갱신하는 data/state.json을 2초마다 읽어서:
//   - 한 작업(turn)이 30초 넘게 WORKING이면 (타이핑 중이 아닐 때) 화면
//     오른쪽 아래에 투명·테두리 없는 마스코트 창을 포커스를 뺏지 않고 띄운다.
//   - 그 작업이 끝나면 "삐빅" 울리고 스르륵 사라진다.
// 창 안 내용은 bin/side-quest-daemon.js가 띄우는 로컬 페이지
// (mcp/quest-http.js, http://127.0.0.1:4318/quest)를 그대로 불러온다.

use std::collections::HashSet;
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const WIDGET_WIDTH: f64 = 300.0;
const WIDGET_HEIGHT: f64 = 360.0;

/// ai-side-quest 저장소 루트. 13차(공개 배포): 예전엔 절대 경로를 박아뒀는데,
/// 이제는 빌드한 위치(src-tauri/../..)를 컴파일 때 기억한다. 저장소를 옮겼으면
/// 다시 빌드하거나, 실행 시 AI_SIDE_QUEST_HOME 환경변수로 덮어쓸 수 있다.
fn project_root() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("AI_SIDE_QUEST_HOME") {
        return home.into();
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// 로컬 퀘스트 페이지를 서빙하는 HTTP 서버(quest-http.js)를 독립적으로
/// 띄운다 — Claude Code CLI를 안 켜도 마스코트 창이 보여줄 내용이 항상
/// 준비되어 있게 하기 위함. 이미 다른 프로세스(예: 그날 따로 켠 Claude
/// Code CLI)가 포트를 잡고 있어도 quest-http.js가 EADDRINUSE를 조용히
/// 무시하도록 이미 만들어져 있어서 안전하다.
///
/// macOS GUI 앱(Finder/Dock에서 실행)은 터미널의 PATH를 그대로 물려받지
/// 않는 경우가 많다 — `node`가 nvm 등으로 설치돼 있으면 이 앱에서는 안
/// 보일 수 있다. 그래서 흔한 위치들을 순서대로 시도한다. 전부 실패하면
/// 터미널에서 `which node`로 실제 경로를 확인해서 이 목록에 추가해야 한다.
/// (13차: nvm/volta 등으로 설치한 경우를 위해 AI_SIDE_QUEST_NODE로 지정 가능.)
fn spawn_local_server() {
    let custom = std::env::var("AI_SIDE_QUEST_NODE").ok();
    let candidates = custom
        .iter()
        .map(String::as_str)
        .chain(["node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]);
    for candidate in candidates {
        match Command::new(candidate)
            .arg(project_root().join("bin").join("side-quest-daemon.js"))
            .env("SIDE_QUEST_PORT", WIDGET_PORT)
            .spawn() {
            Ok(_) => {
                println!("[side-quest-mascot] local server spawned via `{candidate}`");
                return;
            }
            Err(_) => continue,
        }
    }
    eprintln!(
        "[side-quest-mascot] `node`를 못 찾았어요 — 터미널에서 `which node`로 경로를 확인해서 \
         main.rs의 candidates 목록에 추가하고 다시 빌드해주세요."
    );
}

fn position_bottom_right(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        let margin = (20.0 * scale) as i32;
        let w = (WIDGET_WIDTH * scale) as i32;
        let h = (WIDGET_HEIGHT * scale) as i32;
        let x = screen.width as i32 - w - margin;
        let y = screen.height as i32 - h - margin;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

// 위젯 전용 포트. 4317은 Claude Code/Codex가 띄운 MCP 서버들이 먼저 잡고
// 있을 수 있어서, 그러면 위젯이 옛 코드가 서빙하는 페이지를 보게 된다.
// 위젯이 직접 띄운 데몬만 이 포트를 쓰게 해서 항상 최신 페이지를 보여준다.
const WIDGET_PORT: &str = "4318";
const QUEST_URL: &str = "http://127.0.0.1:4318/quest";
// 즉답으로 끝나는 프롬프트엔 안 뜨게 — lib/sidebar.js의 5차 규칙과 같은 값.
const AUTO_SHOW_DELAY_MS: u64 = 30_000;
// Stop 훅 없이 죽은 세션이 영원히 WORKING으로 남는 걸 무시하기 위한 상한.
const STALE_WORKING_MS: u64 = 2 * 60 * 60 * 1000;
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// state.json을 읽어서 (자동으로 띄울 turn 키, 진행 중인 turn 키 전부)를
/// 돌려준다. turn 키는 "sessionId#turnSeq" — 같은 turn에 두 번 뜨지 않게
/// (사용자가 숨긴 뒤 다시 튀어나오지 않게) 구분하는 데 쓴다.
fn read_working_turn(now: u64) -> (Option<String>, Vec<String>) {
    let Ok(raw) = std::fs::read_to_string(project_root().join("data").join("state.json")) else {
        return (None, Vec::new());
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, Vec::new());
    };
    let Some(sessions) = json.get("sessions").and_then(|s| s.as_object()) else {
        return (None, Vec::new());
    };

    let mut active = Vec::new();
    let mut best: Option<(u64, String)> = None;
    for (id, rec) in sessions {
        if rec.get("state").and_then(|s| s.as_str()) != Some("WORKING") {
            continue;
        }
        let started = rec
            .get("startedAt")
            .or_else(|| rec.get("updatedAt"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let age = now.saturating_sub(started);
        if age > STALE_WORKING_MS {
            continue;
        }
        let seq = rec.get("turnSeq").and_then(|v| v.as_u64()).unwrap_or(0);
        let key = format!("{id}#{seq}");
        active.push(key.clone());
        if age < AUTO_SHOW_DELAY_MS {
            continue;
        }
        if best.as_ref().map_or(true, |(s, _)| started > *s) {
            best = Some((started, key));
        }
    }
    (best.map(|(_, key)| key), active)
}

/// 포커스를 뺏지 않고 띄운다 — 사용자는 Claude 앱에서 계속 타이핑 중일 수
/// 있다. 새 turn이니 시간예산 첫 화면부터 다시 보여준다.
fn auto_show(window: &tauri::WebviewWindow) {
    if let Ok(url) = QUEST_URL.parse() {
        let _ = window.navigate(url);
    }
    position_bottom_right(window);
    let _ = window.show();
}

/// 10차: 긴 작업이 끝나면 "삐빅" 한 번 울린다 (13차: 두 번은 과하다는 피드백). 30초도 안 걸린 짧은 답변엔
/// 안 울린다 (마스코트가 떠 있는 turn이 끝날 때만). 시스템 알림 설정과 상관없이
/// 들리도록 알림 사운드 대신 afplay로 직접 재생한다.
fn beep() {
    let sound = "/System/Library/Sounds/Tink.aiff";
    let _ = Command::new("/bin/sh")
        .arg("-c")
        .arg(format!("afplay '{sound}'"))
        .spawn();
}

// 12차: 마지막 키 입력 후 이만큼 지나야 마스코트를 띄운다.
const TYPING_IDLE_SECS: f64 = 4.0;
// 사라질 때 스르륵 흐려지는 시간 (페이지 CSS 전환과 맞춘다).
const FADE_MS: u64 = 600;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(source_state: i32, event_type: u32) -> f64;
}

/// 시스템 전체에서 마지막으로 키가 눌린 뒤 몇 초 지났는지. 어떤 키였는지는
/// 알 수 없고 시각만 본다 — 그래서 손쉬운 사용/입력 모니터링 권한이 필요 없다.
fn seconds_since_last_key() -> f64 {
    #[cfg(target_os = "macos")]
    unsafe {
        // kCGEventSourceStateHIDSystemState = 1, kCGEventKeyDown = 10
        return CGEventSourceSecondsSinceLastEventType(1, 10);
    }
    #[allow(unreachable_code)]
    f64::MAX
}

/// 페이지를 서서히 투명하게 만든 뒤 창을 숨긴다. 다음에 띄울 땐 auto_show가
/// 페이지를 새로 불러오니 투명도는 저절로 원래대로 돌아온다.
fn fade_out_and_hide(window: &tauri::WebviewWindow) {
    let _ = window.eval(&format!(
        "document.documentElement.style.transition='opacity {FADE_MS}ms ease';\
         document.documentElement.style.opacity='0';"
    ));
    thread::sleep(Duration::from_millis(FADE_MS + 50));
    let _ = window.hide();
}

fn spawn_auto_popup_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        // 이미 한 번 띄운 turn들 — 그 turn 때문에 다시 튀어나오지 않게 (사용자가
        // 닫았거나, 다른 turn이 끝나 숨긴 뒤에도).
        let mut popped: HashSet<String> = HashSet::new();
        // 11차: 마스코트를 띄운 바로 그 turn. 그 turn이 끝나면(DONE/NEEDS_INPUT/
        // 다음 turn) 삐빅 울리고 바로 숨긴다 — 게임 중이어도. 예전엔 모든
        // 세션이 끝나고 1분 뒤에 숨겼는데, 한 작업이 끝나면 바로 사라지게 해달라는
        // 요청으로 바꿨다.
        let mut showing: Option<String> = None;
        loop {
            thread::sleep(Duration::from_secs(2));
            let (turn, active) = read_working_turn(now_ms());
            let Some(window) = app.get_webview_window("mascot") else {
                continue;
            };

            if let Some(key) = &showing {
                if !active.contains(key) {
                    if window.is_visible().unwrap_or(false) {
                        beep();
                        fade_out_and_hide(&window);
                    }
                    showing = None;
                }
            }
            if let Some(turn) = turn {
                // 12차: 사용자가 타이핑 중이면 튀어나오지 않고, 손을 멈출 때까지
                // 미룬다 (popped에 안 넣으니 다음 루프에서 다시 시도).
                if !popped.contains(&turn) && seconds_since_last_key() < TYPING_IDLE_SECS {
                    continue;
                }
                if popped.insert(turn.clone()) {
                    if !window.is_visible().unwrap_or(false) {
                        auto_show(&window);
                    }
                    showing = Some(turn);
                }
            }
        }
    });
}

// 페이지의 ✕ 버튼이 이 경로로 이동하면 창을 숨긴다 (mcp/quest-http.js,
// mcp/games/*.html). 메뉴바 아이콘을 없앤 뒤(10차) 창을 닫는 유일한 방법.
const CLOSE_PATH: &str = "/__close";

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            spawn_local_server();

            // Dock/Cmd+Tab/메뉴바 어디에도 안 뜨는 백그라운드 앱 — 10차
            // (2026-09-18)에 메뉴바 아이콘도 없앴다. 마스코트는 작업이 길어질
            // 때 자동으로만 뜨고, 창의 ✕ 버튼으로 닫는다.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // 마스코트 창: 브라우저 틀 없음(decorations: false), 투명
            // 배경(transparent: true), 항상 위(always_on_top). 숨김 상태로
            // 시작하고, spawn_auto_popup_watcher가 필요할 때 띄운다.
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(
                app,
                "mascot",
                WebviewUrl::External(QUEST_URL.parse().unwrap()),
            )
            .title("AI Side Quest")
            .inner_size(WIDGET_WIDTH, WIDGET_HEIGHT)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .focused(false)
            .visible(false)
            .on_navigation(move |url| {
                if url.path() != CLOSE_PATH {
                    return true;
                }
                if let Some(w) = handle.get_webview_window("mascot") {
                    // on_navigation 안에서 기다리면 창이 멈추니, 페이드는 다른 스레드에서.
                    thread::spawn(move || fade_out_and_hide(&w));
                }
                false
            })
            .build()?;

            spawn_auto_popup_watcher(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AI Side Quest mascot app");
}
