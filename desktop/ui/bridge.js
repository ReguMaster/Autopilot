import { useSyncExternalStore } from "react";

const STATUS_OK = "OK";

// preload의 window.autopilot을 React 훅으로 잇는다. 앱에서 구독은 하나만 둔다.
let snapshot = { status: "idle", settings: null };
let isStarted = false;
const listeners = new Set();

const update = (next) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
};

const start = () => {
    if (isStarted) {
        return;
    }

    isStarted = true;

    window.autopilot.getState().then(({ state, settings }) => update({ status: state.status, settings: settings }));
    window.autopilot.onState((state) => {
        if (state.status !== snapshot.status) {
            update({ status: state.status });
        }
    });
};

const subscribe = (listener) => {
    start();
    listeners.add(listener);

    return () => listeners.delete(listener);
};

const useRunStatus = () => {
    return useSyncExternalStore(subscribe, () => snapshot.status);
};

const useSettings = () => {
    return useSyncExternalStore(subscribe, () => snapshot.settings);
};

// 아직 React로 옮기지 않은 패널의 열림 상태를 body 클래스로 읽는다. 패널이 React로 오면 없어진다.
const subscribeBodyClass = (notify) => {
    const observer = new MutationObserver(notify);

    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
};

const useBodyClass = (className) => {
    return useSyncExternalStore(subscribeBodyClass, () => document.body.classList.contains(className));
};

export { STATUS_OK, useRunStatus, useSettings, useBodyClass };
