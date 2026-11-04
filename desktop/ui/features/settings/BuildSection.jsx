import { useEffect } from "react";
import { loadProviders } from "../../actions/runs.js";
import { settings } from "../../actions/settings.js";
import { SettingsGroup } from "../../components/SettingsGroup.jsx";
import { BUILD_PHASES, DEBATE_TURNS_LIMIT, GATE_PHASES, PHASE_LABELS, SKIPPABLE_PHASES } from "../../lib/constants.js";
import {
    ALLOW_FIXED_NOTE,
    ALLOW_OPTIONS,
    ALLOW_RISKS,
    BRAINSTORM_AFTER,
    CROSS_REVIEW_OPTIONS,
    DESIGN_FORMAT_OPTIONS,
    GATE_OPTIONS,
    MAX_ON_FAIL_RETRIES,
    ON_FAIL_WHEN,
    PHASE_DETAILS,
    SKIP_NOTES,
    SKIP_OPTIONS,
    getAllowUsage,
    getAssistOptions,
    getBrainstormMode,
    getMainOptions,
    getMaxRetries,
    getSecurityReviewOptions,
    toOnFailValue
} from "../../lib/buildSteps.js";
import { getAllowPatch, getBrainstormPatch, getMainPatch, getSecurityReviewPatch, toggleChoice } from "../../lib/buildRules.js";
import { getMain } from "../../lib/phaseAgents.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { ScopeNote, useScopedValues } from "./ScopeControls.jsx";
import { ScopedSelectRow, ScopedStepperRow, ScopedSwitchRow } from "./rows.jsx";

const BUILD_KEYS = ["allow", "mains", "brainstorm", "debate", "crossReview", "securityReview", "gates", "skip", "designFormat", "qaOnFail", "securityOnFail", "debateTurns"];
const SKIPPED_REASON = "건너뛰는 단계라 쓰지 않아요";
const ON_FAIL_KEYS = { qa: "qaOnFail", security: "securityOnFail" };

const useBuild = () => {
    return { state: useScopedValues(BUILD_KEYS), codex: useRunsStore((store) => store.providers?.codex) };
};

// 규칙이 돌려준 값 중 바뀐 키만 저장한다. 이 프로젝트 범위의 저장은 전역과 같아도 덮어쓴 값으로 고정되므로, 건드리지 않은 키까지 보내면 그 키가 프로젝트에 묶인다.
const saveChanged = (state, patch) => {
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(state[key])));

    return Object.keys(changed).length ? settings.update(changed) : Promise.resolve(true);
};

const SkipRow = ({ phase }) => {
    const { state } = useBuild();
    const isSkipped = state.skip.includes(phase);

    return (
        <ScopedSelectRow
            labelId={`skip-label-${phase}`}
            settingKey="skip"
            title="이 단계"
            note={isSkipped ? SKIP_NOTES[phase] : "건너뛰기로 하면 이 단계를 하지 않고 다음 단계로 가요."}
            value={isSkipped ? "skip" : "run"}
            options={SKIP_OPTIONS}
            onChange={() => settings.update({ skip: toggleChoice(state.skip, SKIPPABLE_PHASES, phase) })}
        />
    );
};

// 이 단계의 회차를 돌리는 메인 AI. Codex를 쓸 수 없으면 이유와 함께 잠긴다.
const MainRow = ({ phase }) => {
    const { state, codex } = useBuild();

    return (
        <ScopedSelectRow
            labelId={`main-label-${phase}`}
            settingKey="mains"
            title="메인 AI"
            note="이 단계의 회차를 돌려요."
            value={getMain(state.mains, phase)}
            options={getMainOptions(codex)}
            disabled={state.skip.includes(phase)}
            disabledReason={SKIPPED_REASON}
            onChange={(value) => saveChanged(state, getMainPatch(state, phase, value))}
        />
    );
};

// 기획·디자인의 보조(메인의 반대쪽 AI). Codex가 보조면 외부 서비스로 보내기도 함께 켜진다.
const AssistRow = ({ phase }) => {
    const { state, codex } = useBuild();
    const main = getMain(state.mains, phase);

    return (
        <ScopedSelectRow
            labelId={`assist-label-${phase}`}
            settingKey="brainstorm"
            title="보조 AI"
            note="메인의 반대쪽 AI가 어떻게 거들지 정해요. Codex가 보조면 프로젝트 내용을 보내야 해서 외부 서비스로 보내기도 함께 켜요."
            value={getBrainstormMode(state, phase)}
            options={getAssistOptions(main, codex)}
            disabled={state.skip.includes(phase)}
            disabledReason={SKIPPED_REASON}
            onChange={(value) => saveChanged(state, getBrainstormPatch(state, phase, value))}
        />
    );
};

// 끝났을 때 멈출지. 보조를 쓰는 단계는 고르려고 늘 멈추므로 바꿀 수 없다.
const GateRow = ({ phase }) => {
    const { state } = useBuild();
    const mode = getBrainstormMode(state, phase);
    const isFixed = mode !== "none";

    return (
        <ScopedSelectRow
            labelId={`gate-label-${phase}`}
            settingKey="gates"
            title="끝나면"
            note={isFixed ? `보조를 쓰는 단계는 늘 멈춰요. ${BRAINSTORM_AFTER[mode]}.` : "산출물을 직접 보고 승인할지 정해요."}
            value={isFixed || state.gates.includes(phase) ? "stop" : "go"}
            options={GATE_OPTIONS}
            disabled={isFixed || state.skip.includes(phase)}
            disabledReason={isFixed ? "보조를 쓰는 단계는 늘 멈춰요" : SKIPPED_REASON}
            onChange={() => settings.update({ gates: toggleChoice(state.gates, GATE_PHASES, phase) })}
        />
    );
};

const DesignFormatRow = () => {
    const { state } = useBuild();
    const isExternal = ["figma", "image"].includes(state.designFormat) && !state.allow.includes("send");

    return (
        <ScopedSelectRow
            labelId="design-format-label"
            settingKey="designFormat"
            title="산출물 형식"
            note={isExternal ? "외부 서비스로 보내기를 허용하지 않아서 HTML로 만들어요." : "디자인을 어떤 모양으로 남길지 정해요."}
            value={state.designFormat}
            options={DESIGN_FORMAT_OPTIONS}
            disabled={state.skip.includes("design")}
            disabledReason={SKIPPED_REASON}
            onChange={(value) => settings.update({ designFormat: value })}
        />
    );
};

// 테스트/QA·보안검토가 실패하면 개발로 몇 번까지 되돌릴지. 0이면 되돌리지 않고 결과만 남기고 멈춘다.
const OnFailRow = ({ phase }) => {
    const { state } = useBuild();
    const key = ON_FAIL_KEYS[phase];
    const retries = getMaxRetries(state[key]);

    return (
        <ScopedStepperRow
            labelId={`on-fail-label-${phase}`}
            settingKey={key}
            title="되돌릴 횟수"
            note={`${ON_FAIL_WHEN[phase]} 개발로 ${retries ? `${retries}번까지 되돌려 다시 고쳐요.` : "되돌리지 않고 결과만 남기고 멈춰요."}`}
            value={retries}
            max={MAX_ON_FAIL_RETRIES}
            ariaLabel={`${PHASE_LABELS[phase]} 되돌릴 횟수`}
            disabled={state.skip.includes(phase)}
            disabledReason={SKIPPED_REASON}
            onChange={(count) => settings.update({ [key]: toOnFailValue(count) })}
        />
    );
};

// 보안검토의 독립 검토: 점검이 끝나면 메인의 반대쪽 AI가 코드를 따로 읽고 다시 확인한다.
const SecurityReviewRow = () => {
    const { state, codex } = useBuild();

    return (
        <ScopedSelectRow
            labelId="security-review-label"
            settingKey="securityReview"
            title="독립 검토"
            note="점검이 끝나면 다른 AI가 다시 확인할지 정해요. Codex가 검토하면 외부 서비스로 보내기도 함께 켜요."
            value={state.securityReview}
            options={getSecurityReviewOptions(getMain(state.mains, "security"), codex)}
            disabled={state.skip.includes("security")}
            disabledReason={SKIPPED_REASON}
            onChange={(value) => saveChanged(state, getSecurityReviewPatch(state, value))}
        />
    );
};

const PHASE_ROWS = {
    plan: [MainRow, AssistRow, GateRow],
    design: [SkipRow, DesignFormatRow, MainRow, AssistRow, GateRow],
    build: [MainRow],
    qa: [SkipRow, MainRow, OnFailRow],
    security: [SkipRow, MainRow, OnFailRow, SecurityReviewRow]
};

const PhaseGroup = ({ phase }) => {
    return (
        <SettingsGroup id={`group-phase-${phase}`} sectionId={`phase-${phase}`} title={PHASE_LABELS[phase]} note={PHASE_DETAILS[phase]}>
            {PHASE_ROWS[phase].map((Row, index) => (
                <Row key={index} phase={phase} />
            ))}
        </SettingsGroup>
    );
};

// 협의 횟수와 교차검토는 보조를 쓰는 모든 단계가 같은 값을 쓴다.
const AssistGroup = () => {
    const { state } = useBuild();

    return (
        <SettingsGroup id="group-assist" title="두 AI가 함께 쓸 때" note="보조를 쓰는 모든 단계가 같은 값을 써요. 쓰는 단계가 없으면 적용되지 않아요.">
            <ScopedStepperRow
                labelId="debate-turns-label"
                settingKey="debateTurns"
                title="협의 최대 횟수"
                note="협의로 돌리는 단계에서 주고받는 최대 횟수예요. 둘 다 더 고칠 것이 없으면 그 전에 끝나요."
                value={state.debateTurns}
                min={1}
                max={DEBATE_TURNS_LIMIT}
                ariaLabel="협의 최대 횟수"
                onChange={(count) => settings.update({ debateTurns: count })}
            />
            <ScopedSelectRow
                labelId="cross-review-label"
                settingKey="crossReview"
                title="교차검토"
                note="두 안을 나란히 비교하는 단계에서 서로의 안을 읽고 검토를 남길지 정해요."
                value={state.crossReview ? "on" : "off"}
                options={CROSS_REVIEW_OPTIONS}
                onChange={(value) => settings.update({ crossReview: value === "on" })}
            />
        </SettingsGroup>
    );
};

// AI가 스스로 해도 되는 일. 위험도가 낮은 것부터 늘어놓고, 풀 수 없는 규칙은 아래에 늘 보인다.
const AllowGroup = () => {
    const { state } = useBuild();
    const usage = (key) => getAllowUsage(key, state);

    return (
        <SettingsGroup id="group-allow" title="허용" note="켜는 만큼 AI가 스스로 하는 일이 늘고 위험도도 올라가요.">
            {ALLOW_OPTIONS.map((option) => (
                <ScopedSwitchRow
                    key={option.key}
                    id={`allow-${option.key}`}
                    title={option.label}
                    note={option.desc}
                    detail={
                        <small className="allow-risk" data-risk={option.risk}>
                            위험도 {ALLOW_RISKS[option.risk]} · {option.riskNote}. {option.keeps}.
                            {usage(option.key).map((line) => (
                                <span key={line}> {line}</span>
                            ))}
                        </small>
                    }
                    checked={state.allow.includes(option.key)}
                    onChange={() => saveChanged(state, getAllowPatch(state, option.key))}
                />
            ))}
            <div className="field">
                <p className="field-desc">{ALLOW_FIXED_NOTE}</p>
                <ScopeNote settingKey="allow" />
            </div>
        </SettingsGroup>
    );
};

const BuildSection = () => {
    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            {BUILD_PHASES.map((phase) => (
                <PhaseGroup key={phase} phase={phase} />
            ))}
            <AssistGroup />
            <AllowGroup />
        </>
    );
};

export { BuildSection };
