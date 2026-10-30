import { useEffect, useRef, useState } from "react";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover } from "../../components/Popover.jsx";
import { ALLOW_OPTIONS } from "../../lib/buildSteps.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";

// 신규 개발에서 이번 실행에 풀어 줄 정책. 고른 것만 엔진이 정책 끝에 허용으로 덧붙이고, 실행 중에는 바꿀 수 없다.
const AllowChip = () => {
    const allow = useComposerStore((store) => store.allow);
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);

    useEffect(() => {
        if (!isIdle) {
            popoverRef.current?.hidePopover();
        }
    }, [isIdle]);

    return (
        <>
            <Chip id="allow-chip" popoverTarget="allow-popover" aria-label="이번 실행에서 허용할 것 고르기" aria-expanded={isOpen} disabled={!isIdle}>
                <svg className="chip-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 2.8 4.2 5v4.6c0 3.6 2.4 6.3 5.8 7.6 3.4-1.3 5.8-4 5.8-7.6V5z" />
                    <path d="m7.4 10 1.8 1.8 3.5-3.6" />
                </svg>
                허용
                <small id="allow-count" className="num">{`${allow.length}개`}</small>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="allow-popover" className="popover allow-popover" role="group" aria-label="이번 실행에서 허용할 것" popoverRef={popoverRef} onToggle={setIsOpen}>
                <p className="allow-title">이번 실행에서 허용할 것</p>
                {ALLOW_OPTIONS.map((option) => (
                    <label key={option.key} className="allow-option">
                        <input type="checkbox" data-allow={option.key} checked={allow.includes(option.key)} onChange={() => composer.toggleAllow(option.key)} />
                        <b>{option.label}</b>
                        <small>{option.desc}</small>
                    </label>
                ))}
                <p className="allow-foot">
                    <Icon symbol="icon-lock" />
                    비밀값, 운영 환경, Git 보호, 파일 삭제 규칙은 풀 수 없어요
                </p>
            </Popover>
        </>
    );
};

export { AllowChip };
