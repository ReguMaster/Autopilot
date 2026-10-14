import { create } from "zustand";

// 예약 목록과 시트의 보기(목록·폼), 수정 중인 예약, 마지막 안내 문구. 목록은 메인 프로세스의 예약기가 보내 준다.
const useScheduleStore = create(() => ({
    payload: { schedules: [], statuses: [], maxSchedules: 8, defaults: null },
    pane: "list",
    editing: null,
    note: { message: "", tone: "" }
}));

const applySchedulePayload = (payload) => {
    useScheduleStore.setState({ payload: payload });
};

export { useScheduleStore, applySchedulePayload };
