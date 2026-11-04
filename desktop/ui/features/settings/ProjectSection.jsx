import { settings } from "../../actions/settings.js";
import { Button } from "../../components/Button.jsx";
import { SettingsGroup } from "../../components/SettingsGroup.jsx";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { GitGroup } from "./GitGroup.jsx";
import { StorageGroup } from "./StorageGroup.jsx";

const MAX_LINKED_REPOS = 2;

// 백엔드·프론트처럼 나뉜 저장소를 한 실행에서 함께 다룬다. 작업 프로젝트를 합쳐 3개까지이고, 저장소마다 따로 커밋·push한다.
const LinkedRepos = () => {
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const linkedRepos = useAppStore((store) => store.settings.linkedRepos);
    const isIdle = useRunStore((store) => store.state.status === "idle");

    return (
        <SettingsGroup id="group-project" title="연결 저장소">
            <div className="field linked-repos">
                <div className="field-head">
                    <h4 className="field-title">함께 다룰 저장소</h4>
                    <span id="linked-repos-count" className="tag">
                        {linkedRepos.length + 1} / {MAX_LINKED_REPOS + 1}개
                    </span>
                    <Button id="add-linked-repo" disabled={!isIdle || !projectDir || linkedRepos.length >= MAX_LINKED_REPOS} onClick={settings.addLinkedRepo}>
                        저장소 추가
                    </Button>
                </div>
                <ul id="linked-repos" className="repo-list">
                    {linkedRepos.map((repoDir) => (
                        <li key={repoDir} className="repo-item">
                            <span className="path">{repoDir}</span>
                            <Button disabled={!isIdle} aria-label={`${repoDir} 연결 해제`} onClick={() => settings.removeLinkedRepo(repoDir)}>
                                해제
                            </Button>
                        </li>
                    ))}
                </ul>
                <p className="field-desc">
                    지금 보는 프로젝트와 함께 최대 {MAX_LINKED_REPOS + 1}개까지 연결해요. 한 세션이 모두 보고 고치며, 변경한 저장소마다 따로 커밋하고 작업 브랜치로 push해요. 커밋 접두어와 작업
                    브랜치는 모두 같아요.
                </p>
            </div>
        </SettingsGroup>
    );
};

const ProjectSection = () => {
    return (
        <>
            <LinkedRepos />
            <GitGroup />
            <StorageGroup />
        </>
    );
};

export { ProjectSection };
