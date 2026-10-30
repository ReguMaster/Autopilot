import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover } from "../../components/Popover.jsx";
import { ALLOW_FIXED_RULES, ALLOW_OPTIONS, ALLOW_RISKS, getAllowRisk, getAllowUsage } from "../../lib/buildSteps.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";

const RISK_LEVELS = Object.keys(ALLOW_RISKS);

// 위험도: 세 칸 중 몇 칸이 찼는지와 이름. 색은 낮음 초록·보통 주황·높음 빨강이다.
const RiskMeter = ({ risk }) => {
    const filled = RISK_LEVELS.indexOf(risk) + 1;

    return (
        <span className="risk-meter" data-risk={risk}>
            <span className="risk-bars" aria-hidden="true">
                {RISK_LEVELS.map((level, index) => (
                    <i key={level} data-on={index < filled ? "" : undefined}></i>
                ))}
            </span>
            위험 {ALLOW_RISKS[risk]}
        </span>
    );
};

const AllowOption = ({ option, isChecked, onActivate }) => {
    return (
        <label className="allow-option" data-risk={option.risk} onPointerEnter={onActivate} onFocus={onActivate}>
            <input type="checkbox" data-allow={option.key} checked={isChecked} onChange={() => composer.toggleAllow(option.key)} />
            <span className="allow-box" aria-hidden="true">
                <Icon symbol="icon-check" />
            </span>
            <span className="allow-body">
                <span className="allow-line">
                    <b>{option.label}</b>
                    <RiskMeter risk={option.risk} />
                </span>
                <small className="allow-desc">{option.desc}</small>
            </span>
        </label>
    );
};

// 가리키고 있는(또는 고르고 있는) 항목의 위험한 이유와 허용해도 지키는 선. 목록 아래 자리가 늘 같아서 가리키는 항목이 바뀌어도 팝오버 높이가 흔들리지 않는다.
const AllowDetail = ({ option, usage }) => {
    return (
        <div className="allow-detail" data-risk={option.risk} aria-live="polite">
            <p>
                <b className="allow-tag" data-kind="risk">
                    위험 {ALLOW_RISKS[option.risk]}
                </b>
                {option.riskNote}.
            </p>
            <p>
                <b className="allow-tag" data-kind="keep">
                    지켜요
                </b>
                {option.keeps}.
            </p>
            {usage.map((line) => (
                <p key={line}>
                    <b className="allow-tag" data-kind="use">
                        지금 설정
                    </b>
                    {line}
                </p>
            ))}
        </div>
    );
};

// 신규 개발에서 이번 실행에 풀어 줄 정책. 고른 것만 엔진이 정책 끝에 허용으로 덧붙이고, 실행 중에는 바꿀 수 없다.
// 항목마다 무엇을 하는지와 위험도를 보여 주고, 가리킨 항목의 위험한 이유·지키는 선은 아래 설명 칸에 보인다. 고른 것의 가장 높은 위험도는 알약 점과 머리 줄에 알린다.
const AllowChip = () => {
    const { allow, brainstorm, designFormat } = useComposerStore(useShallow((store) => ({ allow: store.allow, brainstorm: store.brainstorm, designFormat: store.designFormat })));
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const [isOpen, setIsOpen] = useState(false);
    const [activeKey, setActiveKey] = useState("");
    const popoverRef = useRef(null);
    const risk = getAllowRisk(allow);
    // 가리킨 항목이 없으면 고른 것 중 가장 위험한 항목(목록이 위험도 순이라 마지막), 그것도 없으면 첫 항목이다.
    const active = ALLOW_OPTIONS.find((option) => option.key === activeKey) ?? ALLOW_OPTIONS.findLast((option) => allow.includes(option.key)) ?? ALLOW_OPTIONS[0];

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
            <Popover
                id="allow-popover"
                className="popover allow-popover"
                role="group"
                aria-label="이번 실행에서 허용할 것"
                popoverRef={popoverRef}
                onToggle={(open) => {
                    setIsOpen(open);
                    setActiveKey("");
                }}
            >
                <div className="allow-head">
                    <p className="allow-title">이번 실행에서 허용할 것</p>
                    <p className="allow-summary" data-risk={risk || undefined}>
                        {risk ? `${allow.length}개 허용 · 가장 높은 위험도 ${ALLOW_RISKS[risk]}` : "아무것도 풀지 않고 기본 정책대로 해요"}
                    </p>
                </div>
                <div className="allow-list">
                    {ALLOW_OPTIONS.map((option) => (
                        <AllowOption key={option.key} option={option} isChecked={allow.includes(option.key)} onActivate={() => setActiveKey(option.key)} />
                    ))}
                </div>
                <AllowDetail option={active} usage={allow.includes(active.key) ? getAllowUsage(active.key, { brainstorm: brainstorm, designFormat: designFormat }) : []} />
                <div className="allow-foot">
                    <p>
                        <Icon symbol="icon-lock" />
                        어떤 허용을 켜도 아래 규칙은 풀 수 없어요
                    </p>
                    <ul>
                        {ALLOW_FIXED_RULES.map((rule) => (
                            <li key={rule}>{rule}</li>
                        ))}
                    </ul>
                </div>
            </Popover>
        </>
    );
};

export { AllowChip };
