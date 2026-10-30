import { useEffect, useRef, useState } from "react";
import { MODEL_LABELS, formatModelName } from "../../../viewFormat.js";
import { loadProviders } from "../../actions/runs.js";
import { settings } from "../../actions/settings.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { getModelsNote, useModels } from "../../hooks/useModels.js";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { getCodexDefaults, getCodexModelOptions } from "../../lib/buildSteps.js";
import { CODEX_RUNNER, DEFAULT_RUNNER, MODEL_FAMILIES, OPTIONS_LOCKED_TITLE } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";

const MODEL_DESCRIPTIONS = { fable: "가장 깊게", opus: "기본값", sonnet: "균형", haiku: "가볍고 빠르게" };
const PROVIDER_LOGOS = { [DEFAULT_RUNNER]: "logo-claude", [CODEX_RUNNER]: "logo-openai" };
const RUNNER_TABS = [
    { value: DEFAULT_RUNNER, label: "Claude" },
    { value: CODEX_RUNNER, label: "Codex" }
];
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
const ModelRow = ({ value, isChecked, isDisabled, title, desc, mark, isVersion = false, lockedTitle, onPick }) => {
    return (
        <label className="model-row" data-version={isVersion ? "" : undefined} title={isDisabled ? lockedTitle : undefined}>
            <input type="radio" name="model" value={value} form="run-form" checked={isChecked} disabled={isDisabled} onChange={onPick} />
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
const ClaudeChoices = ({ family, isChecked, isStopping, isIdle, pins, models, onPick }) => {
    const note = getModelsNote(models);

    return (
        <div className="model-list">
            {MODEL_FAMILIES.map((option) => {
                const pinned = pins[option] || "";
                const isCurrent = isChecked && family === option;

                return (
                    <div key={option} className="model-group">
                        <ModelRow
                            value={option}
                            isChecked={isCurrent && !pinned}
                            isDisabled={isStopping || (!isIdle && Boolean(pinned))}
                            lockedTitle={isStopping ? OPTIONS_LOCKED_TITLE : PINNED_LOCKED_TITLE}
                            mark={option}
                            title={MODEL_LABELS[option]}
                            desc={`${MODEL_DESCRIPTIONS[option]} · 최신 버전을 따라가요`}
                            onPick={() => onPick(option, "")}
                        />
                        {getFamilyVersions(option, pinned, models).map((id) => (
                            <ModelRow
                                key={id}
                                value={`${option}@${id}`}
                                isChecked={isCurrent && pinned === id}
                                isDisabled={isStopping || (!isIdle && pinned !== id)}
                                lockedTitle={isStopping ? OPTIONS_LOCKED_TITLE : PINNED_LOCKED_TITLE}
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
const CodexChoices = ({ codex, codexModel, isChecked, isStopping, onPick }) => {
    if (!codex || !codex.available) {
        return (
            <div className="model-empty">
                <Icon symbol={PROVIDER_LOGOS[CODEX_RUNNER]} className="mark" />
                <b>{codex ? codex.reason : "Codex를 확인하고 있어요"}</b>
                {codex ? <small>설치하고 로그인하면 여기서 고를 수 있어요</small> : null}
            </div>
        );
    }

    const defaultLabel = getCodexDefaults(codex).modelLabel;

    return (
        <div className="model-list">
            {getCodexModelOptions(codex.models ?? [], isChecked ? codexModel : "").map((option) => (
                <ModelRow
                    key={option.value || "default"}
                    value={`${CODEX_RUNNER}:${option.value}`}
                    isChecked={isChecked && codexModel === option.value}
                    isDisabled={isStopping}
                    lockedTitle={OPTIONS_LOCKED_TITLE}
                    title={option.label}
                    desc={option.value ? "" : defaultLabel ? `Codex 설정 · ${defaultLabel}` : "Codex 설정을 따라요"}
                    onPick={() => onPick(() => composer.chooseCodexModel(option.value))}
                />
            ))}
        </div>
    );
};

// 모델은 회차를 돌릴 에이전트까지 함께 고른다. 위의 탭(제공자 로고)으로 Claude·Codex 목록을 오가고(탭만 바꿔서는 바뀌지 않는다), 지금 돌리는 쪽 탭에는 점이 붙는다.
// Claude는 계열(최신 버전)이거나 계열 아래에서 고른 버전이고, Codex는 Codex가 알려 준 모델이다. 알약은 고른 쪽의 제공자 로고와 실제로 쓸 모델 이름을 보여준다.
const ModelChip = () => {
    const family = useComposerStore((store) => store.model);
    const modelId = useComposerStore((store) => store.modelId);
    const runner = useComposerStore((store) => store.runner);
    const codexModel = useComposerStore((store) => store.codexModel);
    const codex = useRunsStore((store) => store.providers?.codex);
    const pins = useAppStore((store) => store.settings.modelVersions) ?? {};
    const isStopping = useRunStore((store) => store.state.status === "stopping");
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState(runner);
    const popoverRef = useRef(null);
    const models = useModels(isOpen);
    const isCodex = runner === CODEX_RUNNER;
    const name = isCodex ? getCodexChipName(codex, codexModel) : formatModelName(pins[modelId] || modelId);
    const signature = `${runner}|${isCodex ? "" : family}|${name}`;
    const chipRef = useMergedRef(useWidthTween(signature), useReplayOnChange(signature, "model-swap"));

    const pick = (choose) => {
        choose();
        closePopoverSoon(popoverRef);
    };

    // 버전을 고르면 그 계열을 그 버전으로 고정한 뒤(빈 값은 최신 버전으로 되돌림) 모델로 고른다. 고정에 실패하면(실행 중 등) 모델은 바꾸지 않는다.
    const pickClaude = async (nextFamily, version) => {
        if ((pins[nextFamily] || "") !== version) {
            const others = Object.fromEntries(Object.entries(pins).filter(([key]) => key !== nextFamily));

            if (!(await settings.update({ modelVersions: version ? { ...others, [nextFamily]: version } : others }))) {
                return;
            }
        }

        pick(() => composer.chooseModel(nextFamily));
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
                data-model={isCodex ? CODEX_RUNNER : family}
                popoverTarget="model-popover"
                aria-label="모델 고르기"
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : undefined}
            >
                <Icon symbol={PROVIDER_LOGOS[runner]} className="mark logo" />
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
                            <Icon symbol={PROVIDER_LOGOS[option.value]} className="mark logo" />
                            {option.label}
                        </button>
                    ))}
                </div>
                <div role="radiogroup" aria-label={tab === CODEX_RUNNER ? "Codex 모델" : "Claude 모델"}>
                    {tab === CODEX_RUNNER ? (
                        <CodexChoices codex={codex} codexModel={codexModel} isChecked={isCodex} isStopping={isStopping} onPick={pick} />
                    ) : (
                        <ClaudeChoices family={family} isChecked={!isCodex} isStopping={isStopping} isIdle={isIdle} pins={pins} models={models} onPick={pickClaude} />
                    )}
                </div>
            </Popover>
        </>
    );
};

export { ModelChip };
