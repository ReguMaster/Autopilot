import { Icon } from "../../components/Icon.jsx";
import { getProjectName } from "../../lib/projectName.js";
import { useAppStore } from "../../stores/appStore.js";
import { ui } from "../../stores/uiStore.js";

// 연결 저장소가 있을 때만 나오는 한 줄. 시작 전에는 이번에 붙을 저장소를, 실행 중에는 엔진에 넘긴 저장소를 알린다(실행 중에는 설정이 잠겨 같다). 누르면 설정을 연다.
const LinkedRepoPeek = () => {
    const linkedRepos = useAppStore((store) => store.settings.linkedRepos);

    if (!linkedRepos?.length) {
        return null;
    }

    return (
        <button type="button" id="linked-repo-peek" className="peek" aria-controls="settings" onClick={() => ui.setPanel("settings")}>
            <Icon symbol="icon-plus" />
            <span>
                연결 저장소 {linkedRepos.length}개 · {linkedRepos.map(getProjectName).join(", ")}
            </span>
        </button>
    );
};

export { LinkedRepoPeek };
