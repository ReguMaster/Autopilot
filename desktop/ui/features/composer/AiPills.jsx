import { useEffect, useRef, useState } from "react";
import { MODEL_LABELS, formatEffort, formatModelName } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { settings } from "../../actions/settings.js";
import { Chip } from "../../components/Chip.jsx";
import { EffortSlider } from "../../components/EffortSlider.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { Wave } from "../../components/Wave.jsx";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { getModelsNote, useModels } from "../../hooks/useModels.js";
import { useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { getCodexDefaults, getCodexModelOptions } from "../../lib/buildSteps.js";
import { CODEX_EFFORT_LEVELS, CODEX_RUNNER, DEFAULT_EFFORT_LEVEL, DEFAULT_RUNNER, EFFORT_LEVELS, MODEL_FAMILIES, OPTIONS_LOCKED_TITLE, PHASE_LABELS, PROVIDER_LABELS } from "../../lib/constants.js";
import { PROVIDER_LOGOS, getMainPhases, getOtherProvider } from "../../lib/phaseAgents.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import "./AiPills.css";

const MODEL_DESCRIPTIONS = { fable: "가장 깊게", opus: "기본값", sonnet: "균형", haiku: "가볍고 빠르게" };
const PROVIDERS = [DEFAULT_RUNNER, CODEX_RUNNER];
const TERMS = { claude: "노력", codex: "추론" };
const TERM_NOTES = { claude: "얼마나 애써서 생각할지 정해요", codex: "답을 내기 전에 얼마나 따져 볼지 정해요" };
const PINNED_LOCKED_TITLE = "고정한 버전은 실행 중에 바꿀 수 없어요";

// Codex 모델의 알약 이름. 기본 모델은 Codex 설정의 모델을, 그것도 모르면 Codex라고 쓴다. 목록에 없는 모델은 받은 이름 그대로다.
const getCodexChipName = (codex, codexModel) => {
    if (!codexModel) {
        return getCodexDefaults(codex).modelLabel || "Codex";
    }

    return codex?.models?.find((model) => model.id === codexModel)?.label || codexModel;
};

// 계열의 버전 목록(최신순). 고정한 버전이 목록에 없어도(목록을 못 읽었거나 내려간 모델) 보인다.
const getFamilyVersions = (family, pinned, models) => {
    const versions = (models ?? []).filter((model) => model.line === family).map((model) => model.id);

    return pinned && !versions.includes(pinned) ? [...versions, pinned] : versions;
};

// 모델 한 줄. 고르는 라디오는 보이지 않게 줄 전체를 덮고, 고른 줄은 체크가 켜진다. 같은 모양을 Claude·Codex 목록이 함께 쓴다.
const ModelRow = ({ name, value, isChecked, isDisabled, title, desc, mark, isVersion = false, lockedTitle, onPick }) => {
    return (
        <label className="model-row" data-version={isVersion ? "" : undefined} title={isDisabled ? lockedTitle : undefined}>
            <input type="radio" name={name} value={value} form="run-form" checked={isChecked} disabled={isDisabled} onChange={onPick} />
            {mark ? (
                <svg className="mark" aria-hidden="true" data-family={mark}>
                    <use href={`#mark-${mark}`} />
                </svg>
            ) : null}
            <span className="model-row-text">
                <b>{title}</b>
                {desc ? <small>{desc}</small> : null}
            </span>
            <Icon symbol="icon-check" className="model-row-check" />
        </label>
    );
};

// Claude 모델 목록. 계열(최신 버전을 따라감) 아래에 공식 목록의 버전이 이어지고, 버전을 고르면 그 계열을 그 버전으로 고정한다(설정의 "모델 버전"과 같은 값).
// 고정은 실행 중에 바꿀 수 없어서, 실행 중에는 고정한 계열의 줄과 버전 줄이 잠긴다(이미 고정한 그 버전을 다시 고르는 것만 된다).
const ClaudeModels = ({ family, isStopping, isIdle, pins, models, onPick }) => {
    const note = getModelsNote(models);
    const lockedTitle = isStopping ? OPTIONS_LOCKED_TITLE : PINNED_LOCKED_TITLE;

    return (
        <div className="model-list">
            {MODEL_FAMILIES.map((option) => {
                const pinned = pins[option] || "";
                const isCurrent = family === option;

                return (
                    <div key={option} className="model-group">
                        <ModelRow
                            name="model-claude"
                            value={option}
                            isChecked={isCurrent && !pinned}
                            isDisabled={isStopping || (!isIdle && Boolean(pinned))}
                            lockedTitle={lockedTitle}
                            mark={option}
                            title={MODEL_LABELS[option]}
                            desc={`${MODEL_DESCRIPTIONS[option]} · 최신 버전`}
                            onPick={() => onPick(option, "")}
                        />
                        {getFamilyVersions(option, pinned, models).map((id) => (
                            <ModelRow
                                key={id}
                                name="model-claude"
                                value={`${option}@${id}`}
                                isChecked={isCurrent && pinned === id}
                                isDisabled={isStopping || (!isIdle && pinned !== id)}
                                lockedTitle={lockedTitle}
                                isVersion
                                title={formatModelName(id)}
                                onPick={() => onPick(option, id)}
                            />
                        ))}
                    </div>
                );
            })}
            {note ? <p className="model-note">{note}</p> : null}
        </div>
    );
};

// Codex 모델 목록. 쓸 수 있는지 아직 모르면 확인 중, 쓸 수 없으면 이유를 보인다. 기본 모델은 Codex 설정이 지금 무엇인지 함께 보인다.
const CodexModels = ({ codex, codexModel, isStopping, onPick }) => {
    if (!codex || !codex.available) {
        return (
            <div className="model-empty">
                <Icon symbol={PROVIDER_LOGOS.codex} className="mark logo" />
                <b>{codex ? codex.reason : "Codex를 확인하고 있어요"}</b>
                {codex ? <small>설치하고 로그인하면 여기서 고를 수 있어요</small> : null}
            </div>
        );
    }

    const defaultLabel = getCodexDefaults(codex).modelLabel;
    const defaultDesc = defaultLabel ? `Codex 설정 · ${defaultLabel}` : "Codex 설정을 따라요";

    return (
        <div className="model-list">
            {getCodexModelOptions(codex.models ?? [], codexModel).map((option) => (
                <ModelRow
                    key={option.value || "default"}
                    name="model-codex"
                    value={option.value}
                    isChecked={codexModel === option.value}
                    isDisabled={isStopping}
                    lockedTitle={OPTIONS_LOCKED_TITLE}
                    title={option.label}
                    desc={option.value ? "" : defaultDesc}
                    onPick={() => onPick(option.value)}
                />
            ))}
        </div>
    );
};

const Switch = ({ isOn, isDisabled, label, onChange }) => {
    return (
        <label className="ai-switch" data-disabled={isDisabled ? "" : undefined}>
            <input type="checkbox" role="switch" checked={isOn} disabled={isDisabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
            <i aria-hidden="true"></i>
        </label>
    );
};

// 팝오버 맨 아래. 신규 개발은 이 AI가 메인인 단계를 보여 주기만 하고(바꾸는 곳은 단계 문장), 유지 보수는 작업할 AI를 스위치로 바꾼다. 하나를 켜면 다른 쪽은 꺼진다.
const PopoverFoot = ({ provider, mode, mains, runner, isLocked, codexReason }) => {
    const other = getOtherProvider(provider);

    if (mode === "build") {
        const phases = getMainPhases(mains, provider, PHASE_LABELS);

        return (
            <div className="ai-foot">
                <span>메인으로 맡은 단계</span>
                <span className="ai-mains">{phases.length ? phases.map((phase) => <span key={phase}>{phase}</span>) : <em>없어요</em>}</span>
            </div>
        );
    }

    const isMain = runner === provider;
    const reason = provider === CODEX_RUNNER ? codexReason : "";

    return (
        <div className="ai-foot">
            <span>
                <b>이 AI로 작업하기</b>
                <small>{reason || `지금은 ${PROVIDER_LABELS[isMain ? provider : other]}가 작업해요.`}</small>
            </span>
            <Switch isOn={isMain} isDisabled={isLocked || Boolean(reason)} label={`${PROVIDER_LABELS[provider]}로 작업하기`} onChange={(checked) => composer.setRunner(checked ? provider : other)} />
        </div>
    );
};

// 알약 끝의 역할 표시. 유지 보수에서는 작업하는 쪽에 "메인", 실행 중에는 일하는 쪽에 도는 고리와 역할이 붙는다. 단계 선택이 바뀌어도 알약 모양은 바뀌지 않는다.
const getPillTag = ({ provider, mode, runner, runState }) => {
    if (runState.status !== "idle") {
        const isWorking = runState.runner === provider;
        const isAssisting = runState.mode === "build" && !isWorking && (runState.debate?.status === "running" || runState.brainstorm?.status === "receiving");

        if (isWorking) {
            return { text: runState.mode === "build" && runState.step ? `${PHASE_LABELS[runState.step.phase]} · 메인` : "작업 중", isLive: true };
        }

        return isAssisting ? { text: "보조", isLive: false } : null;
    }

    return mode === "maintain" && runner === provider ? { text: "메인", isLive: false } : null;
};

// 입력창의 AI 알약 하나. 모델과 노력(추론)을 알약 하나에 묶고, 누르면 모델 목록과 슬라이드가 열린다.
const AiPill = ({ provider }) => {
    const isClaude = provider === DEFAULT_RUNNER;
    const family = useComposerStore((store) => store.model);
    const modelId = useComposerStore((store) => store.modelId);
    const effort = useComposerStore((store) => store.effort);
    const codexModel = useComposerStore((store) => store.codexModel);
    const codexEffort = useComposerStore((store) => store.codexEffort);
    const mode = useComposerStore((store) => store.mode);
    const mains = useComposerStore((store) => store.mains);
    const runner = useComposerStore((store) => store.runner);
    const codex = useRunsStore((store) => store.providers?.codex);
    const pins = useAppStore((store) => store.settings.modelVersions) ?? {};
    const runState = useRunStore((store) => store.state);
    const isStopping = runState.status === "stopping";
    const isIdle = runState.status === "idle";
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const models = useModels(isClaude && isOpen);

    // 노력(추론) 단계와 알약에 보일 이름. Codex 설정을 따를 때는 설정이나 모델의 기본 단계를 보이고 파형은 점선이다.
    const defaultEffort = getCodexDefaults(codex, codexModel).effort;
    const isAuto = !isClaude && codexEffort === "";
    const codexShownEffort = isAuto ? defaultEffort : codexEffort;
    const shownEffort = isClaude ? EFFORT_LEVELS[effort] : codexShownEffort;
    const levelIndex = isClaude ? effort : CODEX_EFFORT_LEVELS.indexOf(shownEffort);
    const level = levelIndex < 0 ? DEFAULT_EFFORT_LEVEL : levelIndex;
    const levelName = isAuto && !defaultEffort ? "기본" : formatEffort(shownEffort, provider);
    const modelName = isClaude ? formatModelName(pins[modelId] || modelId) : getCodexChipName(codex, codexModel);
    const signature = `${provider}|${modelName}|${levelName}`;
    const chipRef = useMergedRef(useWidthTween(signature), useReplayOnChange(signature, "model-swap"));
    const tag = getPillTag({ provider: provider, mode: mode, runner: runner, runState: runState });
    const codexReason = codex && !codex.available ? codex.reason : "";

    useEffect(() => {
        if (isStopping) {
            popoverRef.current?.hidePopover();
        }
    }, [isStopping]);

    // Codex 모델 목록은 팝오버를 열 때 읽는다(메인이 잠시 기억한다). 알약 이름에도 목록이 필요하므로 Codex 알약은 처음에도 한 번 읽는다(읽지 못해도 다시 부르지 않는다).
    // 읽은 결과가 codex 객체를 새로 만들므로 객체가 아니라 있는지 여부로만 다시 읽는다(객체를 넣으면 읽을 때마다 다시 읽는다).
    const isCodexUnknown = !codex;

    useEffect(() => {
        if (isOpen || (!isClaude && isCodexUnknown)) {
            loadProviders();
        }
    }, [isOpen, isClaude, isCodexUnknown]);

    // 버전을 고르면 그 계열을 그 버전으로 고정한 뒤(빈 값은 최신 버전으로 되돌림) 모델로 고른다. 고정에 실패하면(실행 중 등) 모델은 바꾸지 않는다.
    const pickClaude = async (nextFamily, version) => {
        if ((pins[nextFamily] || "") !== version) {
            const others = Object.fromEntries(Object.entries(pins).filter(([key]) => key !== nextFamily));

            if (!(await settings.update({ modelVersions: version ? { ...others, [nextFamily]: version } : others }))) {
                return;
            }
        }

        composer.chooseModel(nextFamily);
        closePopoverSoon(popoverRef);
    };

    const pickCodex = (model) => {
        composer.chooseCodexModel(model);
        closePopoverSoon(popoverRef);
    };

    const changeLevel = (next) => {
        if (isClaude) {
            composer.chooseEffort(next);
        } else {
            composer.chooseCodexEffort(CODEX_EFFORT_LEVELS[next]);
        }
    };

    return (
        <>
            <Chip
                id={`ai-pill-${provider}`}
                chipRef={chipRef}
                className="ai-pill"
                data-provider={provider}
                data-level={level}
                popoverTarget={`ai-popover-${provider}`}
                aria-label={`${PROVIDER_LABELS[provider]} 모델과 ${TERMS[provider]} 고르기`}
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : undefined}
            >
                <Icon symbol={PROVIDER_LOGOS[provider]} className="mark logo" />
                <span className="ai-model">{modelName}</span>
                <i className="ai-dot" aria-hidden="true"></i>
                <Wave level={level} isAuto={isAuto} />
                <span className="ai-level">{levelName}</span>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
                {tag ? (
                    <span className="ai-tag" data-live={tag.isLive ? "" : undefined}>
                        {tag.text}
                    </span>
                ) : null}
            </Chip>
            <Popover
                id={`ai-popover-${provider}`}
                className="popover choice-popover ai-popover"
                aria-label={`${PROVIDER_LABELS[provider]} 모델과 ${TERMS[provider]}`}
                popoverRef={popoverRef}
                onToggle={setIsOpen}
            >
                <div className="choice-head">
                    <Icon symbol={PROVIDER_LOGOS[provider]} className="mark logo" />
                    <span className="choice-head-text">
                        <b>{PROVIDER_LABELS[provider]}</b>
                        <small>{`모델과 ${TERMS[provider]}`}</small>
                    </span>
                </div>
                <div className="ai-sec">모델</div>
                <div className="ai-models" role="radiogroup" aria-label={`${PROVIDER_LABELS[provider]} 모델`}>
                    {isClaude ? (
                        <ClaudeModels family={family} isStopping={isStopping} isIdle={isIdle} pins={pins} models={models} onPick={pickClaude} />
                    ) : (
                        <CodexModels codex={codex} codexModel={codexModel} isStopping={isStopping} onPick={pickCodex} />
                    )}
                </div>
                <div className="ai-sec">
                    {TERMS[provider]}
                    {isClaude ? (
                        <small>{TERM_NOTES[provider]}</small>
                    ) : (
                        <span className="ai-follow">
                            <small>Codex 설정 따르기</small>
                            <Switch isOn={isAuto} isDisabled={isStopping} label="Codex 설정을 따라요" onChange={(checked) => composer.chooseCodexEffort(checked ? "" : CODEX_EFFORT_LEVELS[level])} />
                        </span>
                    )}
                </div>
                <EffortSlider provider={provider} level={level} disabled={isStopping || isAuto} onChange={changeLevel} />
                <PopoverFoot provider={provider} mode={mode} mains={mains} runner={runner} isLocked={isStopping} codexReason={codexReason} />
            </Popover>
        </>
    );
};

// 모델과 노력(추론)은 AI마다 알약 하나가 맡고, 둘 다 늘 보인다(누가 일하는지·단계 선택과 무관하다).
const AiPills = () => {
    return (
        <>
            {PROVIDERS.map((provider) => (
                <AiPill key={provider} provider={provider} />
            ))}
        </>
    );
};

export { AiPills };
