import { STATUS_OK } from "../lib/constants.js";
import { useAppStore } from "../stores/appStore.js";
import { modal } from "../stores/modalStore.js";
import { useRunsStore } from "../stores/runsStore.js";
import { ui } from "../stores/uiStore.js";

const RECENT_RUN_COUNT = 3;
const MAX_ARCHIVE_RUNS = 200;

let recentToken = 0;
let archiveToken = 0;
let streakToken = 0;
const phaseTokens = new Map();

const setNote = (message, tone = "") => useRunsStore.setState({ note: { message: message, tone: tone } });

// 실행한 날짜 목록. 시작 화면 인사의 연속 실행 문구에 쓰이므로 읽지 못해도 조용히 비운다.
const loadStreakDays = async () => {
    const token = ++streakToken;
    const result = await window.autopilot.getStreakDays();

    if (token === streakToken) {
        useRunsStore.setState({ streakDays: result.status === STATUS_OK ? result.data.days : [] });
    }
};

// 프로젝트의 단계 상태를 기억해 두고, 보는 프로젝트면 화면이 쓰는 buildPhase도 바꾼다.
const setBuildPhase = (projectDir, phase) => {
    const isViewed = projectDir === useAppStore.getState().settings.projectDir;

    useRunsStore.setState((store) => ({ phases: { ...store.phases, [projectDir]: phase }, buildPhase: isViewed ? phase : store.buildPhase }));
};

// 신규 개발의 단계 상태({phase, awaiting, qaRetries}, 한 적 없으면 null). 엔진 status로 읽으므로 실패하면 조용히 비운다. 프로젝트를 주지 않으면 보는 프로젝트다.
const loadBuildPhase = async (projectDir = useAppStore.getState().settings.projectDir) => {
    const token = (phaseTokens.get(projectDir) ?? 0) + 1;

    phaseTokens.set(projectDir, token);

    const result = await window.autopilot.getPhase(projectDir || undefined);

    if (phaseTokens.get(projectDir) === token) {
        setBuildPhase(projectDir, result.status === STATUS_OK ? result.data.phase : null);
    }
};

// 단계 카드가 Codex를 고를 수 있는지 보여주도록 메인에 묻는다(메인이 잠시 기억한다).
const loadProviders = async () => {
    const result = await window.autopilot.getProviders();

    useRunsStore.setState({ providers: result.status === STATUS_OK ? result.data : null });
};

// 목록을 읽지 못해도 시작 화면은 그대로 쓸 수 있어야 하므로 실패하면 조용히 비운다. 시작·탭 전환·실행 종료 뒤에 불려 단계 상태도 함께 읽는다.
const loadRecentRuns = async () => {
    const token = ++recentToken;

    loadStreakDays();
    loadBuildPhase();
    const result = await window.autopilot.listRuns(RECENT_RUN_COUNT);

    if (token === recentToken) {
        useRunsStore.setState({ recent: result.status === STATUS_OK ? result.data.runs : [] });
    }
};

const openArchiveList = async () => {
    const token = ++archiveToken;

    ui.setArchive(true);
    useRunsStore.setState({ pane: "list", isListLoaded: false });
    setNote("불러오는 중이에요.");

    const result = await window.autopilot.listRuns(MAX_ARCHIVE_RUNS);

    if (token !== archiveToken) {
        return;
    }

    useRunsStore.setState({ list: result.status === STATUS_OK ? result.data.runs : [], isListLoaded: true });

    if (result.status !== STATUS_OK) {
        setNote(result.error.msg, "warn");
    } else {
        setNote(result.data.runs.length ? "" : "아직 지난 실행이 없어요. 실행하면 기록이 프로젝트의 .autopilot/progress 폴더에 남아요.");
    }
};

const openArchiveDetail = async (id) => {
    const token = ++archiveToken;

    ui.setArchive(true);
    useRunsStore.setState({ pane: "detail", detail: null });
    setNote("불러오는 중이에요.");

    const result = await window.autopilot.readRun(id);

    if (token !== archiveToken) {
        return;
    }

    if (result.status !== STATUS_OK) {
        useRunsStore.setState({ pane: "list" });
        setNote(result.error.msg, "warn");

        return;
    }

    setNote("");
    useRunsStore.setState({ detail: result.data });
};

const openArchiveFile = async (kind) => {
    const result = await window.autopilot.openRunFile(useRunsStore.getState().detail.run.id, kind);

    if (result.status !== STATUS_OK) {
        setNote(result.error.msg, "warn");
    }
};

// 지운 뒤에는 목록으로 돌아가 지워졌음을 알리고, 시작 화면의 최근 목록도 다시 읽는다.
const deleteArchiveRun = async () => {
    const isConfirmed = await modal.confirm({
        title: "이 실행 기록을 지울까요?",
        message: "로그와 리포트가 지워지고 되돌릴 수 없어요. 커밋과 진행 기록(AUTOPILOT_PROGRESS.md)은 그대로예요.",
        confirmLabel: "삭제",
        tone: "danger"
    });

    if (!isConfirmed) {
        return;
    }

    const result = await window.autopilot.deleteRun(useRunsStore.getState().detail.run.id);

    if (result.status !== STATUS_OK) {
        setNote(result.error.msg, "warn");

        return;
    }

    await openArchiveList();
    loadRecentRuns();
    setNote("기록을 지웠어요.");
};

export { loadStreakDays, loadBuildPhase, setBuildPhase, loadProviders, loadRecentRuns, openArchiveList, openArchiveDetail, openArchiveFile, deleteArchiveRun };
