import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { startReveal } from "./reveal.js";

const PAST_SLIDE_MS = 520;
const PAST_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const NOW_MID_LENGTH = 45;
const NOW_LONG_LENGTH = 80;

// 클래스를 뗐다 붙여 CSS 애니메이션을 처음부터 다시 건다. 이 요소는 React가 그리지 않으므로 class를 직접 만져도 된다.
const replayAnimation = (element, className) => {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
};

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

// 이야기는 index.html의 #story-past·#now-text·#now-time 안에만 포털로 그린다. 같은 구역의 다른 노드(적용 대기·성과·작업 수)는 아직 renderer.js가 쓴다.
// 새 문장·이동·드러내기 애니메이션이 끝나기 전에 로그가 오면 가장 최근 모양만 모아 두었다가 끝난 뒤 한 번 그린다(애니메이션이 끊기지 않게).
const Story = ({ store, elements }) => {
    const [view, setView] = useState(() => store.getView());
    const initialVersion = useRef(store.getVersion());
    const gate = useRef({ isBusy: false, isDirty: false, tops: new Map(), reveal: null, previous: { key: null, text: "", time: "" }, run: () => {} });

    gate.current.run = () => {
        const current = gate.current;

        if (current.isBusy) {
            current.isDirty = true;

            return;
        }

        current.isBusy = true;
        current.tops = measureTops(elements.past);
        flushSync(() => setView(store.getView()));
    };

    useEffect(() => {
        const unsubscribe = store.subscribe(() => gate.current.run());

        if (store.getVersion() !== initialVersion.current) {
            gate.current.run();
        }

        return unsubscribe;
    }, [store]);

    useLayoutEffect(() => {
        return () => {
            gate.current.reveal?.stop();
            gate.current.previous = { key: null, text: "", time: "" };
        };
    }, []);

    useLayoutEffect(() => {
        const current = gate.current;
        const line = elements.line;

        line.dataset.length = getNowLength(view.text);

        if (view.key !== current.previous.key) {
            current.reveal?.stop();
            current.reveal = startReveal(line);
        } else if (view.text !== current.previous.text) {
            current.reveal?.stop();
            replayAnimation(line, "swap");
        }

        if (view.time !== current.previous.time) {
            replayAnimation(elements.time, "swap");
        }

        current.previous = { key: view.key, text: view.text, time: view.time };
        slidePast(current.tops);
        current.isBusy = true;

        const animations = line
            .closest("section")
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect.getComputedTiming().endTime !== Infinity);

        Promise.allSettled([current.reveal?.done, ...animations.map((animation) => animation.finished)]).then(() => {
            current.isBusy = false;

            if (current.isDirty) {
                current.isDirty = false;
                current.run();
            }
        });
    }, [view]);

    return (
        <>
            {createPortal(
                view.pastItems.map((item) => <PastItem key={item.key} item={item} />),
                elements.past
            )}
            {createPortal(view.text, elements.text)}
            {createPortal(view.time, elements.time)}
        </>
    );
};

export { Story };
