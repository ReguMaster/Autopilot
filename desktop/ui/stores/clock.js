import { useRef, useSyncExternalStore } from "react";

const CLOCK_INTERVAL_MS = 1000;

// 앱 전체가 초 단위 시계 하나를 나눠 쓴다. 구독자가 없으면 멈춘다.
let now = Date.now();
let timer = 0;
const listeners = new Set();

const tick = () => {
    now = Date.now();
    listeners.forEach((listener) => listener());
};

// 시계가 돌고 있으면 틱의 시각을, 아니면(첫 그림) 지금 시각을 쓴다.
const getNow = () => {
    if (!timer) {
        now = Date.now();
    }

    return now;
};

const subscribe = (listener) => {
    listeners.add(listener);

    if (!timer) {
        timer = setInterval(tick, CLOCK_INTERVAL_MS);
    }

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
            clearInterval(timer);
            timer = 0;
        }
    };
};

// 시계에서 읽은 값이 바뀔 때만 다시 그린다. select는 시각(ms)을 받아 문자열·숫자처럼 값으로 비교되는 것(또는 isEqual로 비교할 객체)을 돌려준다.
const useClock = (select, isEqual = Object.is) => {
    const last = useRef(null);

    const getSnapshot = () => {
        const value = select(getNow());

        if (last.current && isEqual(last.current.value, value)) {
            return last.current.value;
        }

        last.current = { value: value };

        return value;
    };

    return useSyncExternalStore(subscribe, getSnapshot);
};

export { useClock };
