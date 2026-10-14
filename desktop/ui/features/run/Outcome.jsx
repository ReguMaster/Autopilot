import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { parseGain, splitFigure } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useRunStore } from "../../stores/runStore.js";

const HERO_SIZES = ["display", "xl", "lg", "md", "sm"];

// 가장 최근 성과 줄을 크게 보여준다. "이전 → 이후" 형식이 아니면 문장만 보여준다.
// 값이 길면 글자 크기 단계를 내려 한 줄에 맞춘다. 가장 작은 단계에서도 넘치면 CSS가 말줄임한다(data-size는 React가 그리지 않는 속성이다).
const Outcome = () => {
    const gain = useRunStore((store) => store.state.gains.at(-1));
    const round = useRunStore((store) => store.state.round);
    const heroRef = useRef(null);
    const parsed = gain ? parseGain(gain.text) : { label: "", before: "", after: "" };
    const before = splitFigure(parsed.before);
    const after = splitFigure(parsed.after);

    const fit = useCallback(() => {
        const hero = heroRef.current;

        if (!hero || hero.hidden) {
            return;
        }

        for (const size of HERO_SIZES) {
            hero.dataset.size = size;

            if (Array.from(hero.querySelectorAll(".was, .is")).every((value) => value.scrollWidth <= value.clientWidth)) {
                return;
            }
        }
    }, []);

    useLayoutEffect(fit);

    useEffect(() => {
        const observer = new ResizeObserver(fit);

        observer.observe(heroRef.current);

        return () => observer.disconnect();
    }, [fit]);

    return (
        <section id="outcome" className="outcome" aria-label="최근 성과" hidden={!gain} data-earlier={gain ? String(gain.round < round) : undefined}>
            <p className="outcome-say">
                <span id="outcome-round" className="num">
                    {gain ? `${gain.round}회차` : ""}
                </span>
                <SwapText id="outcome-label" value={parsed.label} />
            </p>
            <p id="outcome-hero" ref={heroRef} className="hero" hidden={!parsed.after}>
                <span className="was">
                    <span id="outcome-before">{before.number}</span>
                    <small id="outcome-before-unit">{before.unit}</small>
                </span>
                <svg className="arrow" viewBox="0 0 42 14" aria-hidden="true">
                    <path d="M1 7h39M34 1.5 40 7l-6 5.5" />
                </svg>
                <span className="is">
                    <SwapText id="outcome-after" value={after.number} />
                    <small id="outcome-after-unit">{after.unit}</small>
                </span>
            </p>
        </section>
    );
};

export { Outcome };
