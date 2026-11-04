import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover } from "../../components/Popover.jsx";
import { ALLOW_FIXED_NOTE, ALLOW_OPTIONS, ALLOW_RISKS, getAllowRisk, getAllowUsage } from "../../lib/buildSteps.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import "./AllowChip.css";

const RiskTag = ({ risk }) => {
    return (
        <small className="allow-risk-tag" data-risk={risk}>
            <i aria-hidden="true"></i>위험 {ALLOW_RISKS[risk]}
        </small>
    );
};

// 항목은 이름·위험도·한 줄 설명과 스위치뿐이다. 위험한 이유와 지키는 선은 설정 페이지의 허용 묶음에서 읽는다. 켠 항목에 지금 설정이 기대는 곳이 있을 때만 그 사실을 한 줄 더한다.
const AllowRow = ({ option, isChecked, usage }) => {
    return (
        <label className="allow-row" data-risk={option.risk}>
            <span className="allow-main">
                <span className="allow-name">
                    <b>{option.label}</b>
                    <RiskTag risk={option.risk} />
                </span>
                <small className="allow-desc">{option.desc}</small>
                {usage.map((line) => (
                    <small key={line} className="allow-usage">
                        {line}
                    </small>
                ))}
            </span>
            <input type="checkbox" className="switch" data-allow={option.key} checked={isChecked} onChange={() => composer.toggleAllow(option.key)} />
        </label>
    );
};

// 신규 개발에서 이번 실행에 풀어 줄 정책. 고른 것만 엔진이 정책 끝에 허용으로 덧붙이고, 실행 중에는 바꿀 수 없다.
// 고른 것 중 가장 높은 위험도는 알약 점과 팝오버 머리에 알린다.
const AllowChip = () => {
    const { allow, brainstorm, designFormat } = useComposerStore(useShallow((store) => ({ allow: store.allow, brainstorm: store.brainstorm, designFormat: store.designFormat })));
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const risk = getAllowRisk(allow);

    useEffect(() => {
        if (!isIdle) {
            popoverRef.current?.hidePopover();
        }
    }, [isIdle]);

    return (
        <>
            <Chip id="allow-chip" popoverTarget="allow-popover" aria-label="이번 실행에서 허용할 것 고르기" aria-expanded={isOpen} disabled={!isIdle} data-risk={risk || undefined}>
                <svg className="chip-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 2.8 4.2 5v4.6c0 3.6 2.4 6.3 5.8 7.6 3.4-1.3 5.8-4 5.8-7.6V5z" />
                    <path d="m7.4 10 1.8 1.8 3.5-3.6" />
                </svg>
                허용
                <small id="allow-count" className="num">{`${allow.length}개`}</small>
                <i className="allow-dot" aria-hidden="true"></i>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="allow-popover" className="popover allow-popover" role="group" aria-label="이번 실행에서 허용할 것" popoverRef={popoverRef} onToggle={setIsOpen}>
                <div className="allow-head">
                    <p className="allow-title">이번 실행에서 허용할 것</p>
                    <p className="allow-summary" data-risk={risk || undefined}>
                        {risk ? `${allow.length}개 · 가장 높은 위험 ${ALLOW_RISKS[risk]}` : "기본 정책대로"}
                    </p>
                </div>
                <div className="allow-list">
                    {ALLOW_OPTIONS.map((option) => (
                        <AllowRow
                            key={option.key}
                            option={option}
                            isChecked={allow.includes(option.key)}
                            usage={allow.includes(option.key) ? getAllowUsage(option.key, { brainstorm: brainstorm, designFormat: designFormat }) : []}
                        />
                    ))}
                </div>
                <p className="allow-foot">
                    <Icon symbol="icon-lock" />
                    {ALLOW_FIXED_NOTE}
                </p>
            </Popover>
        </>
    );
};

export { AllowChip };
