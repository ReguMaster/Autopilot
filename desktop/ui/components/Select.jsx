import { useEffect, useId, useRef, useState } from "react";
import { findByTypeahead, getNextIndex, TYPEAHEAD_RESET_MS } from "../selectKeys.js";
import "./Select.css";

const toAnchorName = (id) => `--select-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

// options는 [{ value, label, hint }]이다. 목록은 native popover라 패널의 스크롤 안에서도 잘리지 않고, 트리거 아래에 붙어 자리가 모자라면 위로 뒤집힌다.
const Select = ({ value, options, onChange, disabled = false, disabledReason = "", labelId = "", ariaLabel = "" }) => {
    const id = useId();
    const listId = `${id}-list`;
    const anchorName = toAnchorName(id);
    const triggerRef = useRef(null);
    const listRef = useRef(null);
    const typeahead = useRef({ text: "", timer: 0 });
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value)
    );
    const selectedIndexRef = useRef(selectedIndex);
    const getOptionId = (index) => `${id}-option-${index}`;

    selectedIndexRef.current = selectedIndex;

    useEffect(() => {
        const list = listRef.current;
        const handleToggle = (event) => {
            const isNowOpen = event.newState === "open";

            setIsOpen(isNowOpen);
            setActiveIndex(isNowOpen ? selectedIndexRef.current : -1);
        };

        list.addEventListener("toggle", handleToggle);

        return () => list.removeEventListener("toggle", handleToggle);
    }, []);

    useEffect(() => {
        if (disabled) {
            listRef.current.hidePopover();
        }
    }, [disabled]);

    useEffect(() => {
        if (isOpen && activeIndex >= 0) {
            listRef.current.children[activeIndex]?.scrollIntoView({ block: "nearest" });
        }
    }, [isOpen, activeIndex]);

    const choose = (index) => {
        const option = options[index];

        if (option && option.value !== value) {
            onChange(option.value);
        }
    };

    const handleOptionClick = (index) => {
        choose(index);
        listRef.current.hidePopover();
    };

    // Enter·Space는 button의 클릭이라 popovertarget이 목록을 닫는다. 이때 활성 항목을 고른다(detail이 0이면 키보드).
    const handleTriggerClick = (event) => {
        if (isOpen && event.detail === 0) {
            choose(activeIndex);
        }
    };

    const handleTypeahead = (key) => {
        clearTimeout(typeahead.current.timer);
        typeahead.current.text += key;
        typeahead.current.timer = setTimeout(() => {
            typeahead.current.text = "";
        }, TYPEAHEAD_RESET_MS);

        const found = findByTypeahead(
            options.map((option) => option.label),
            typeahead.current.text,
            activeIndex
        );

        if (found >= 0) {
            setActiveIndex(found);
        }
    };

    const handleKeyDown = (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        if (!isOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                listRef.current.showPopover();
            }

            return;
        }

        if (event.key === "Tab") {
            listRef.current.hidePopover();

            return;
        }

        const next = getNextIndex(event.key, activeIndex, options.length);

        if (next !== null) {
            event.preventDefault();
            setActiveIndex(next);
        } else if (event.key.length === 1 && event.key !== " ") {
            handleTypeahead(event.key);
        }
    };

    const selected = options[selectedIndex];

    return (
        <span className="select">
            <button
                ref={triggerRef}
                type="button"
                className="select-trigger"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={listId}
                aria-activedescendant={isOpen && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
                aria-labelledby={labelId ? `${labelId} ${id}-value` : undefined}
                aria-label={labelId ? undefined : ariaLabel}
                popoverTarget={listId}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                style={{ anchorName: anchorName }}
                onClick={handleTriggerClick}
                onKeyDown={handleKeyDown}
            >
                <span id={`${id}-value`} className="select-value">
                    {selected?.label}
                </span>
                <svg className="chevron select-chevron" aria-hidden="true">
                    <use href="#icon-chevron" />
                </svg>
                <svg className="select-lock" aria-hidden="true">
                    <use href="#icon-lock" />
                </svg>
            </button>
            <div
                ref={listRef}
                id={listId}
                className="select-list"
                popover="auto"
                role="listbox"
                aria-labelledby={labelId || undefined}
                aria-label={labelId ? undefined : ariaLabel}
                style={{ positionAnchor: anchorName }}
                onPointerDown={(event) => event.preventDefault()}
            >
                {options.map((option, index) => (
                    <div
                        key={option.value}
                        id={getOptionId(index)}
                        className="select-option"
                        role="option"
                        aria-selected={option.value === value}
                        data-active={index === activeIndex ? "" : undefined}
                        onPointerMove={() => setActiveIndex(index)}
                        onClick={() => handleOptionClick(index)}
                    >
                        <span className="select-option-label">{option.label}</span>
                        {option.hint ? <span className="select-option-hint">{option.hint}</span> : null}
                        <svg className="icon select-check" aria-hidden="true">
                            <use href="#icon-check" />
                        </svg>
                    </div>
                ))}
            </div>
        </span>
    );
};

export { Select };
