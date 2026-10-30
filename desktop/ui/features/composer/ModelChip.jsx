import { useEffect, useRef, useState } from "react";
import { formatModelName } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { getCodexDefaults, getCodexModelOptions } from "../../lib/buildSteps.js";
import { CODEX_RUNNER, DEFAULT_RUNNER, MODEL_FAMILIES, OPTIONS_LOCKED_TITLE } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";

const MODEL_NAMES = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const MODEL_DESCRIPTIONS = { fable: "가장 깊게", opus: "기본값", sonnet: "균형", haiku: "가볍고 빠르게" };
const RUNNER_TABS = [
    { value: DEFAULT_RUNNER, label: "Claude" },
    { value: CODEX_RUNNER, label: "Codex" }
];

// Codex 모델의 알약 이름. 기본 모델은 Codex 설정의 모델을, 그것도 모르면 Codex라고 쓴다. 목록에 없는 모델은 받은 이름 그대로다.
const getCodexChipName = (codex, codexModel) => {
    if (!codexModel) {
        return getCodexDefaults(codex).modelLabel || "Codex";
    }

    return codex?.models?.find((model) => model.id === codexModel)?.label || codexModel;
};

const ClaudeChoices = ({ family, isChecked, isStopping, onPick }) => {
    return (
        <div className="model-grid">
            {MODEL_FAMILIES.map((option) => (
                <label key={option} className="choice-option">
                    <input
                        type="radio"
                        name="model"
                        value={option}
                        form="run-form"
                        checked={isChecked && family === option}
                        disabled={isStopping}
                        onChange={() => onPick(() => composer.chooseModel(option))}
                    />
                    <svg className="mark" aria-hidden="true">
                        <use href={`#mark-${option}`} />
                    </svg>
                    <span className="choice-title">{MODEL_NAMES[option]}</span>
                    <small className="choice-desc">{MODEL_DESCRIPTIONS[option]}</small>
                </label>
            ))}
        </div>
    );
};

// Codex 모델 목록. 쓸 수 있는지 아직 모르면 확인 중, 쓸 수 없으면 이유를 보인다. 기본 모델은 Codex 설정이 지금 무엇인지 함께 보인다.
const CodexChoices = ({ codex, codexModel, isChecked, isStopping, onPick }) => {
    if (!codex || !codex.available) {
        return (
            <div className="codex-empty">
                <svg className="mark" aria-hidden="true">
                    <use href="#mark-codex" />
                </svg>
                <b>{codex ? codex.reason : "Codex를 확인하고 있어요"}</b>
                {codex ? <small>설치하고 로그인하면 여기서 고를 수 있어요</small> : null}
            </div>
        );
    }

    const defaultLabel = getCodexDefaults(codex).modelLabel;

    return (
        <div className="codex-list">
            {getCodexModelOptions(codex.models ?? [], isChecked ? codexModel : "").map((option) => (
                <label key={option.value || "default"} className="codex-row">
                    <input
                        type="radio"
                        name="model"
                        value={`${CODEX_RUNNER}:${option.value}`}
                        form="run-form"
                        checked={isChecked && codexModel === option.value}
                        disabled={isStopping}
                        onChange={() => onPick(() => composer.chooseCodexModel(option.value))}
                    />
                    <span className="codex-row-text">
                        <b>{option.label}</b>
                        {option.value ? null : <small>{defaultLabel ? `Codex 설정 · ${defaultLabel}` : "Codex 설정을 따라요"}</small>}
                    </span>
                    <Icon symbol="icon-check" className="codex-row-check" />
                </label>
            ))}
        </div>
    );
};

// 모델은 회차를 돌릴 에이전트까지 함께 고른다. 위의 탭으로 Claude·Codex 목록을 오가고(탭만 바꿔서는 바뀌지 않는다), 지금 돌리는 쪽 탭에는 점이 붙는다.
// Claude는 계열 별칭(최신 버전)이거나 설정에서 고정한 모델 ID이고, Codex는 Codex가 알려 준 모델이다. 알약은 고른 쪽의 마크와 실제로 쓸 모델 이름을 보여준다.
const ModelChip = () => {
    const family = useComposerStore((store) => store.model);
    const modelId = useComposerStore((store) => store.modelId);
    const runner = useComposerStore((store) => store.runner);
    const codexModel = useComposerStore((store) => store.codexModel);
    const codex = useRunsStore((store) => store.providers?.codex);
    const pinned = useAppStore((store) => store.settings.modelVersions?.[modelId]);
    const isStopping = useRunStore((store) => store.state.status === "stopping");
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState(runner);
    const popoverRef = useRef(null);
    const isCodex = runner === CODEX_RUNNER;
    const mark = isCodex ? CODEX_RUNNER : family;
    const name = isCodex ? getCodexChipName(codex, codexModel) : formatModelName(pinned || modelId);
    const signature = `${mark}|${name}`;
    const chipRef = useMergedRef(useWidthTween(signature), useReplayOnChange(signature, "model-swap"));

    const pick = (choose) => {
        choose();
        closePopoverSoon(popoverRef);
    };

    useEffect(() => {
        if (isStopping) {
            popoverRef.current?.hidePopover();
        }
    }, [isStopping]);

    // Codex 모델 목록은 팝오버를 열 때 읽는다(메인이 잠시 기억한다). 읽으면 목록 객체가 바뀌므로 목록을 의존값에 넣지 않는다.
    useEffect(() => {
        if (isOpen) {
            loadProviders();
        }
    }, [isOpen]);

    // Codex로 시작하는 탭은 알약 이름에도 목록이 필요하다. 아직 없을 때만 한 번 읽는다(읽지 못해도 다시 부르지 않는다).
    useEffect(() => {
        if (isCodex && !codex) {
            loadProviders();
        }
    }, [isCodex, codex]);

    return (
        <>
            <Chip
                id="model-chip"
                chipRef={chipRef}
                data-model={mark}
                popoverTarget="model-popover"
                aria-label="모델 고르기"
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : undefined}
            >
                <svg className="mark" aria-hidden="true">
                    <use href={`#mark-${mark}`} />
                </svg>
                <span id="model-chip-name">{name}</span>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover
                id="model-popover"
                className="popover choice-popover"
                aria-label="모델"
                popoverRef={popoverRef}
                onToggle={(open) => {
                    setIsOpen(open);

                    if (open) {
                        setTab(runner);
                    }
                }}
            >
                <div className="runner-tabs" role="tablist" aria-label="회차를 돌릴 AI">
                    {RUNNER_TABS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            role="tab"
                            className="runner-tab"
                            aria-selected={tab === option.value}
                            data-active={runner === option.value ? "" : undefined}
                            title={runner === option.value ? "지금 회차를 돌리는 AI예요" : undefined}
                            onClick={() => setTab(option.value)}
                        >
                            <svg className="mark" aria-hidden="true">
                                <use href={`#mark-${option.value === CODEX_RUNNER ? CODEX_RUNNER : "claude"}`} />
                            </svg>
                            {option.label}
                        </button>
                    ))}
                </div>
                <div role="radiogroup" aria-label={tab === CODEX_RUNNER ? "Codex 모델" : "Claude 모델"}>
                    {tab === CODEX_RUNNER ? (
                        <CodexChoices codex={codex} codexModel={codexModel} isChecked={isCodex} isStopping={isStopping} onPick={pick} />
                    ) : (
                        <ClaudeChoices family={family} isChecked={!isCodex} isStopping={isStopping} onPick={pick} />
                    )}
                </div>
            </Popover>
        </>
    );
};

export { ModelChip };
