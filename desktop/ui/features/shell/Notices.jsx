import { accounts } from "../../actions/accounts.js";
import { selectProject } from "../../actions/run.js";
import { settings } from "../../actions/settings.js";
import { Button } from "../../components/Button.jsx";
import { useLoginExpiry } from "../../hooks/useLoginExpiry.js";
import { useAppStore } from "../../stores/appStore.js";
import { useClock } from "../../stores/clock.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";

const POST_ACTION_LABELS = { sleep: "절전", shutdown: "종료" };

// 실행이 끝난 뒤 PC를 절전·종료하기 전의 카운트다운. 바로 실행하거나 취소할 수 있다.
const PostActionBanner = () => {
    const postAction = useUiStore((store) => store.postAction);
    const seconds = useClock((now) => (postAction ? Math.max(0, Math.ceil((postAction.at - now) / 1000)) : 0));
    const label = POST_ACTION_LABELS[postAction?.action] ?? "";

    return (
        <p id="post-action-banner" className="notice" data-tone="warn" hidden={!postAction}>
            <span id="post-action-message">{postAction ? `실행이 끝났어요. ${seconds}초 뒤 PC를 ${label}해요.` : ""}</span>
            <span className="notice-actions">
                <Button id="post-action-now" onClick={settings.runPostActionNow}>
                    지금 {label}
                </Button>
                <Button id="post-action-cancel" onClick={settings.cancelPostAction}>
                    취소
                </Button>
            </span>
        </p>
    );
};

// 컴포저 바로 위의 안내 문구. 비어 있으면 자리를 차지하지 않는다.
const Notices = () => {
    const notice = useUiStore((store) => store.notice);
    const loginBanner = useUiStore((store) => store.loginBanner);
    const hasProject = useAppStore((store) => Boolean(store.settings.projectDir));
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const expiry = useLoginExpiry();

    return (
        <div className="notices">
            <p id="notice" className="notice" role="alert" hidden={!notice.message} data-tone={notice.tone || undefined}>
                {notice.message}
            </p>
            <PostActionBanner />
            <p id="login-banner" className="notice" data-tone="warn" hidden={loginBanner === null}>
                <span id="login-banner-message">{loginBanner}</span>{" "}
                <Button id="banner-login" onClick={() => accounts.loginFromBanner()}>
                    로그인
                </Button>
            </p>
            <p id="login-expiry-banner" className="notice" data-tone="warn" hidden={!expiry?.banner}>
                <span id="login-expiry-message">{expiry?.banner}</span>{" "}
                <Button id="banner-relogin" disabled={!isIdle} onClick={accounts.reloginBeforeExpiry}>
                    다시 로그인
                </Button>
            </p>
            <p id="project-banner" className="notice" data-tone="warn" hidden={hasProject}>
                대상 프로젝트 폴더를 먼저 골라 주세요.{" "}
                <Button id="banner-select-project" disabled={!isIdle} onClick={selectProject}>
                    폴더 선택
                </Button>
            </p>
        </div>
    );
};

export { Notices };
