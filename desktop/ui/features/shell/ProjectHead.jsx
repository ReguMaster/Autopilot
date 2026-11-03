import { getProjectName } from "../../lib/projectName.js";
import { useAppStore } from "../../stores/appStore.js";

// 본문 맨 위의 프로젝트 이름과 경로. 오른쪽(children)에는 화면마다 다른 것(작업 모드 전환·상태 태그)을 둔다. 프로젝트를 고르지 않았으면 그리지 않는다.
// hideName이면 이름과 경로는 빼고 children만 남긴다(시작 전 화면. 레일이 이미 프로젝트 이름을 보인다).
const ProjectHead = ({ children, hideName = false }) => {
    const projectDir = useAppStore((store) => store.settings.projectDir);

    if (!projectDir) {
        return null;
    }

    return (
        <header className="project-head" data-bare={hideName ? "" : undefined}>
            {hideName ? null : (
                <div className="project-head-name">
                    <h2 className="project-title">{getProjectName(projectDir)}</h2>
                    <p className="project-path" title={projectDir}>
                        {projectDir}
                    </p>
                </div>
            )}
            {children}
        </header>
    );
};

export { ProjectHead };
