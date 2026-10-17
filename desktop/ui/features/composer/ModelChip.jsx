import { useEffect, useRef, useState } from "react";
import { formatModelName } from "../../../viewFormat.js";
import { Chip } from "../../components/Chip.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Popover, closePopoverSoon } from "../../components/Popover.jsx";
import { useMergedRef } from "../../hooks/useMergedRef.js";
import { useReplayOnChange } from "../../hooks/useReplay.js";
import { useWidthTween } from "../../hooks/useWidthTween.js";
import { MODEL_FAMILIES, OPTIONS_LOCKED_TITLE } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunStore } from "../../stores/runStore.js";

const MODEL_NAMES = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const MODEL_DESCRIPTIONS = { fable: "가장 깊게", opus: "기본값", sonnet: "균형", haiku: "가볍고 빠르게" };

// 모델은 계열 별칭(최신 버전)이거나 설정에서 고정한 모델 ID다. 알약은 계열 마크와 실제로 쓸 모델 이름을 보여준다.
const ModelChip = () => {
    const family = useComposerStore((store) => store.model);
    const modelId = useComposerStore((store) => store.modelId);
    const pinned = useAppStore((store) => store.settings.modelVersions?.[modelId]);
    const isStopping = useRunStore((store) => store.state.status === "stopping");
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef(null);
    const name = formatModelName(pinned || modelId);
    const signature = `${family}|${name}`;
    const chipRef = useMergedRef(useWidthTween(signature), useReplayOnChange(signature, "model-swap"));

    useEffect(() => {
        if (isStopping) {
            popoverRef.current?.hidePopover();
        }
    }, [isStopping]);

    return (
        <>
            <Chip
                id="model-chip"
                chipRef={chipRef}
                data-model={family}
                popoverTarget="model-popover"
                aria-label="모델 고르기"
                aria-expanded={isOpen}
                disabled={isStopping}
                title={isStopping ? OPTIONS_LOCKED_TITLE : undefined}
            >
                <svg className="mark" aria-hidden="true">
                    <use href={`#mark-${family}`} />
                </svg>
                <span id="model-chip-name">{name}</span>
                <Icon symbol="icon-lock" className="lock" />
                <Icon symbol="icon-chevron" className="chevron" />
            </Chip>
            <Popover id="model-popover" className="popover choice-popover" role="radiogroup" aria-label="모델" popoverRef={popoverRef} onToggle={setIsOpen}>
                {MODEL_FAMILIES.map((option) => (
                    <label key={option} className="choice-option">
                        <input
                            type="radio"
                            name="model"
                            value={option}
                            form="run-form"
                            checked={family === option}
                            disabled={isStopping}
                            onChange={() => {
                                composer.chooseModel(option);
                                closePopoverSoon(popoverRef);
                            }}
                        />
                        <svg className="mark" aria-hidden="true">
                            <use href={`#mark-${option}`} />
                        </svg>
                        <span className="choice-title">{MODEL_NAMES[option]}</span>
                        <small className="choice-desc">{MODEL_DESCRIPTIONS[option]}</small>
                    </label>
                ))}
            </Popover>
        </>
    );
};

export { ModelChip };
