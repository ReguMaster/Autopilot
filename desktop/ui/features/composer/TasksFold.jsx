import { Icon } from "../../components/Icon.jsx";
import { getBuildStartPhase } from "../../lib/buildSteps.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { ui, useUiStore } from "../../stores/uiStore.js";

const getTaskLines = (tasks) => {
    return tasks
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

// 시작 전에는 작업을 적는 칸이고, 실행 중에는 잠긴 작업 요약 한 줄로 접힌다. 요약을 누르면 읽기 전용 칸이 펴진다(styles/composer.css의 .fold).
const TasksFold = () => {
    const tasks = useComposerStore((store) => store.tasks);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const isOpen = useUiStore((store) => store.tasksOpen);
    const isBuild = useComposerStore((store) => store.mode === "build");
    const isPlanNext = useRunsStore((store) => getBuildStartPhase(store.buildPhase) === "plan");
    const buildPlaceholder = isPlanNext ? "만들고 싶은 것을 적어 주세요. 기획은 이 내용으로 시작해요" : "이번 단계에 덧붙일 요청이 있으면 적어 주세요. 비워 둬도 이어서 해요";
    const lines = getTaskLines(tasks);
    const summary = isBuild
        ? { count: "만들 것", first: lines.join(" ") || "적어 둔 내용 없이 이어서 하고 있어요" }
        : { count: lines.length ? `작업 ${lines.length}개` : "작업 없이", first: lines.length ? lines.join(", ") : "스스로 개선점을 찾고 있어요" };

    return (
        <>
            <div className="fold fold-summary">
                <div>
                    <button
                        type="button"
                        id="tasks-toggle"
                        className="tasks-summary"
                        aria-controls="tasks-fold"
                        aria-expanded={isOpen}
                        title="처리할 작업 보기 (실행 중에는 바꿀 수 없어요)"
                        onClick={() => ui.set({ tasksOpen: !isOpen })}
                    >
                        <Icon symbol="icon-lock" />
                        <b id="tasks-count">{summary.count}</b>
                        <span id="tasks-first">{summary.first}</span>
                        <Icon symbol="icon-chevron" className="chevron" />
                    </button>
                </div>
            </div>
            <div id="tasks-fold" className="fold fold-tasks">
                <div>
                    <textarea
                        id="tasks"
                        className="tasks"
                        rows={4}
                        spellCheck={false}
                        aria-label={isBuild ? "만들 것" : "처리할 작업"}
                        placeholder={isBuild ? buildPlaceholder : "처리할 작업을 한 줄에 하나씩 적어 주세요 (지시개선은 꼭 필요해요)"}
                        value={tasks}
                        readOnly={!isIdle}
                        onChange={(event) => composer.setTasks(event.target.value)}
                    ></textarea>
                </div>
            </div>
        </>
    );
};

export { TasksFold };
