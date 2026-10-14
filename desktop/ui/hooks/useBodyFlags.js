import { useEffect, useLayoutEffect } from "react";

const OVERLAYS = ["settings", "profile", "history", "archive", "schedule"];

// ui/styles의 CSS가 body의 data-속성·클래스를 보고 화면을 바꾼다. 화면 상태를 그 한 곳에 반영한다.
const useBodyFlags = ({ view, status, isTasksOpen, panel, history, archive, schedule }) => {
    useLayoutEffect(() => {
        const open = { settings: panel === "settings", profile: panel === "profile", history: history, archive: archive, schedule: schedule };

        document.body.dataset.view = view;
        document.body.dataset.status = status;
        document.body.toggleAttribute("data-tasks-open", isTasksOpen);

        for (const name of OVERLAYS) {
            document.body.classList.toggle(`${name}-open`, open[name]);
        }
    }, [view, status, isTasksOpen, panel, history, archive, schedule]);
};

// 서체와 첫 상태가 준비된 뒤에 화면을 차례로 드러낸다(그 전에는 CSS가 등장 애니메이션을 멈춰 둔다).
const useRevealWhenReady = () => {
    useEffect(() => {
        let frame = 0;

        document.fonts.ready.then(() => {
            frame = requestAnimationFrame(() => document.body.classList.add("ready"));
        });

        return () => cancelAnimationFrame(frame);
    }, []);
};

// 창을 숨기면(트레이) 반복 애니메이션을 멈추고, 앱처럼 보이도록 브라우저 기본 동작(오른쪽 메뉴, 파일 끌어 놓기 이동)을 막는다. 입력 칸은 붙여넣기 때문에 메뉴를 남긴다.
const useNativeFeel = () => {
    useEffect(() => {
        const handleContextMenu = (event) => {
            if (!event.target.closest("input, textarea, .log")) {
                event.preventDefault();
            }
        };
        const preventDefault = (event) => event.preventDefault();
        const handleVisibility = () => document.documentElement.classList.toggle("window-hidden", document.hidden);

        document.addEventListener("contextmenu", handleContextMenu);
        document.addEventListener("dragover", preventDefault);
        document.addEventListener("drop", preventDefault);
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
            document.removeEventListener("dragover", preventDefault);
            document.removeEventListener("drop", preventDefault);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);
};

export { useBodyFlags, useRevealWhenReady, useNativeFeel };
