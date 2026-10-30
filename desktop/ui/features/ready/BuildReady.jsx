import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatEndTimeShort } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { Select } from "../../components/Select.jsx";
import { Stepper } from "../../components/Stepper.jsx";
import { BRAINSTORM_PHASES, PHASE_LABELS } from "../../lib/constants.js";
import {
    BRAINSTORM_AFTER,
    BRAINSTORM_OPTIONS,
    CODEX_EFFORT_OPTIONS,
    CROSS_REVIEW_OPTIONS,
    DESIGN_FORMAT_OPTIONS,
    GATE_OPTIONS,
    MAX_ON_FAIL_RETRIES,
    ON_FAIL_WHEN,
    getBrainstormMode,
    getBuildGreeting,
    getCodexModelOptions,
    getDebateTurnOptions,
    getMaxRetries,
    getReadySteps,
    toOnFailValue
} from "../../lib/buildSteps.js";
import { useClock } from "../../stores/clock.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { StepCard } from "../steps/StepCard.jsx";

// 단계 설정은 선택에 따라 문장이 바뀌는 글이다. 알약 모양의 선택 상자(inline)가 문장 속에서 이어 읽히고, 고르면 그 뒤의 말도 함께 바뀐다.

// 끝나면 어떻게 할지. 두 AI가 쓴 단계는 고르려고 늘 멈추므로 선택 대신 그 말을 그대로 쓴다.
const GateSentence = ({ phase }) => {
    const { isOn, brainstormMode } = useComposerStore(useShallow((store) => ({ isOn: store.gates.includes(phase), brainstormMode: getBrainstormMode(store, phase) })));

    if (brainstormMode !== "claude") {
        return <>끝나면 멈추고 {BRAINSTORM_AFTER[brainstormMode]}.</>;
    }

    return (
        <>
            끝나면 <Select inline value={isOn ? "stop" : "go"} options={GATE_OPTIONS} onChange={() => composer.toggleGate(phase)} ariaLabel={`${PHASE_LABELS[phase]}이 끝난 뒤`} />.
        </>
    );
};

// 이 단계를 누가 쓸지. Codex를 쓰면 외부 서비스로 보내기도 켜진다. Codex를 쓸 수 없으면 이유를 알리고 잠근다.
const WhoSelect = ({ phase }) => {
    const brainstormMode = useComposerStore((store) => getBrainstormMode(store, phase));
    const codex = useRunsStore((store) => store.providers?.codex);
    const reason = codex && !codex.available && brainstormMode === "claude" ? codex.reason : "";

    return (
        <Select
            inline
            value={brainstormMode}
            options={BRAINSTORM_OPTIONS}
            onChange={(value) => composer.setBrainstormMode(phase, value)}
            disabled={Boolean(reason)}
            disabledReason={reason}
            ariaLabel={`${PHASE_LABELS[phase]}을 누가 쓸까요`}
        />
    );
};

// 외부 도구가 필요한 산출물인데 보내기를 허용하지 않았으면 엔진이 HTML로 만든다는 것을 미리 알린다.
const DesignFormat = () => {
    const designFormat = useComposerStore((store) => store.designFormat);

    return <Select inline value={designFormat} options={DESIGN_FORMAT_OPTIONS} onChange={composer.setDesignFormat} ariaLabel="디자인 산출물" />;
};

// Codex를 쓸 수 없으면 단계 문장 아래에 그 이유를 보인다.
const BrainstormExtras = ({ phase }) => {
    const brainstormMode = useComposerStore((store) => getBrainstormMode(store, phase));
    const codex = useRunsStore((store) => store.providers?.codex);
    const reason = codex && !codex.available && brainstormMode === "claude" ? codex.reason : "";

    return reason ? <p className="step-note">{reason}</p> : null;
};

// 선택자가 매번 새 빈 배열을 돌려주면 스토어가 바뀐 줄 알고 계속 다시 그리므로 하나를 재사용한다.
const NO_MODELS = [];

// Codex 공통 줄. 모델·추론 강도·협의 횟수·교차검토는 Codex를 쓰는 모든 단계가 함께 쓰는 값이라 단계 줄이 아니라 한 곳에 둔다.
// phases는 설정을 보이고 있는 기획·디자인이고, 협의·교차검토는 그 방식으로 돌리는 단계가 있을 때만 보인다.
const CodexSettings = ({ phases }) => {
    const { modes, codexModel, codexEffort, debateTurns, crossReview } = useComposerStore(
        useShallow((store) => ({
            modes: phases.map((phase) => getBrainstormMode(store, phase)).join(","),
            codexModel: store.codexModel,
            codexEffort: store.codexEffort,
            debateTurns: store.debateTurns,
            crossReview: store.crossReview
        }))
    );
    const models = useRunsStore((store) => store.providers?.codex?.models ?? NO_MODELS);

    return (
        <>
            <div className="step-sentence">
                Codex에 맡길 모델 <Select inline value={codexModel} options={getCodexModelOptions(models, codexModel)} onChange={composer.setCodexModel} ariaLabel="Codex 모델" />, 추론 강도{" "}
                <Select inline value={codexEffort} options={CODEX_EFFORT_OPTIONS} onChange={composer.setCodexEffort} ariaLabel="Codex Effort" />.
            </div>
            {modes.includes("debate") ? (
                <div className="step-sentence">
                    협의는 <Select inline value={debateTurns} options={getDebateTurnOptions(debateTurns)} onChange={composer.setDebateTurns} ariaLabel="협의 최대 횟수" /> 주고받아요.
                </div>
            ) : null}
            {modes.includes("compare") ? (
                <div className="step-sentence">
                    두 안을 낸 뒤 <Select inline value={crossReview ? "on" : "off"} options={CROSS_REVIEW_OPTIONS} onChange={(value) => composer.setCrossReview(value === "on")} ariaLabel="교차검토" />
                    .
                </div>
            ) : null}
            <p className="step-hint">Codex를 쓰는 모든 단계가 같은 값을 써요.</p>
            <p className="step-note">Codex에 프로젝트 내용을 보내야 해서 외부 서비스로 보내기도 함께 켰어요.</p>
        </>
    );
};

const PlanSettings = () => {
    return (
        <>
            <div className="step-sentence">
                기획은 <WhoSelect phase="plan" /> 진행하고, <GateSentence phase="plan" />
            </div>
            <BrainstormExtras phase="plan" />
        </>
    );
};

const DesignSettings = () => {
    const isExternalFormat = useComposerStore((store) => ["figma", "image"].includes(store.designFormat) && !store.allow.includes("send"));

    return (
        <>
            <div className="step-sentence">
                디자인은 <DesignFormat /> 형식으로 만들고, <WhoSelect phase="design" /> 진행해요. <GateSentence phase="design" />
            </div>
            {isExternalFormat ? <p className="step-note">외부 서비스로 보내기를 허용하지 않아서 HTML로 만들어요.</p> : null}
            <BrainstormExtras phase="design" />
        </>
    );
};

const ON_FAIL_SETTINGS = {
    qa: { key: "qaOnFail", set: composer.setQaOnFail, label: "테스트/QA 실패 처리" },
    security: { key: "securityOnFail", set: composer.setSecurityOnFail, label: "보안검토 실패 처리" }
};

// 테스트/QA·보안검토가 실패하면 개발로 몇 번까지 되돌릴지. 횟수를 숫자 조절기로 정하고, 0이면 되돌리지 않고 멈춘다.
const OnFailSettings = ({ phase }) => {
    const setting = ON_FAIL_SETTINGS[phase];
    const retries = useComposerStore((store) => getMaxRetries(store[setting.key]));

    // 조절기가 문장 안에서 늘 같은 자리에 있어야 횟수를 바꿔도 다시 만들어지지 않아 포커스가 남는다.
    return (
        <div className="step-sentence">
            {ON_FAIL_WHEN[phase]} 개발로 <Stepper value={retries} max={MAX_ON_FAIL_RETRIES} onChange={(count) => setting.set(toOnFailValue(count))} ariaLabel={setting.label} />
            {retries ? "번까지 되돌려 다시 고쳐요." : "번 되돌려요. 되돌리지 않고 결과만 남기고 멈춰요."}
        </div>
    );
};

const SETTINGS = {
    plan: <PlanSettings />,
    design: <DesignSettings />,
    qa: <OnFailSettings phase="qa" />,
    security: <OnFailSettings phase="security" />
};

// 신규 개발의 시작 전: 단계 막대(아래에 단계별 설정 문장, 개발은 정할 것이 없어 문장이 없다)와 이어서 할 단계를 알리는 안내. 마친 단계의 설정은 펼치지 않는다.
const BuildReady = () => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { endTime, gates } = useComposerStore(useShallow((store) => ({ endTime: store.endTime, gates: store.gates })));
    const endLabel = useClock((now) => formatEndTimeShort(endTime, now));
    const greeting = getBuildGreeting({ buildPhase: buildPhase, endLabel: endLabel, gates: gates });
    const cells = getReadySteps(buildPhase);
    const settings = Object.fromEntries(cells.filter((cell) => cell.state !== "done").map((cell) => [cell.phase, SETTINGS[cell.phase]]));
    const shownBrainstormPhases = BRAINSTORM_PHASES.filter((phase) => settings[phase]);
    const usesCodex = useComposerStore((store) => shownBrainstormPhases.some((phase) => getBrainstormMode(store, phase) !== "claude"));
    // Codex 공통 줄은 설정을 보이고 있는 기획·디자인 줄 바로 뒤에 둔다.
    const codexRow = usesCodex ? { name: "Codex", after: shownBrainstormPhases.at(-1), node: <CodexSettings phases={shownBrainstormPhases} /> } : null;

    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            <StepCard id="build-steps" cells={cells} settings={settings} extra={codexRow} />
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
