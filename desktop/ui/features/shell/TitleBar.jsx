import { openUpdate } from "../../actions/run.js";
import { useAppStore } from "../../stores/appStore.js";

// 본문 위 한 줄. 창 프레임을 대신하는 끌기 영역이고 버튼만 뺀다(styles/shell.css). 오른쪽에 새 버전 알림과 창 버튼을 둔다. 프로젝트별 진행 상태는 레일이 알린다.
const TitleBar = () => {
    const update = useAppStore((store) => store.update);
    const version = useAppStore((store) => store.version);
    const maximized = useAppStore((store) => store.maximized);
    const maximizeLabel = maximized ? "이전 크기로" : "최대화";

    return (
        <header id="titlebar" className="titlebar" data-maximized={maximized ? "" : undefined}>
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
