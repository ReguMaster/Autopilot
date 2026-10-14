import { STATUS_OK } from "../lib/constants.js";
import { useRunsStore } from "../stores/runsStore.js";
import { ui } from "../stores/uiStore.js";

const RECENT_RUN_COUNT = 3;
const MAX_ARCHIVE_RUNS = 200;

let recentToken = 0;
let archiveToken = 0;

const setNote = (message, tone = "") => useRunsStore.setState({ note: { message: message, tone: tone } });

// 목록을 읽지 못해도 시작 화면은 그대로 쓸 수 있어야 하므로 실패하면 조용히 비운다.
const loadRecentRuns = async () => {
    const token = ++recentToken;
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
    const result = await window.autopilot.deleteRun(useRunsStore.getState().detail.run.id);

    if (result.status !== STATUS_OK) {
        setNote(result.error.msg, "warn");

        return;
    }

    if (!result.data.cancelled) {
        await openArchiveList();
        loadRecentRuns();
        setNote("기록을 지웠어요.");
    }
};

export { loadRecentRuns, openArchiveList, openArchiveDetail, openArchiveFile, deleteArchiveRun };
