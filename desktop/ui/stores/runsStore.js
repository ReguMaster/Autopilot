import { create } from "zustand";

// 지난 실행: 시작 화면의 최근 목록과 시트의 전체 목록·상세. 원본은 대상 프로젝트의 로그 파일이고 읽기는 메인 프로세스가 한다.
// buildPhase는 보는 프로젝트의 신규 개발 단계 상태({phase, awaiting, qaRetries, securityRetries, proposals}, 한 적 없으면 null)다.
// phases는 열린 모든 탭의 단계 상태를 프로젝트 경로로 기억한 것이다. 프로젝트를 바꿀 때 바로 보이고 레일이 다른 탭의 확인 대기를 알린다.
// providers는 다른 AI 제공자를 쓸 수 있는지({codex: {available, reason}}, 아직 모르면 null)다.
const useRunsStore = create(() => ({
    recent: [],
    streakDays: [],
    buildPhase: null,
    phases: {},
    providers: null,
    list: [],
    pane: "list",
    note: { message: "", tone: "" },
    detail: null,
    isListLoaded: false
}));

export { useRunsStore };
