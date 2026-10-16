import { useAppStore } from "../stores/appStore.js";
import { appendEntries, applyRunState, clearLogs, flushNow } from "../stores/runStore.js";

// 메인은 열려 있는 모든 프로젝트 세션의 이벤트를 projectDir을 달아 보낸다. 화면은 지금 보는 프로젝트의 것만 반영한다.
const isViewing = (projectDir) => projectDir === useAppStore.getState().settings.projectDir;

const handleStateEvent = ({ projectDir, state }) => {
    if (isViewing(projectDir)) {
        applyRunState(state);
    }
};

const handleLogEvent = ({ projectDir, entries }) => {
    if (isViewing(projectDir)) {
        appendEntries(entries);
    }
};

// 보는 프로젝트가 바뀔 때 메인이 준 그 프로젝트의 지금 상태와 로그로 바꾼다.
const applySessionSnapshot = ({ state, logs }) => {
    applyRunState(state);
    clearLogs();
    appendEntries(logs);
    flushNow();
};

export { isViewing, handleStateEvent, handleLogEvent, applySessionSnapshot };
