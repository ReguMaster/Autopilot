import { create } from "zustand";

// 지난 실행: 시작 화면의 최근 목록과 시트의 전체 목록·상세. 원본은 대상 프로젝트의 로그 파일이고 읽기는 메인 프로세스가 한다.
const useRunsStore = create(() => ({
    recent: [],
    streakDays: [],
    list: [],
    pane: "list",
    note: { message: "", tone: "" },
    detail: null,
    isListLoaded: false
}));

export { useRunsStore };
