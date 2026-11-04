import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatEndTimeShort } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { Select } from "../../components/Select.jsx";
import { Stepper } from "../../components/Stepper.jsx";
import { BRAINSTORM_PHASES, DEBATE_TURNS_LIMIT, PHASE_LABELS } from "../../lib/constants.js";
import {
    BRAINSTORM_AFTER,
    CROSS_REVIEW_OPTIONS,
    DESIGN_FORMAT_OPTIONS,
    GATE_OPTIONS,
    MAX_ON_FAIL_RETRIES,
    SKIP_NOTES,
    SKIP_OPTIONS,
    ON_FAIL_WHEN,
    getAssistOptions,
    getBrainstormMode,
    getBuildGreeting,
    getMainOptions,
    getAssistSummary,
    getMaxRetries,
    getPhaseSummary,
    getReadySteps,
    getSecurityReviewOptions,
    toOnFailValue
} from "../../lib/buildSteps.js";
import { getAssistant, getMain } from "../../lib/phaseAgents.js";
import { useClock } from "../../stores/clock.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { StepCard } from "../steps/StepCard.jsx";

// 단계 설정은 선택에 따라 문장이 바뀌는 글이다. 말 조각과 알약 모양의 선택 상자(inline)를 같은 간격으로 늘어놓고, 조사(.j)는 앞 알약에 붙인다. 고르면 그 뒤의 말도 함께 바뀐다.
// 모델과 노력·추론은 이 문장이 아니라 아래 입력창의 AI 알약이 맡는다(단계 선택과 무관하게 늘 같다).

// 끝나면 어떻게 할지. 보조가 있는 단계는 고르려고 늘 멈추므로 선택 대신 그 말을 그대로 쓴다.
const GateSentence = ({ phase }) => {
    const { isOn, brainstormMode } = useComposerStore(useShallow((store) => ({ isOn: store.gates.includes(phase), brainstormMode: getBrainstormMode(store, phase) })));

    if (brainstormMode !== "none") {
        return <span>끝나면 멈추고 {BRAINSTORM_AFTER[brainstormMode]}.</span>;
    }

    return (
        <>
            <span>끝나면</span>
            <Select inline value={isOn ? "stop" : "go"} options={GATE_OPTIONS} onChange={() => composer.toggleGate(phase)} ariaLabel={`${PHASE_LABELS[phase]}이 끝난 뒤`} />
            <span className="j">.</span>
        </>
    );
};

// 이 단계의 회차를 돌리는 메인 AI. Codex를 쓸 수 없으면 그 이유를 알리고 고를 수 없게 한다.
const MainSelect = ({ phase }) => {
    const main = useComposerStore((store) => getMain(store.mains, phase));
    const codex = useRunsStore((store) => store.providers?.codex);

    return <Select inline value={main} options={getMainOptions(codex)} onChange={(value) => composer.setPhaseMain(phase, value)} ariaLabel={`${PHASE_LABELS[phase]}의 메인`} />;
};

// 이 단계의 보조(메인의 반대쪽 AI)를 어떻게 붙일지. 보조가 Codex면 외부 서비스로 보내기도 켜진다.
const AssistSelect = ({ phase }) => {
    const { main, brainstormMode } = useComposerStore(useShallow((store) => ({ main: getMain(store.mains, phase), brainstormMode: getBrainstormMode(store, phase) })));
    const codex = useRunsStore((store) => store.providers?.codex);

    return <Select inline value={brainstormMode} options={getAssistOptions(main, codex)} onChange={(value) => composer.setBrainstormMode(phase, value)} ariaLabel={`${PHASE_LABELS[phase]}의 보조`} />;
};

// 외부 도구가 필요한 산출물인데 보내기를 허용하지 않았으면 엔진이 HTML로 만든다는 것을 미리 알린다.
const DesignFormat = () => {
    const designFormat = useComposerStore((store) => store.designFormat);

    return <Select inline value={designFormat} options={DESIGN_FORMAT_OPTIONS} onChange={composer.setDesignFormat} ariaLabel="디자인 산출물" />;
};

const PlanSettings = () => {
    return (
        <div className="step-sentence">
            <span>기획은</span>
            <MainSelect phase="plan" />
            <span className="j">이고,</span>
            <AssistSelect phase="plan" />
            <span>진행하고,</span>
            <GateSentence phase="plan" />
        </div>
    );
};

const DesignSettings = () => {
    const isExternalFormat = useComposerStore((store) => ["figma", "image"].includes(store.designFormat) && !store.allow.includes("send"));

    return (
        <>
            <div className="step-sentence">
                <span>디자인은</span>
                <DesignFormat />
                <span>형식으로 만들어요.</span>
            </div>
            <div className="step-sentence">
                <MainSelect phase="design" />
                <span className="j">이고,</span>
                <AssistSelect phase="design" />
                <span>진행하고,</span>
                <GateSentence phase="design" />
            </div>
            {isExternalFormat ? <p className="step-note">외부 서비스로 보내기를 허용하지 않아서 HTML로 만들어요.</p> : null}
        </>
    );
};

const BuildSettings = () => {
    return (
        <div className="step-sentence">
            <span>개발은</span>
            <MainSelect phase="build" />
            <span className="j">으로 코드를 짜고 커밋해요.</span>
        </div>
    );
};

const ON_FAIL_SETTINGS = {
    qa: { key: "qaOnFail", set: composer.setQaOnFail, label: "테스트/QA 실패 처리", topic: "테스트/QA는" },
    security: { key: "securityOnFail", set: composer.setSecurityOnFail, label: "보안검토 실패 처리", topic: "보안검토는" }
};

// 테스트/QA·보안검토: 메인과, 실패하면 개발로 몇 번까지 되돌릴지. 횟수를 숫자 조절기로 정하고, 0이면 되돌리지 않고 멈춘다.
const OnFailSettings = ({ phase }) => {
    const setting = ON_FAIL_SETTINGS[phase];
    const retries = useComposerStore((store) => getMaxRetries(store[setting.key]));

    // 조절기가 문장 안에서 늘 같은 자리에 있어야 횟수를 바꿔도 다시 만들어지지 않아 포커스가 남는다.
    return (
        <div className="step-sentence">
            <span>{setting.topic}</span>
            <MainSelect phase={phase} />
            <span className="j">이고, {ON_FAIL_WHEN[phase]} 개발로</span>
            <Stepper value={retries} max={MAX_ON_FAIL_RETRIES} onChange={(count) => setting.set(toOnFailValue(count))} ariaLabel={setting.label} />
            <span className="j">{retries ? "번까지 되돌려 다시 고쳐요." : "번 되돌려요. 되돌리지 않고 결과만 남기고 멈춰요."}</span>
        </div>
    );
};

// 보안검토의 독립 검토: 점검이 끝나면 메인의 반대쪽 AI가 코드를 따로 읽고 다시 확인한다. 검토자가 Codex면 외부 서비스로 보내기도 함께 켜진다.
const SecurityReviewSettings = () => {
    const { main, securityReview } = useComposerStore(useShallow((store) => ({ main: getMain(store.mains, "security"), securityReview: store.securityReview })));
    const codex = useRunsStore((store) => store.providers?.codex);

    return (
        <>
            <div className="step-sentence">
                <span>점검이 끝나면</span>
                <Select inline value={securityReview} options={getSecurityReviewOptions(main, codex)} onChange={composer.setSecurityReview} ariaLabel="보안검토의 독립 검토" />
                <span className="j">.</span>
            </div>
            {securityReview !== "off" && main === "claude" ? <p className="step-note">Codex에 프로젝트 내용을 보내야 해서 외부 서비스로 보내기도 함께 켰어요.</p> : null}
        </>
    );
};

// 하지 않을 수도 있는 단계(디자인·테스트/QA·보안검토): 앞머리에서 진행할지 건너뛸지 고른다. 건너뛰면 그 단계의 다른 설정은 숨기고 잃는 것을 알린다.
const SkippableSettings = ({ phase, children }) => {
    const isSkipped = useComposerStore((store) => store.skip.includes(phase));

    return (
        <>
            <div className="step-sentence">
                <span>이 단계는</span>
                <Select inline value={isSkipped ? "skip" : "run"} options={SKIP_OPTIONS} onChange={() => composer.toggleSkip(phase)} ariaLabel={`${PHASE_LABELS[phase]} 단계를 할지`} />
                <span className="j">.</span>
            </div>
            {isSkipped ? <p className="step-note">{SKIP_NOTES[phase]}</p> : children}
        </>
    );
};

const SETTINGS = {
    plan: <PlanSettings />,
    design: (
        <SkippableSettings phase="design">
            <DesignSettings />
        </SkippableSettings>
    ),
    build: <BuildSettings />,
    qa: (
        <SkippableSettings phase="qa">
            <OnFailSettings phase="qa" />
        </SkippableSettings>
    ),
    security: (
        <SkippableSettings phase="security">
            <OnFailSettings phase="security" />
            <SecurityReviewSettings />
        </SkippableSettings>
    )
};

// 협의 횟수와 교차검토는 보조를 쓰는 모든 단계가 함께 쓰는 값이라 단계 줄이 아니라 한 줄로 둔다. phases는 설정을 보이고 있는 기획·디자인이다.
const AssistSettings = ({ phases }) => {
    const { modes, assistants, debateTurns, crossReview } = useComposerStore(
        useShallow((store) => ({
            modes: phases.map((phase) => getBrainstormMode(store, phase)).join(","),
            assistants: phases.map((phase) => getAssistant(store.mains, phase)).join(","),
            debateTurns: store.debateTurns,
            crossReview: store.crossReview
        }))
    );
    const hasCodexAssistant = modes.split(",").some((mode, index) => mode !== "none" && assistants.split(",")[index] === "codex");

    return (
        <>
            {modes.includes("debate") ? (
                <div className="step-sentence">
                    <span>협의는</span>
                    <Stepper value={debateTurns} min={1} max={DEBATE_TURNS_LIMIT} onChange={composer.setDebateTurns} ariaLabel="협의 최대 횟수" />
                    <span className="j">번까지 주고받아요. 둘 다 더 고칠 것이 없으면 그 전에 끝나요.</span>
                </div>
            ) : null}
            {modes.includes("compare") ? (
                <div className="step-sentence">
                    <span>두 안을 낸 뒤</span>
                    <Select inline value={crossReview ? "on" : "off"} options={CROSS_REVIEW_OPTIONS} onChange={(value) => composer.setCrossReview(value === "on")} ariaLabel="교차검토" />
                    <span className="j">.</span>
                </div>
            ) : null}
            <p className="step-hint">협의와 교차검토는 보조를 쓰는 모든 단계가 같은 값을 써요.</p>
            {hasCodexAssistant ? <p className="step-note">Codex에 프로젝트 내용을 보내야 해서 외부 서비스로 보내기도 함께 켰어요.</p> : null}
        </>
    );
};

// 신규 개발의 시작 전: 단계 막대(아래에 단계별 설정 줄)와 이어서 할 단계를 알리는 안내. 단계 줄은 고른 값의 요약으로 접혀 있고 눌러서 펼친다. 마친 단계의 설정은 펼치지 않는다.
// 모델과 노력·추론은 단계 줄이 아니라 아래 입력창의 AI 알약이 맡는다(단계를 바꿔도 알약은 그대로다).
const BuildReady = () => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const config = useComposerStore(
        useShallow((store) => ({
            endTime: store.endTime,
            gates: store.gates,
            skip: store.skip,
            allow: store.allow,
            mains: store.mains,
            brainstorm: store.brainstorm,
            debate: store.debate,
            designFormat: store.designFormat,
            qaOnFail: store.qaOnFail,
            securityOnFail: store.securityOnFail,
            securityReview: store.securityReview,
            debateTurns: store.debateTurns,
            crossReview: store.crossReview
        }))
    );
    const endLabel = useClock((now) => formatEndTimeShort(config.endTime, now));
    const greeting = getBuildGreeting({ buildPhase: buildPhase, endLabel: endLabel, gates: config.gates, skip: config.skip });
    const cells = getReadySteps(buildPhase, config.skip);
    const settings = Object.fromEntries(cells.filter((cell) => cell.state !== "done").map((cell) => [cell.phase, SETTINGS[cell.phase]]));
    const summaries = Object.fromEntries(Object.keys(settings).map((phase) => [phase, getPhaseSummary(phase, config)]));
    const shownBrainstormPhases = BRAINSTORM_PHASES.filter((phase) => settings[phase] && !config.skip.includes(phase));
    const brainstormModes = shownBrainstormPhases.map((phase) => getBrainstormMode(config, phase));
    // 협의·교차검토 줄은 설정을 보이고 있는 기획·디자인 줄 바로 뒤에 둔다.
    const assistRow = brainstormModes.some((mode) => mode !== "none") ? { name: "보조", after: shownBrainstormPhases.at(-1), node: <AssistSettings phases={shownBrainstormPhases} /> } : null;

    if (assistRow) {
        summaries.shared = getAssistSummary(brainstormModes, config);
    }

    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            <div className="build-lead">
                <h1 id="greet-title">{greeting.title}</h1>
                <p id="greet-lead" className="lead">
                    {greeting.lead}
                </p>
            </div>
            <StepCard id="build-steps" cells={cells} settings={settings} summaries={summaries} extra={assistRow} />
        </>
    );
};

export { BuildReady };
