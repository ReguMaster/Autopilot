import { useEffect, useRef, useState } from "react";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { POLICIES, POLICY_LABELS } from "../../lib/constants.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";

const POLICY_DESCRIPTIONS = {
    auto: "작업을 마친 뒤에도 종료 시각까지 스스로 개선점을 찾아요",
    todo: "적어 둔 작업만 처리하고 끝나요. 작업 입력이 꼭 필요해요"
};

// 개선 정책은 컴포저가 값을 갖고, 알약·팝오버는 그 값을 보여주고 바꾼다. 실행 중에는 바꿀 수 없다.
const PolicyChip = () => {
    const policy = useComposerStore((store) => store.policy);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const label = POLICY_LABELS[policy];
    const chipRef = useWidthTween(policy);
    const nameRef = useReplayOnChange(policy, "tick-up");

    useEffect(() => {
        if (!isIdle) {
            popoverRef.current?.hidePopover();
        }
    }, [isIdle]);

    return (
        <>
            <Chip id="policy-chip" chipRef={chipRef} popoverTarget="policy-popover" aria-label="개선 정책 고르기" aria-expanded={isOpen} disabled={!isIdle}>
                <svg className="chip-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <use href={`#icon-policy-${policy}`} />
                </svg>
                <span id="policy-chip-name" ref={nameRef}>
                    {label}
                </span>
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="policy-popover" className="popover choice-popover" role="group" aria-label="개선 정책" data-policy={policy} popoverRef={popoverRef} onToggle={setIsOpen}>
                {POLICIES.map((option) => (
                    <button
                        key={option}
                        type="button"
                        className="choice-option"
                        data-policy={option}
                        aria-pressed={option === policy}
                        onClick={() => {
                            composer.setPolicy(option);
                            closePopoverSoon(popoverRef);
                        }}
                    >
                        <svg className="chip-icon" viewBox="0 0 20 20" aria-hidden="true">
                            <use href={`#icon-policy-${option}`} />
                        </svg>
                        <span className="choice-title">{POLICY_LABELS[option]}</span>
                        <small className="choice-desc">{POLICY_DESCRIPTIONS[option]}</small>
                    </button>
                ))}
            </Popover>
        </>
    );
};

export { PolicyChip };
