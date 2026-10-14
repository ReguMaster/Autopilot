import { openUpdate } from "../../actions/run.js";
import { schedules } from "../../actions/schedules.js";
import { useAppStore } from "../../stores/appStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

// 헤더는 창 프레임을 대신해 직접 그린다. 전체가 끌기 영역이고 버튼만 뺀다(styles.css).
const TitleBar = () => {
    const update = useAppStore((store) => store.update);
    const version = useAppStore((store) => store.version);
    const maximized = useAppStore((store) => store.maximized);
    const panel = useUiStore((store) => store.panel);
    const isScheduleOpen = useUiStore((store) => store.schedule);
    const maximizeLabel = maximized ? "이전 크기로" : "최대화";

    return (
        <header id="titlebar" className="titlebar" data-maximized={maximized ? "" : undefined}>
            <img className="brand" src="../docs/logo.png" alt="AutoPilot" />
            <div className="window-controls">
                <button
                    type="button"
                    id="update-chip"
                    className="update-chip"
                    hidden={!update}
                    title={update ? `새 버전 v${update.version}이 나왔어요 (현재 v${version}). 누르면 다운로드 페이지가 열려요.` : undefined}
                    aria-label={update ? `새 버전 v${update.version} 다운로드 페이지 열기` : undefined}
                    onClick={openUpdate}
                >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M6 9.5V2.8M3.2 5.4L6 2.6l2.8 2.8" />
                    </svg>
                    <span id="update-label" className="num">
                        {update ? `v${update.version}` : ""}
                    </span>
                </button>
                <button
                    type="button"
                    id="schedule-toggle"
                    className="window-control"
                    aria-label="예약"
                    title="예약"
                    aria-expanded={isScheduleOpen}
                    aria-controls="schedule"
                    onClick={() => (isScheduleOpen ? schedules.close() : schedules.open())}
                >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <circle cx="6" cy="6" r="4.4" />
                        <path d="M6 3.6V6l1.7 1.1" />
                    </svg>
                </button>
                <button
                    type="button"
                    id="profile-toggle"
                    className="window-control"
                    aria-label="프로필"
                    title="프로필"
                    aria-expanded={panel === "profile"}
                    aria-controls="profile"
                    onClick={() => ui.togglePanel("profile")}
                >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <circle cx="6" cy="4.2" r="2.1" />
                        <path d="M2 10.4c.5-2.1 2.1-3.1 4-3.1s3.5 1 4 3.1" />
                    </svg>
                </button>
                <button
                    type="button"
                    id="settings-toggle"
                    className="window-control"
                    aria-label="설정"
                    title="설정"
                    aria-expanded={panel === "settings"}
                    aria-controls="settings"
                    onClick={() => ui.togglePanel("settings")}
                >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M10.93 5.18L10.93 6.82L9.78 6.94L9.34 8.01L10.07 8.91L8.91 10.07L8.01 9.34L6.94 9.78L6.82 10.93L5.18 10.93L5.06 9.78L3.99 9.34L3.09 10.07L1.93 8.91L2.66 8.01L2.22 6.94L1.07 6.82L1.07 5.18L2.22 5.06L2.66 3.99L1.93 3.09L3.09 1.93L3.99 2.66L5.06 2.22L5.18 1.07L6.82 1.07L6.94 2.22L8.01 2.66L8.91 1.93L10.07 3.09L9.34 3.99L9.78 5.06Z" />
                        <circle cx="6" cy="6" r="1.6" />
                    </svg>
                </button>
                <span className="window-separator" aria-hidden="true"></span>
                <button type="button" id="window-minimize" className="window-control" aria-label="최소화" title="최소화" onClick={() => window.appWindow.minimize()}>
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 6h7" />
                    </svg>
                </button>
                <button type="button" id="window-maximize" className="window-control" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => window.appWindow.toggleMaximize()}>
                    <svg className="icon-maximize" viewBox="0 0 12 12" aria-hidden="true">
                        <rect x="2.5" y="2.5" width="7" height="7" rx="1.5" />
                    </svg>
                    <svg className="icon-restore" viewBox="0 0 12 12" aria-hidden="true">
                        <rect x="2" y="4" width="6" height="6" rx="1.3" />
                        <path d="M4.5 4v-.5A1.5 1.5 0 0 1 6 2h2.5A1.5 1.5 0 0 1 10 3.5V6a1.5 1.5 0 0 1-1.5 1.5H8" />
                    </svg>
                </button>
                <button type="button" id="window-close" className="window-control close" aria-label="닫기" title="닫기" onClick={() => window.appWindow.close()}>
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                </button>
            </div>
        </header>
    );
};

export { TitleBar };
