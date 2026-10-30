import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EFFORT_TERMS, formatEffort } from "../../../viewFormat.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { replayAnimation, useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { getCodexDefaults } from "../../lib/buildSteps.js";
import { CODEX_EFFORT_LEVELS, CODEX_RUNNER, DEFAULT_EFFORT_LEVEL, DEFAULT_RUNNER, EFFORT_LEVELS, OPTIONS_LOCKED_TITLE } from "../../lib/constants.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useRunsStore } from "../../stores/runsStore.js";

// Effort는 AI마다 부르는 이름과 단계 설명이 다르다. Claude는 Effort(기본이 가운데 단계), Codex는 Reasoning이고 기본이 Codex 설정에 따로 있어 가운데 단계를 기본값이라고 부르지 않는다.
const PROVIDERS = {
    [DEFAULT_RUNNER]: {
        name: "Claude",
        term: EFFORT_TERMS[DEFAULT_RUNNER],
        logo: "logo-claude",
        caption: "답을 얼마나 깊이 생각할지 정해요",
        descriptions: ["가장 빠르게", "가볍게", "기본값", "더 깊게", "가장 깊게"]
    },
    [CODEX_RUNNER]: {
        name: "Codex",
        term: EFFORT_TERMS[CODEX_RUNNER],
        logo: "logo-openai",
        caption: "추론에 쓰는 노력(reasoning effort)을 정해요",
        descriptions: ["가장 빠르게", "가볍게", "깊게", "더 깊게", "가장 깊게"]
    }
};

const getLevelOptions = (runner, levels) => levels.map((name, index) => ({ value: name, level: index, title: formatEffort(name, runner), desc: PROVIDERS[runner].descriptions[index] }));
const CLAUDE_OPTIONS = getLevelOptions(DEFAULT_RUNNER, EFFORT_LEVELS);
const CODEX_LEVEL_OPTIONS = getLevelOptions(CODEX_RUNNER, CODEX_EFFORT_LEVELS);

// Codex 설정을 따르는 Effort. 설정이나 모델의 기본 단계를 알면 그 단계를 보이고 파형도 그 높이로 그린다.
const getCodexAutoOption = (defaultEffort) => {
    const level = CODEX_EFFORT_LEVELS.indexOf(defaultEffort);

    return {
        value: "",
        level: level < 0 ? DEFAULT_EFFORT_LEVEL : level,
        title: "기본",
        chipTitle: defaultEffort ? formatEffort(defaultEffort, CODEX_RUNNER) : "기본",
        desc: defaultEffort ? `Codex 설정 · ${formatEffort(defaultEffort, CODEX_RUNNER)}` : "Codex 설정을 따라요",
        isAuto: true
    };
};

// 단계가 높을수록 두 마루의 진폭이 커지는 물결. 알약과 목록이 같은 모양을 쓴다. Codex 설정을 따르면 점선이다.
const getWavePath = (level) => `M-7 8q2-${(1 + level * 1.7).toFixed(1)} 4 0${"t4 0".repeat(8)}`;

const Wave = ({ level, isAuto = false }) => {
    return (
        <svg className={isAuto ? "wave is-auto" : "wave"} viewBox="0 0 18 16" aria-hidden="true">
            <path style={{ d: `path("${getWavePath(level)}")` }} />
        </svg>
    );
};

// 지금 회차를 돌리는 쪽(Claude·Codex)의 Effort 목록과 고른 값. Codex는 맨 앞에 Codex 설정을 따르는 기본을 둔다.
const useEffortChoice = () => {
    const isCodex = useComposerStore((store) => store.runner === CODEX_RUNNER);
    const claudeLevel = useComposerStore((store) => store.effort);
    const codexEffort = useComposerStore((store) => store.codexEffort);
    const codexModel = useComposerStore((store) => store.codexModel);
    const codex = useRunsStore((store) => store.providers?.codex);

    if (!isCodex) {
        return { runner: DEFAULT_RUNNER, options: CLAUDE_OPTIONS, selected: CLAUDE_OPTIONS[claudeLevel] };
    }

    const autoOption = getCodexAutoOption(getCodexDefaults(codex, codexModel).effort);
    const options = [autoOption, ...CODEX_LEVEL_OPTIONS];

    return { runner: CODEX_RUNNER, options: options, selected: options.find((option) => option.value === codexEffort) ?? autoOption };
};

// 이름은 단계가 오른 쪽(아래에서)·내린 쪽(위에서)으로 들어온다.
const EffortChip = () => {
    const { runner, options, selected } = useEffortChoice();
    const provider = PROVIDERS[runner];
    const isCodex = runner === CODEX_RUNNER;
    const level = selected.level;
    const isStopping = useRunStore((store) => store.state.status === "stopping");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const previousLevel = useRef(level);
    const label = selected.chipTitle ?? selected.title;
    const nameRef = useRef(null);
    const chipRef = useMergedRef(useWidthTween(label), useReplayOnChange(label, "effort-swap"));

    useLayoutEffect(() => {
        if (previousLevel.current !== level) {
            replayAnimation(nameRef.current, level > previousLevel.current ? "tick-up" : "tick-down");
            previousLevel.current = level;
        }
    }, [level]);

    useEffect(() => {
        if (isStopping) {
            popoverRef.current?.hidePopover();
        }
    }, [isStopping]);

    const choose = (option, index) => {
        if (isStopping) {
            return;
        }

        if (isCodex) {
            composer.chooseCodexEffort(option.value);
        } else {
            composer.chooseEffort(index);
        }

        closePopoverSoon(popoverRef);
    };

    return (
        <>
            <Chip
                id="effort-control"
                chipRef={chipRef}
                className="effort"
                data-level={level}
                style={{ "--level": level }}
                popoverTarget="effort-popover"
                aria-label={`${provider.name} ${provider.term} 고르기`}
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : selected.isAuto ? "Codex 설정을 따라요" : undefined}
            >
                <Wave level={level} isAuto={selected.isAuto} />
                <b id="effort-name" ref={nameRef} className="effort-name">
                    {label}
                </b>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover
                id="effort-popover"
                className="popover choice-popover"
                role="group"
                aria-label={`${provider.name} ${provider.term}`}
                data-level={level}
                popoverRef={popoverRef}
                onToggle={setIsOpen}
            >
                <div className="choice-head">
                    <Icon symbol={provider.logo} className="mark logo" />
                    <span className="choice-head-text">
                        <b>
                            {provider.name} {provider.term}
                        </b>
                        <small>{provider.caption}</small>
                    </span>
                </div>
                {options.map((option, index) => (
                    <Fragment key={option.value || "auto"}>
                        <button type="button" className="choice-option effort" data-level={option.level} aria-pressed={option === selected} onClick={() => choose(option, index)}>
                            <Wave level={option.level} isAuto={option.isAuto} />
                            <span className="choice-title">{option.title}</span>
                            <small className="choice-desc">{option.desc}</small>
                        </button>
                        {option.isAuto ? <i className="choice-divider" aria-hidden="true"></i> : null}
                    </Fragment>
                ))}
            </Popover>
        </>
    );
};

export { EffortChip };
