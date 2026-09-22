// AI Side Quest — 네이티브 마스코트 위젯
//
// 메뉴바·Dock 어디에도 안 보이는 백그라운드 앱. Claude Code / Codex 훅이
// 갱신하는 data/state.json을 2초마다 읽어서:
//   - 한 작업(turn)이 30초 넘게 WORKING이면 (타이핑 중이 아닐 때) 화면
//     오른쪽 아래에 투명·테두리 없는 마스코트 창을 포커스를 뺏지 않고 띄운다.
//   - 그 작업이 끝나면 "삐빅" 울리고 스르륵 사라진다.
// 창 안 내용은 bin/side-quest-daemon.js가 띄우는 로컬 페이지
// (mcp/quest-http.js, http://127.0.0.1:4318/quest)를 그대로 불러온다.

use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const WIDGET_WIDTH: f64 = 300.0;
const WIDGET_HEIGHT: f64 = 360.0;

/// ai-side-quest 저장소 루트. 13차(공개 배포): 예전엔 절대 경로를 박아뒀는데,
/// 이제는 빌드한 위치(src-tauri/../..)를 컴파일 때 기억한다. 저장소를 옮겼으면
/// 다시 빌드하거나, 실행 시 AI_SIDE_QUEST_HOME 환경변수로 덮어쓸 수 있다.
/// 17차: 미리 빌드한 앱(GitHub Releases)을 받아 쓰는 경우엔 빌드 위치가 의미 없으니,
/// install.sh가 ~/.config/bitty/home 에 적어둔 저장소 경로를 먼저 본다.
/// 23차: Idle Buddy → Bitty로 이름을 바꾸면서 위치도 옮겼다. 예전에 설치한 사람은
/// ~/.config/idle-buddy/home 에만 적혀 있으니 거기도 본다.
fn project_root() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("AI_SIDE_QUEST_HOME") {
        return home.into();
    }
    if let Some(home) = std::env::var_os("HOME") {
        for dir in ["bitty", "idle-buddy"] {
            let cfg = std::path::Path::new(&home).join(".config").join(dir).join("home");
            if let Ok(p) = std::fs::read_to_string(cfg) {
                let p = p.trim();
                if !p.is_empty() && std::path::Path::new(p).join("bin").exists() {
                    return p.into();
                }
            }
        }
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

/// 마우스 커서가 있는 모니터의 오른쪽 아래 (모니터가 여러 대면 지금 보고 있는 화면에 뜨게).
/// 커서 위치를 모르면 주 모니터. 17차: 모니터 위치와 배율을 반영해 논리 좌표로 계산한다 —
/// 예전엔 원점 (0,0)·물리 픽셀을 가정해서 화면 밖으로 가는 일이 있었다.
fn position_bottom_right(window: &tauri::WebviewWindow) {
    let under_cursor = window
        .cursor_position()
        .ok()
        .and_then(|c| window.monitor_from_point(c.x, c.y).ok().flatten());
    let monitor = under_cursor
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    if let Some(m) = monitor {
        let sf = m.scale_factor();
        let pos: tauri::LogicalPosition<f64> = m.position().to_logical(sf);
        let size: tauri::LogicalSize<f64> = m.size().to_logical(sf);
        let margin = 20.0;
        let x = pos.x + size.width - WIDGET_WIDTH - margin;
        let y = pos.y + size.height - WIDGET_HEIGHT - margin;
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}

// 위젯 전용 포트. 4317은 Claude Code/Codex가 띄운 MCP 서버들이 먼저 잡고
// 있을 수 있어서, 그러면 위젯이 옛 코드가 서빙하는 페이지를 보게 된다.
// 위젯이 직접 띄운 데몬만 이 포트를 쓰게 해서 항상 최신 페이지를 보여준다.
const WIDGET_PORT: &str = "4318";
const QUEST_URL: &str = "http://127.0.0.1:4318/quest";
// 즉답으로 끝나는 프롬프트엔 안 뜨게 — lib/sidebar.js의 5차 규칙과 같은 값.
const AUTO_SHOW_DELAY_MS: u64 = 30_000;
// Codex의 턴 사이 Stop을 작업 종료로 보지 않고 기다리는 시간.
const CODEX_GRACE_MS: u64 = 20_000;
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
fn read_working_turn(now: u64) -> (Option<String>, HashMap<String, &'static str>) {
    let Ok(raw) = std::fs::read_to_string(project_root().join("data").join("state.json")) else {
        return (None, HashMap::new());
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, HashMap::new());
    };
    let Some(sessions) = json.get("sessions").and_then(|s| s.as_object()) else {
        return (None, HashMap::new());
    };

    let mut active = HashMap::new();
    let mut best: Option<(u64, String)> = None;
    for (id, rec) in sessions {
        let state = rec.get("state").and_then(|s| s.as_str()).unwrap_or("");
        let is_codex = rec.get("source").and_then(|s| s.as_str()).map_or(false, |s| s.starts_with("codex"));
        // 17차: Codex는 작업 중간에도 턴마다 Stop을 보낸다 — Stop 뒤 잠깐은 아직 진행 중으로 본다
        // (곧 다시 일을 시작하면 lib/state.js가 같은 작업으로 이어 붙인다).
        let updated = rec.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let codex_grace = is_codex && state == "DONE" && now.saturating_sub(updated) < CODEX_GRACE_MS;
        if state != "WORKING" && !codex_grace {
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
        // 14차: Claude/Codex 구별 — state.json의 source ("claude", "codex-hook", "codex-notify").
        let tool = match rec.get("source").and_then(|s| s.as_str()) {
            Some(src) if src.starts_with("codex") => "Codex",
            _ => "Claude",
        };
        active.insert(key.clone(), tool);
        if state != "WORKING" || age < AUTO_SHOW_DELAY_MS {
            continue;
        }
        if best.as_ref().map_or(true, |(s, _)| started > *s) {
            best = Some((started, key));
        }
    }
    (best.map(|(_, key)| key), active)
}

/// 포커스를 뺏지 않고 띄운다 — 사용자는 Claude 앱에서 계속 타이핑 중일 수
/// 있다. 새 turn이니 추천 화면부터 — 하던 게임이 있으면 그 게임으로 바로.
fn auto_show(window: &tauri::WebviewWindow) {
    // ?auto=1: 추천 페이지가 마지막에 하던 게임·장보기가 있으면 바로 그리로 이어간다.
    if let Ok(url) = format!("{QUEST_URL}?auto=1").parse() {
        let _ = window.navigate(url);
    }
    place_window(window);
    let _ = window.show();
}

// 15차: 사용자가 끌어서 옮긴 위치를 기억한다 (data/widget-pos.json). 앱을 다시
// 켜도 유지되고, 그 위치가 지금 연결된 모니터 밖이면 오른쪽 아래로 돌아간다.
// 17차: 좌표는 논리 좌표(포인트)로만 다룬다 — 예전엔 물리 픽셀로 저장해서 레티나에서
// 두 배 위치(화면 밖)로 가버리는 버그가 있었다.
static SAVED_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);

fn pos_file() -> std::path::PathBuf {
    project_root().join("data").join("widget-pos.json")
}

fn load_saved_pos() {
    let pos = std::fs::read_to_string(pos_file())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| Some((v.get("x")?.as_f64()?, v.get("y")?.as_f64()?)));
    *SAVED_POS.lock().unwrap() = pos;
}

fn remember_pos(window: &tauri::WebviewWindow, p: tauri::PhysicalPosition<i32>) {
    // 숨긴 창의 위치 변화는 무시 (사용자가 옮긴 게 아니다)
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let l: tauri::LogicalPosition<f64> = p.to_logical(scale);
    let mut saved = SAVED_POS.lock().unwrap();
    if *saved == Some((l.x, l.y)) {
        return;
    }
    *saved = Some((l.x, l.y));
    let _ = std::fs::write(pos_file(), format!("{{\"x\":{},\"y\":{}}}", l.x, l.y));
}

fn place_window(window: &tauri::WebviewWindow) {
    let saved = *SAVED_POS.lock().unwrap();
    if let Some((x, y)) = saved {
        // 위젯 전체가 어느 한 모니터 안에 들어올 때만 그 자리를 쓴다.
        let fits = window.available_monitors().unwrap_or_default().iter().any(|m| {
            let sf = m.scale_factor();
            let pos: tauri::LogicalPosition<f64> = m.position().to_logical(sf);
            let size: tauri::LogicalSize<f64> = m.size().to_logical(sf);
            x >= pos.x && y >= pos.y && x + WIDGET_WIDTH <= pos.x + size.width && y + WIDGET_HEIGHT <= pos.y + size.height
        });
        if fits {
            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
            return;
        }
    }
    position_bottom_right(window);
}

/// 10차: 긴 작업이 끝나면 "삐빅" 한 번 울린다 (13차: 두 번은 과하다는 피드백). 30초도 안 걸린 짧은 답변엔
/// 안 울린다 (마스코트가 떠 있는 turn이 끝날 때만). 시스템 알림 설정과 상관없이
/// 들리도록 알림 사운드 대신 afplay로 직접 재생한다.
fn beep(tool: &str) {
    // 14차: 어느 쪽이 끝났는지 소리로도 구별. 15차: Tink/Pop은 너무 짧고 작아서 잘 안
    // 들린다는 피드백 — 또렷한 Glass(Claude) / Hero(Codex)로 바꾸고 조금 키운다.
    let sound = if tool == "Codex" {
        "/System/Library/Sounds/Hero.aiff"
    } else {
        "/System/Library/Sounds/Glass.aiff"
    };
    let _ = Command::new("/bin/sh")
        .arg("-c")
        .arg(format!("afplay -v 1.6 '{sound}'"))
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

/// 페이지를 서서히 투명하게 만든 뒤 창을 숨긴다. 16차: 숨긴 동안은 게임 시간을 세지
/// 않도록 window.__idleHidden을 켠다 (games/track.js). 다음에 띄울 땐 auto_show가
/// 페이지를 새로 불러오니 투명도는 저절로 원래대로 돌아온다.
fn fade_out_and_hide(window: &tauri::WebviewWindow) {
    let _ = window.eval(&format!(
        "window.__idleHidden=true;\
         document.documentElement.style.transition='opacity {FADE_MS}ms ease';\
         document.documentElement.style.opacity='0';"
    ));
    thread::sleep(Duration::from_millis(FADE_MS + 50));
    let _ = window.hide();
}

/// 14차: 창 아래쪽에 "✅ Codex 작업 끝났어요" 같은 알림을 잠깐 띄운다. 게임 화면이든
/// 추천 화면이든 어느 페이지에서나 뜨도록 JS로 직접 붙인다.
fn show_toast(window: &tauri::WebviewWindow, ko: &str, en: &str, tool: &str) {
    let bg = if tool == "Codex" { "#111827" } else { "#c96442" };
    // 17차: 페이지 언어(i18n.js의 window.L)에 맞춰 고른다.
    let ko = serde_json::to_string(ko).unwrap_or_else(|_| "\"\"".into());
    let en = serde_json::to_string(en).unwrap_or_else(|_| "\"\"".into());
    let _ = window.eval(&format!(
        "(()=>{{let t=document.getElementById('__idle_toast');\
         if(!t){{t=document.createElement('div');t.id='__idle_toast';\
         t.style.cssText='position:fixed;left:14px;right:14px;bottom:14px;padding:10px 12px;border-radius:12px;\
         color:#fff;font:600 13px -apple-system,sans-serif;text-align:center;z-index:99999;\
         box-shadow:0 6px 18px rgba(0,0,0,.25);transition:opacity .3s;word-break:keep-all';\
         document.body.appendChild(t);}}\
         t.style.background='{bg}';t.textContent=(window.L==='en'?{en}:{ko});t.style.opacity='1';\
         clearTimeout(window.__idleToastT);window.__idleToastT=setTimeout(()=>t.style.opacity='0',4000);}})()"
    ));
}

fn spawn_auto_popup_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        // 이미 한 번 띄운 turn들 — 그 turn 때문에 다시 튀어나오지 않게 (사용자가
        // 닫았거나, 다른 turn이 끝나 숨긴 뒤에도).
        let mut popped: HashSet<String> = HashSet::new();
        // 마스코트를 띄운 뒤로 진행 중인 turn들. 14차: Claude와 Codex를 같이 쓰면
        // 작업이 겹칠 수 있다 — 창은 하나만 두고, 겹친 작업 중 마지막 것이 끝날
        // 때 한 번만 삐빅 울리고 숨긴다 (먼저 끝난 쪽이 창을 닫거나, 닫혔다 다시
        // 뜨지 않게). 작업이 하나뿐이면 예전처럼 그 작업이 끝나면 바로 사라진다.
        let mut showing: HashMap<String, &'static str> = HashMap::new();
        loop {
            thread::sleep(Duration::from_secs(2));
            let (turn, active) = read_working_turn(now_ms());
            let Some(window) = app.get_webview_window("mascot") else {
                continue;
            };

            if !showing.is_empty() {
                let mut ended: Vec<&'static str> = Vec::new();
                showing.retain(|key, tool| {
                    let alive = active.contains_key(key);
                    if !alive {
                        ended.push(*tool);
                    }
                    alive
                });
                if let Some(&tool) = ended.last() {
                    if window.is_visible().unwrap_or(false) {
                        if showing.is_empty() {
                            // 마지막 작업이 끝났다 — 누가 끝났는지 보여주고, 그 도구의
                            // 소리 한 번, 잠깐 뒤 스르륵.
                            show_toast(
                                &window,
                                &format!("✅ {tool} 작업 끝났어요"),
                                &format!("✅ {tool} is done"),
                                tool,
                            );
                            beep(tool);
                            thread::sleep(Duration::from_millis(1600));
                            fade_out_and_hide(&window);
                        } else {
                            // 한쪽만 끝났다 — 창은 두고 알림만 (소리는 마지막에 한 번).
                            let mut still: Vec<&str> = showing.values().copied().collect();
                            still.sort();
                            still.dedup();
                            show_toast(
                                &window,
                                &format!("✅ {tool} 작업 끝났어요 · {}는 아직 작업 중", still.join("·")),
                                &format!("✅ {tool} is done · {} still working", still.join(" & ")),
                                tool,
                            );
                        }
                    }
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
                    // 창이 떠 있는 동안 진행 중인 다른 작업도 같이 지켜본다.
                    showing.extend(active.iter().map(|(k, v)| (k.clone(), *v)));
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
            // 14차: 투명 창인데도 네모 틀이 보였다 — 창·웹뷰 바탕을 완전 투명으로
            // 지정하고, macOS 창 그림자(네모 테두리처럼 보임)도 끈다. 둥근 카드와
            // 그림자는 페이지 CSS가 그린다.
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .shadow(false)
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

            load_saved_pos();
            if let Some(w) = app.get_webview_window("mascot") {
                let win = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::Moved(p) = event {
                        remember_pos(&win, *p);
                    }
                });
            }

            spawn_auto_popup_watcher(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AI Side Quest mascot app")
        .run(|app, event| {
            // 22차: 위젯은 작업이 30초 넘을 때만 저절로 떠서, 그 밖엔 손으로 띄울 방법이
            // 없었다 ("꺼졌다"로 보였다). 이미 떠 있는 앱을 다시 실행하면(Spotlight, Finder,
            // `open -a`) macOS가 Reopen을 보내니 그때 추천 화면을 띄운다.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("mascot") {
                    manual_show(&w);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

/// 앱을 다시 실행했을 때 — 하던 게임으로 건너뛰지 않고 추천 화면(토큰 그래프)부터.
fn manual_show(window: &tauri::WebviewWindow) {
    if let Ok(url) = QUEST_URL.parse() {
        let _ = window.navigate(url);
    }
    place_window(window);
    let _ = window.show();
}
