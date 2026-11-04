import { STATUS_OK } from "../lib/constants.js";
import { getLatestRun } from "../lib/homeModel.js";
import { useRunsStore } from "../stores/runsStore.js";
import { ui } from "../stores/uiStore.js";
import { openArchiveDetail } from "./runs.js";
import { activateTab } from "./tabs.js";

// 끝나지 않았거나 비어 있는 기록을 건너뛰고도 가장 최근에 끝난 실행을 찾을 만큼만 읽는다.
const LATEST_RUN_SCAN = 3;

let latestToken = 0;

const openHome = () => {
    ui.set({ home: true, newProject: false });
    ui.closeAll();
};

// 열린 프로젝트마다 가장 최근에 끝난 실행을 읽는다. 읽지 못한 프로젝트는 없는 것으로 두고, 늦게 온 앞 요청의 응답은 버린다.
const loadLatestRuns = async (projectDirs) => {
    const token = ++latestToken;
    const entries = await Promise.all(
        projectDirs.map(async (projectDir) => {
            const result = await window.autopilot.listRuns(LATEST_RUN_SCAN, projectDir);

            return [projectDir, result.status === STATUS_OK ? getLatestRun(result.data.runs) : null];
        })
    );

    if (token === latestToken) {
        useRunsStore.setState({ latestRuns: Object.fromEntries(entries) });
    }
};

// 그 프로젝트로 가서 이어 간다. 확인 대기·실행 중·시작 전 화면은 프로젝트의 상태가 정한다.
const continueProject = (projectDir) => activateTab(projectDir);

const openLastRun = async ({ projectDir, runId }) => {
    await activateTab(projectDir);
    openArchiveDetail(runId);
};

const openLastReport = async ({ projectDir, runId }) => {
    ui.showFailure(await window.autopilot.openRunFile(runId, "report", projectDir));
};

export { openHome, loadLatestRuns, continueProject, openLastRun, openLastReport };
