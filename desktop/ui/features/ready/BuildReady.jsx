import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatEndTimeShort } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { Select } from "../../components/Select.jsx";
import { PHASE_LABELS } from "../../lib/constants.js";
import {
    BRAINSTORM_OPTIONS,
    CODEX_EFFORT_OPTIONS,
    getBrainstormMode,
    getCodexModelOptions,
    getDebateTurnOptions,
    DESIGN_FORMAT_OPTIONS,
    ON_FAIL_CAPTIONS,
    ON_FAIL_OPTIONS,
    getBuildGreeting,
    getReadySteps
} from "../../lib/buildSteps.js";
import { useClock } from "../../stores/clock.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { StepCard } from "../steps/StepCard.jsx";

// 두 AI가 안을 낸 단계는 고르려고 늘 멈추므로 확인받기를 켠 채로 잠근다.
const GateCheck = ({ phase }) => {
    const { isOn, isBrainstorm } = useComposerStore(useShallow((store) => ({ isOn: store.gates.includes(phase), isBrainstorm: store.brainstorm.includes(phase) })));

    return (
        <label className="step-check" title={isBrainstorm ? "두 안을 고르려고 늘 멈춰요" : undefined}>
            <input type="checkbox" data-gate={phase} checked={isOn || isBrainstorm} disabled={isBrainstorm} onChange={() => composer.toggleGate(phase)} />
            끝나면 멈추고 확인받기
        </label>
    );
};

// 외부 도구가 필요한 산출물인데 보내기를 허용하지 않았으면 엔진이 HTML로 만든다는 것을 미리 알린다.
const DesignFormat = () => {
    const { designFormat, canSend } = useComposerStore(useShallow((store) => ({ designFormat: store.designFormat, canSend: store.allow.includes("send") })));

    return (
        <>
            <Select value={designFormat} options={DESIGN_FORMAT_OPTIONS} onChange={composer.setDesignFormat} ariaLabel="디자인 산출물" />
            {["figma", "image"].includes(designFormat) && !canSend ? <p className="step-note">보내기를 허용하지 않으면 HTML로 만들어요</p> : null}
        </>
    );
};

// Codex를 쓰는 단계에서만 보인다. 모델·Effort는 모든 단계의 Codex가 함께 쓰므로 어느 칸에서 바꿔도 같은 값이다.
const CodexSettings = ({ models }) => {
    const { codexModel, codexEffort } = useComposerStore(useShallow((store) => ({ codexModel: store.codexModel, codexEffort: store.codexEffort })));
    const modelOptions = getCodexModelOptions(models, codexModel);

    return (
        <>
            <p className="step-none">Codex가 쓸 모델과 Effort</p>
            <Select value={codexModel} options={modelOptions} onChange={composer.setCodexModel} ariaLabel="Codex 모델" />
            <Select value={codexEffort} options={CODEX_EFFORT_OPTIONS} onChange={composer.setCodexEffort} ariaLabel="Codex Effort" />
        </>
    );
};

// 협의에서 주고받는 최대 횟수. 모든 협의 단계가 함께 쓰므로 어느 칸에서 바꿔도 같은 값이다.
const DebateTurns = () => {
    const debateTurns = useComposerStore((store) => store.debateTurns);

    return <Select value={debateTurns} options={getDebateTurnOptions(debateTurns)} onChange={composer.setDebateTurns} ariaLabel="협의 최대 횟수" />;
};

// 이 단계를 Claude만 쓸지, Codex와 나란히 비교할지, 협의할지. Codex를 쓰면 외부 서비스로 보내기도 켜진다. Codex를 쓸 수 없으면 이유를 보이고 잠근다.
const Brainstorm = ({ phase }) => {
    const { brainstormMode, crossReview } = useComposerStore(useShallow((store) => ({ brainstormMode: getBrainstormMode(store, phase), crossReview: store.crossReview })));
    const codex = useRunsStore((store) => store.providers?.codex);
    const isOn = brainstormMode !== "claude";
    const reason = codex && !codex.available && !isOn ? codex.reason : "";

    return (
        <>
            <Select
                value={brainstormMode}
                options={BRAINSTORM_OPTIONS}
                onChange={(value) => composer.setBrainstormMode(phase, value)}
                disabled={Boolean(reason)}
                disabledReason={reason}
                ariaLabel={`${PHASE_LABELS[phase]}을 누가 쓸까요`}
            />
            {reason ? <p className="step-note">{reason}</p> : null}
            {isOn ? <CodexSettings models={codex?.models ?? []} /> : null}
            {brainstormMode === "debate" ? <DebateTurns /> : null}
            {brainstormMode === "compare" ? (
                <label className="step-check">
                    <input type="checkbox" data-cross-review={phase} checked={crossReview} onChange={(event) => composer.setCrossReview(event.target.checked)} />
                    교차검토
                </label>
            ) : null}
            {isOn ? (
                <p className="step-note">
                    보내기를 켰어요.
                    <br />
                    {brainstormMode === "debate" ? "끝나면 쟁점만 골라요." : "끝나면 두 안을 골라요."}
                </p>
            ) : null}
        </>
    );
};

const ON_FAIL_SETTINGS = {
    qa: { key: "qaOnFail", set: composer.setQaOnFail, label: "테스트/QA 실패 처리" },
    security: { key: "securityOnFail", set: composer.setSecurityOnFail, label: "보안검토 실패 처리" }
};

// 테스트/QA·보안검토가 실패하면 개발로 몇 번까지 되돌릴지. 칸이 좁아 뜻은 설명 줄이 맡고 선택 상자는 횟수만 보인다.
const OnFail = ({ phase }) => {
    const setting = ON_FAIL_SETTINGS[phase];
    const value = useComposerStore((store) => store[setting.key]);

    return (
        <>
            <p className="step-none">{ON_FAIL_CAPTIONS[phase]}</p>
            <Select value={value} options={ON_FAIL_OPTIONS} onChange={setting.set} ariaLabel={setting.label} />
        </>
    );
};

const SETTINGS = {
    plan: (
        <>
            <GateCheck phase="plan" />
            <Brainstorm phase="plan" />
        </>
    ),
    design: (
        <>
            <GateCheck phase="design" />
            <DesignFormat />
            <Brainstorm phase="design" />
        </>
    ),
    qa: <OnFail phase="qa" />,
    security: <OnFail phase="security" />
};

// 신규 개발의 시작 전: 단계 막대(아래에 단계별 설정 묶음, 개발은 정할 것이 없어 묶음이 없다)와 이어서 할 단계를 알리는 안내. 마친 단계의 설정은 펼치지 않는다.
const BuildReady = () => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { endTime, gates } = useComposerStore(useShallow((store) => ({ endTime: store.endTime, gates: store.gates })));
    const endLabel = useClock((now) => formatEndTimeShort(endTime, now));
    const greeting = getBuildGreeting({ buildPhase: buildPhase, endLabel: endLabel, gates: gates });
    const cells = getReadySteps(buildPhase);
    const settings = Object.fromEntries(cells.filter((cell) => cell.state !== "done").map((cell) => [cell.phase, SETTINGS[cell.phase]]));

    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            <StepCard id="build-steps" cells={cells} settings={settings} />
            <div className="build-lead">
                <h1 id="greet-title">{greeting.title}</h1>
                <p id="greet-lead" className="lead">
                    {greeting.lead}
                </p>
            </div>
        </>
    );
};

export { BuildReady };
