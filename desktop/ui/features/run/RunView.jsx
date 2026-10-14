import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "../../components/Icon.jsx";
import { SwapText } from "../../components/SwapText.jsx";
import { replayAnimation } from "../../hooks/useReplay.js";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { ApplyNote } from "./ApplyNote.jsx";
import { Outcome } from "./Outcome.jsx";
import { startReveal } from "./reveal.js";
import { createStoryModel } from "./storyModel.js";
import { Work } from "./Work.jsx";

const PAST_SLIDE_MS = 520;
const PAST_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const NOW_MID_LENGTH = 45;
const NOW_LONG_LENGTH = 80;

const storyModel = createStoryModel();

const getNowLength = (text) => {
    if (text.length > NOW_LONG_LENGTH) {
        return "long";
    }

    return text.length > NOW_MID_LENGTH ? "mid" : "";
};

const measureTops = (container) => {
    return new Map([...container.children].map((node) => [node, node.getBoundingClientRect().top]));
};

// 문장이 늘거나 지금 문장의 높이가 바뀌어 줄 위치가 달라지면 이전 위치에서 부드럽게 올라가게 한다(FLIP). 이전 위치는 렌더 직전에 잰 값이다.
const slidePast = (tops) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    tops.forEach((top, node) => {
        const distance = top - node.getBoundingClientRect().top;

        if (node.isConnected && Math.abs(distance) > 1) {
            node.animate({ translate: [`0 ${distance}px`, "0 0"] }, { duration: PAST_SLIDE_MS, easing: PAST_SLIDE_EASING });
        }
    });
};

const PastItem = ({ item }) => {
    const [isNew, setIsNew] = useState(true);

    return (
        <p data-key={item.key} className={isNew ? "appear" : undefined} onAnimationEnd={() => setIsNew(false)}>
            {item.tools.length ? (
                <span className="tools">
                    {item.tools.map((tool, index) => (
                        <span key={index} className="tool">
                            <b>{tool.name}</b>
                            {tool.detail}
                        </span>
                    ))}
                </span>
            ) : null}
            <span className="said">{item.text}</span>
        </p>
    );
};

// 실행 중 화면: 지난 문장은 위로 올라가며 흐려지고 지금 문장이 크게 쓰인다.
// 새 문장·이동·드러내기 애니메이션이 끝나기 전에 상태가 오면 가장 최근 모양만 모아 두었다가 끝난 뒤 한 번 그린다(애니메이션이 끊기지 않게).
const RunView = () => {
    const [view, setView] = useState(() => storyModel.getView());
    const sectionRef = useRef(null);
    const pastRef = useRef(null);
    const lineRef = useRef(null);
    const initialVersion = useRef(storyModel.getVersion());
    const gate = useRef({ isBusy: false, isDirty: false, tops: new Map(), reveal: null, previous: { key: null, text: "" }, run: () => {} });
    const isHistoryOpen = useUiStore((store) => store.history);

    gate.current.run = () => {
        const current = gate.current;

        if (current.isBusy) {
            current.isDirty = true;

            return;
        }

        current.isBusy = true;
        current.tops = measureTops(pastRef.current);
        flushSync(() => setView(storyModel.getView()));
    };

    useEffect(() => {
        const unsubscribe = storyModel.subscribe(() => gate.current.run());

        if (storyModel.getVersion() !== initialVersion.current) {
            gate.current.run();
        }

        return unsubscribe;
    }, []);

    useLayoutEffect(() => {
        return () => {
            gate.current.reveal?.stop();
            gate.current.previous = { key: null, text: "" };
        };
    }, []);

    useLayoutEffect(() => {
        const current = gate.current;
        const line = lineRef.current;

        if (view.key !== current.previous.key) {
            current.reveal?.stop();
            current.reveal = startReveal(line);
        } else if (view.text !== current.previous.text) {
            current.reveal?.stop();
            replayAnimation(line, "swap");
        }

        current.previous = { key: view.key, text: view.text };
        slidePast(current.tops);
        current.isBusy = true;

        const animations = sectionRef.current.getAnimations({ subtree: true }).filter((animation) => animation.effect.getComputedTiming().endTime !== Infinity);

        Promise.allSettled([current.reveal?.done, ...animations.map((animation) => animation.finished)]).then(() => {
            current.isBusy = false;

            if (current.isDirty) {
                current.isDirty = false;
                current.run();
            }
        });
    }, [view]);

    return (
        <section ref={sectionRef} className="story view-run" aria-label="지금 하는 일">
            <div id="story-past" ref={pastRef} className="past">
                {view.pastItems.map((item) => (
                    <PastItem key={item.key} item={item} />
                ))}
            </div>

            <Outcome />

            <p ref={lineRef} className="now" data-length={getNowLength(view.text)} aria-live="polite">
                <span id="now-text" className="now-text">
                    {view.text}
                </span>
                <i className="caret" aria-hidden="true"></i>
            </p>
            <div className="now-meta">
                <SwapText id="now-time" className="num" value={view.time} />
                <ApplyNote />
                <button type="button" id="live-panel" className="link" aria-controls="history" aria-expanded={isHistoryOpen} onClick={() => ui.setHistory(!isHistoryOpen)}>
                    <Icon symbol="icon-lines" />
                    전체 기록
                </button>
            </div>

            <Work />
        </section>
    );
};

export { RunView };
