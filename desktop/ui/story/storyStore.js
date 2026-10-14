import { applyStoryEntry, createStory, getWaitSentence } from "../../viewFormat.js";

const LOG_FLUSH_MS = 50;
const STORY_PAST_LINES = 9;
const EMPTY_SENTENCE = "곧 첫 문장을 들려드릴게요.";

const getPastKey = (item) => {
    return `${item.id}:${item.tools.length}:${item.text}`;
};

// 이야기 엔진(viewFormat)은 item을 제자리에서 고치므로, 화면에는 그 순간의 복사본만 건넨다.
const getViewModel = (story, state) => {
    const waitSentence = state ? getWaitSentence(state) : "";
    const lastItem = story.items.at(-1);
    const nowItem = waitSentence ? null : lastItem;
    const pastItems = (nowItem ? story.items.slice(0, -1) : story.items).slice(-STORY_PAST_LINES);

    return {
        pastItems: pastItems.map((item) => ({ key: getPastKey(item), text: item.text, tools: item.tools.map((tool) => ({ name: tool.name, detail: tool.detail })) })),
        text: waitSentence || nowItem?.text || EMPTY_SENTENCE,
        key: waitSentence ? `wait:${waitSentence}` : `item:${nowItem?.id || 0}`,
        time: nowItem?.time || ""
    };
};

// 로그는 모아서 한 번에 이야기에 반영하고, 상태가 오면 바로 알린다. 화면은 알림을 받아 getView로 그 순간의 모양을 읽는다.
const createStoryStore = () => {
    const story = createStory();
    const listeners = new Set();
    let state = null;
    let pending = [];
    let flushTimer = 0;
    let readyPromise = null;
    let version = 0;

    const notify = () => {
        version++;
        listeners.forEach((listener) => listener());
    };

    const flush = () => {
        flushTimer = 0;

        const entries = pending;

        pending = [];
        entries.forEach((entry) => applyStoryEntry(story, entry));
        notify();
    };

    // 처음 상태를 받은 뒤에 첫 그림을 그리도록 마운트 전에 기다린다(안 그러면 빈 문장이 잠깐 보인다).
    const start = () => {
        if (readyPromise) {
            return readyPromise;
        }

        window.autopilot.onLog((entries) => {
            pending.push(...entries);

            if (!flushTimer) {
                flushTimer = setTimeout(flush, LOG_FLUSH_MS);
            }
        });
        window.autopilot.onState((next) => {
            state = next;
            notify();
        });

        readyPromise = window.autopilot.getState().then((snapshot) => {
            state = snapshot.state;
            snapshot.logs.forEach((entry) => applyStoryEntry(story, entry));
            notify();
        });

        return readyPromise;
    };

    return {
        ready: start,
        subscribe: (listener) => {
            start();
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        getView: () => getViewModel(story, state),
        getVersion: () => version
    };
};

export { createStoryStore, getViewModel };
