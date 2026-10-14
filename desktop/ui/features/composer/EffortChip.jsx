import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatEffort } from "../../../viewFormat.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { replayAnimation, useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { EFFORT_LEVELS, OPTIONS_LOCKED_TITLE } from "../../lib/constants.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";

const EFFORT_DESCRIPTIONS = ["가장 빠르게", "가볍게", "기본값", "더 깊게", "가장 깊게"];

// 단계가 높을수록 두 마루의 진폭이 커지는 물결. 알약과 목록이 같은 모양을 쓴다.
const getWavePath = (level) => `M-7 8q2-${(1 + level * 1.7).toFixed(1)} 4 0${"t4 0".repeat(8)}`;

const Wave = ({ level }) => {
    return (
        <svg className="wave" viewBox="0 0 18 16" aria-hidden="true">
            <path style={{ d: `path("${getWavePath(level)}")` }} />
        </svg>
    );
};

// 이름은 단계가 오른 쪽(아래에서)·내린 쪽(위에서)으로 들어온다.
const EffortChip = () => {
    const level = useComposerStore((store) => store.effort);
    const isStopping = useRunStore((store) => store.state.status === "stopping");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const previousLevel = useRef(level);
    const label = formatEffort(EFFORT_LEVELS[level]);
    const nameRef = useRef(null);
    const chipRef = useMergedRef(useWidthTween(label), useReplayOnChange(label, "effort-swap"));

    useLayoutEffect(() => {
        if (previousLevel.current !== level) {
            replayAnimation(nameRef.current, level > previousLevel.current ? "tick-up" : "tick-down");
            previousLevel.current = level;
        }
    }, [level]);

    useEffect(() => {
        if (isStopping) {
            popoverRef.current?.hidePopover();
        }
    }, [isStopping]);

    return (
        <>
            <Chip
                id="effort-control"
                chipRef={chipRef}
                className="effort"
                data-level={level}
                style={{ "--level": level }}
                popoverTarget="effort-popover"
                aria-label="Effort 고르기"
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : undefined}
            >
                <Wave level={level} />
                <b id="effort-name" ref={nameRef} className="effort-name">
                    {label}
                </b>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="effort-popover" className="popover choice-popover" role="group" aria-label="Effort" data-level={level} popoverRef={popoverRef} onToggle={setIsOpen}>
                {EFFORT_LEVELS.map((name, index) => (
                    <button
                        key={name}
                        type="button"
                        className="choice-option effort"
                        data-level={index}
                        aria-pressed={index === level}
                        onClick={() => {
                            if (!isStopping) {
                                composer.chooseEffort(index);
                                closePopoverSoon(popoverRef);
                            }
                        }}
                    >
                        <Wave level={index} />
                        <span className="choice-title">{formatEffort(name)}</span>
                        <small className="choice-desc">{EFFORT_DESCRIPTIONS[index]}</small>
                    </button>
                ))}
            </Popover>
        </>
    );
};

export { EffortChip };
