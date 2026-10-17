import { STATUS_OK } from "../lib/constants.js";
import { composer, useComposerStore } from "../stores/composerStore.js";
import { applySchedulePayload, useScheduleStore } from "../stores/scheduleStore.js";
import { ui } from "../stores/uiStore.js";

const SCHEDULE_NOTICE_MS = 4000;

let noticeTimer = 0;

const setNote = (message, tone = "") => {
    clearTimeout(noticeTimer);
    useScheduleStore.setState({ note: { message: message, tone: tone } });

    if (message && tone !== "warn") {
        noticeTimer = setTimeout(() => setNote(""), SCHEDULE_NOTICE_MS);
    }
};

const schedules = {
    open: () => {
        ui.setSchedule(true);
        setNote("");
        useScheduleStore.setState({ pane: "list", editing: null });
    },
    close: () => ui.setSchedule(false),
    openForm: (schedule) => useScheduleStore.setState({ pane: "form", editing: schedule }),
    closeForm: () => useScheduleStore.setState({ pane: "list", editing: null }),
    // 저장하는 순간의 작업·정책·모델·Effort를 예약에 담는다. 실패하면 메시지를 돌려줘 폼이 보여준다.
    save: async (schedule) => {
        const { tasks, policy, extendOnLimit } = useComposerStore.getState();
        const result = await window.autopilot.saveSchedule({ schedule: schedule, options: { tasks: tasks, policy: policy, extendOnLimit: extendOnLimit, ...composer.getSelectedOptions() } });

        if (result.status !== STATUS_OK) {
            return result.error.msg;
        }

        applySchedulePayload(result.data);
        useScheduleStore.setState({ pane: "list", editing: null });
        setNote("예약을 저장했어요.", "ok");

        return "";
    },
    remove: async (id) => {
        const result = await window.autopilot.deleteSchedule(id);

        if (result.status === STATUS_OK) {
            applySchedulePayload(result.data);
            setNote("예약을 삭제했어요.", "ok");
        }
    },
    toggle: async (id, enabled) => {
        const result = await window.autopilot.toggleSchedule(id, enabled);

        if (result.status === STATUS_OK) {
            applySchedulePayload(result.data);
        }
    }
};

export { schedules };
