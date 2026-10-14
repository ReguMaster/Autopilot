import { applyStoryEntry, createStory, getWaitSentence } from "../../../viewFormat.js";
import { getRunState, subscribeEntries, useRunStore } from "../../stores/runStore.js";

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

// 실행 스토어가 모아 준 로그 묶음을 이야기 엔진에 반영한다. 로그 묶음과 상태 변화가 모두 알림이 되고, 화면은 알림을 받아 getView로 그 순간의 모양을 읽는다.
const createStoryModel = () => {
    const story = createStory();
    const listeners = new Set();
    let version = 0;

    const notify = () => {
        version++;
        listeners.forEach((listener) => listener());
    };

    subscribeEntries((entries) => {
        entries.forEach((entry) => applyStoryEntry(story, entry));
        notify();
    });
    useRunStore.subscribe((current, previous) => {
        if (current.state !== previous.state) {
            notify();
        }
    });

    return {
        subscribe: (listener) => {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        getView: () => getViewModel(story, getRunState()),
        getVersion: () => version
    };
};

export { createStoryModel, getViewModel, getPastKey };
