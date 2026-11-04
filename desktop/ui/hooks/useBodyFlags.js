import { useEffect, useLayoutEffect } from "react";

const OVERLAYS = ["settings", "profile", "history", "archive", "schedule"];

// ui/styles의 CSS가 body의 data-속성·클래스를 보고 화면을 바꾼다. 화면 상태를 그 한 곳에 반영한다.
const useBodyFlags = ({ view, status, isTasksOpen, isApproval, isCreating = false, isHome = false, panel, history, archive, schedule }) => {
    useLayoutEffect(() => {
        const open = { settings: panel === "settings", profile: panel === "profile", history: history, archive: archive, schedule: schedule };

        document.body.dataset.view = view;
        document.body.dataset.status = status;
        document.body.toggleAttribute("data-tasks-open", isTasksOpen);
        document.body.toggleAttribute("data-approval", isApproval);
        document.body.toggleAttribute("data-creating", isCreating);
        document.body.toggleAttribute("data-home", isHome);

        for (const name of OVERLAYS) {
            document.body.classList.toggle(`${name}-open`, open[name]);
        }
    }, [view, status, isTasksOpen, isApproval, isCreating, isHome, panel, history, archive, schedule]);
};

const BOOT_MIN_SHOW_MS = 1200;
// styles/boot.css의 걷힘 애니메이션(가장 긴 것 1.1초)이 끝난 뒤에 덮개를 지운다
const BOOT_LIFT_MS = 1400;

// 서체와 첫 상태가 준비된 뒤에 화면을 차례로 드러낸다(그 전에는 CSS가 등장 애니메이션을 멈춰 둔다).
// index.html의 부팅 덮개는 창이 열린 지 BOOT_MIN_SHOW_MS가 지나야 걷는다(움직임 줄이기는 바로).
const useRevealWhenReady = () => {
    useEffect(() => {
        let frame = 0;
        let lift = 0;
        let remove = 0;

        document.fonts.ready.then(() => {
            const isReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

            frame = requestAnimationFrame(() => document.body.classList.add("ready"));
            lift = setTimeout(
                () => {
                    const cover = document.getElementById("boot");

                    if (cover) {
                        cover.dataset.state = "lifting";
                        remove = setTimeout(() => cover.remove(), BOOT_LIFT_MS);
                    }
                },
                isReduced ? 0 : Math.max(0, BOOT_MIN_SHOW_MS - performance.now())
            );
        });

        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(lift);
            clearTimeout(remove);
        };
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
