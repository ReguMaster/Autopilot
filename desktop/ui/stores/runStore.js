import { create } from "zustand";
import { getLineKind } from "../../viewFormat.js";
import { shareStructure } from "../lib/shareStructure.js";

const MAX_LOG_LINES = 3000;
const LOG_FLUSH_MS = 50;

// 엔진 실행 상태와 로그. 로그는 모아서 한 번에 반영하고(전체 기록과 이야기가 같은 묶음을 쓴다), 상태는 바뀌지 않은 조각의 참조를 유지한다.
const useRunStore = create(() => ({ state: null, logs: [] }));

const entryListeners = new Set();
let pending = [];
let flushTimer = 0;
let lineNumber = 0;

const applyRunState = (next) => {
    useRunStore.setState((current) => ({ state: shareStructure(current.state, next) }));
};

const flushEntries = () => {
    flushTimer = 0;

    const entries = pending;
    const kept = entries.slice(-MAX_LOG_LINES);

    pending = [];
    lineNumber += entries.length - kept.length;

    const lines = kept.map((entry) => ({ id: ++lineNumber, kind: getLineKind(entry), text: entry.text }));

    useRunStore.setState((current) => ({ logs: [...current.logs, ...lines].slice(-MAX_LOG_LINES) }));
    entryListeners.forEach((listener) => listener(entries));
};

// 처음 불러온 로그처럼 기다릴 필요가 없는 묶음은 바로 반영한다.
const flushNow = () => {
    clearTimeout(flushTimer);
    flushEntries();
};

const appendEntries = (entries) => {
    if (!entries.length) {
        return;
    }

    pending.push(...entries);

    if (!flushTimer) {
        flushTimer = setTimeout(flushEntries, LOG_FLUSH_MS);
    }
};

const clearLogs = () => {
    pending = [];
    lineNumber = 0;
    useRunStore.setState({ logs: [] });
};

// 보는 프로젝트가 바뀌어 로그를 통째로 바꿀 때. clearLogs(전체 기록 비우기)와 달리 이야기도 다시 짜야 하므로 구독자에게 알린다.
const resetListeners = new Set();

const resetLogs = () => {
    clearLogs();
    resetListeners.forEach((listener) => listener());
};

const subscribeReset = (listener) => {
    resetListeners.add(listener);

    return () => resetListeners.delete(listener);
};

// 이야기처럼 로그 원본 묶음이 필요한 곳이 구독한다.
const subscribeEntries = (listener) => {
    entryListeners.add(listener);

    return () => entryListeners.delete(listener);
};

const getRunState = () => useRunStore.getState().state;

export { MAX_LOG_LINES, useRunStore, applyRunState, appendEntries, flushNow, clearLogs, resetLogs, subscribeEntries, subscribeReset, getRunState };
