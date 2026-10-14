import { useEffect } from "react";
import { schedules } from "../actions/schedules.js";
import { useScheduleStore } from "../stores/scheduleStore.js";
import { ui } from "../stores/uiStore.js";

const focusById = (id) => document.getElementById(id)?.focus();

// 패널이 열린 채로 화면의 다른 곳을 누르거나 Esc를 누르면 닫는다. 열린 팝오버(선택 목록 등)는 브라우저가 Esc로 먼저 닫으므로 그 Esc는 건너뛴다.
const useOverlayDismiss = () => {
    useEffect(() => {
        const handlePointerDown = (event) => {
            const { panel } = ui.get();

            if (panel && !document.getElementById(panel)?.contains(event.target) && !document.getElementById(`${panel}-toggle`)?.contains(event.target)) {
                ui.setPanel(null);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key !== "Escape" || document.querySelector(":popover-open")) {
                return;
            }

            const { panel, history, archive, schedule } = ui.get();

            if (panel) {
                ui.setPanel(null);
                focusById(`${panel}-toggle`);
            } else if (history) {
                ui.setHistory(false);
                focusById("live-panel");
            } else if (archive) {
                ui.setArchive(false);
                focusById("archive-all");
            } else if (schedule) {
                if (useScheduleStore.getState().pane === "list") {
                    schedules.close();
                    focusById("schedule-toggle");
                } else {
                    schedules.closeForm();
                }
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);
};

export { useOverlayDismiss };
