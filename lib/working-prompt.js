'use strict';

const { BUDGET_OPTIONS } = require('./timebudget');

const BUDGET_OPTIONS_TEXT = BUDGET_OPTIONS.map((o) => o.label).join(' / ');

/**
 * The in-agent instruction shown to Codex/Claude itself (not the human)
 * when a session transitions to WORKING. This text becomes the model's own
 * "developer context" for that turn (see architecture-research.md, 2차
 * 조사 7번) — the model is expected to relay the actual question to the
 * human in its own words at the end of its normal response.
 *
 * Shared by mcp/server.js (Stop/Notification path, mcp_tool hooks — already
 * verified working) and setup/claude-userprompt-relay.js (UserPromptSubmit,
 * command hook — the only path Claude Code's docs confirm actually injects
 * plain stdout as context Claude can act on, 2026-09-18 실측 결과).
 *
 * `sessionId`: 2026-09-18 4차 실측에서 발견 — 모델은 자기가 속한 세션의
 * session_id를 스스로 알 방법이 없다 (그건 훅 stdin에만 들어온다). 그래서
 * sidequest_select_time_budget을 호출할 때 sessionId를 안 넘기거나 잘못
 * 넘겼고, choices.local.jsonl에 "unknown-default"로 찍혀서 실제 작업
 * 세션과 연결이 끊기는 버그가 있었다 (V2/V3 개인화의 전제인 "세션별
 * 데이터 연결"이 깨짐). 훅 스크립트는 session_id를 알고 있으니, 그 값을
 * 지시문 안에 박아 넣고 "이 값을 그대로 sessionId로 넘겨"라고 명시해서
 * 고쳤다.
 *
 * 문구가 "떴어요"가 아니라 "뜰 거예요"(미래형)인 이유: 5차부터 사이드바가
 * 즉시 뜨지 않고 30초 넘게 걸릴 때만 뜬다 (lib/sidebar.js scheduleSidebar).
 * 이 지시문은 WORKING 전이 직후, 즉 30초가 지나기 전에 이미 만들어지므로
 * "떴다"고 단정하면 짧게 끝나는 작업에서 거짓말이 된다.
 */
function buildWorkingInstruction(sessionId) {
  const sessionLine = sessionId
    ? `sidequest_select_time_budget 도구를 호출할 때 sessionId 파라미터에 반드시 "${sessionId}" 값을 그대로 넣어줘 (다른 값으로 바꾸거나 생략하지 말 것). `
    : '';
  return (
    // 10차: 응답 끝에 마스코트 안내 문장을 붙이던 건 사용자 요청으로 뺐다 —
    // 마스코트는 알아서 뜨니 채팅에서 매번 말할 필요가 없다.
    `[AI Side Quest] 방금 작업을 시작했다. 응답은 평소대로 하고, 마스코트나 이 기능에 대한 안내 문장은 응답에 덧붙이지 말 것. ` +
    `이 기능의 목적은 사용자를 자리에서 떠나보내는 게 아니라, 작업을 기다리는 동안 심심하지 않게 할 일을 추천하는 것이다 — ` +
    `사용자에게 시간을 묻거나 답을 요구하지 말고, "자리 비우기", "다녀오세요" 같은 표현도 쓰지 말 것. ` +
    `사용자가 먼저 채팅으로 시간을 말하면(예: "10분", "끝날때까지") 그때만 ` +
    `sidequest_select_time_budget 도구를 그 값으로 호출하고, 반환된 퀘스트를 그대로 보여줘. ` +
    sessionLine +
    `그리고 도구를 쓰는 작업이라면, 첫 도구 호출과 함께 mcp__ai-side-quest__sidequest_report_estimate를 ` +
    `(스키마가 안 불려 있으면 ToolSearch로 불러서) 호출해 이번 작업 규모를 알려줘 — ` +
    `size는 SHORT(작은 수정·간단한 조사), MEDIUM(여러 파일 수정·테스트), LONG(빌드·대규모 작업·긴 조사) 중 하나, ` +
    `sessionId는 위와 같은 값. 도구 없이 바로 답하는 질문이면 호출하지 말 것. ` +
    `이 예상은 마스코트가 퀘스트 길이를 고르는 데만 쓴다 — ` +
    `절대 "이 작업은 N분 걸려요"처럼 구체적인 소요시간을 사용자에게 말하지 말 것.`
  );
}

module.exports = { buildWorkingInstruction, BUDGET_OPTIONS_TEXT };
