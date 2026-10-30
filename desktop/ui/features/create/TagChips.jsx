import { useState } from "react";
import { Icon } from "../../components/Icon.jsx";

// 넣은 것(흰 칩·체크)과 추천(회색·+)을 눌러 바꾸는 칩 묶음. onAdd가 있으면 끝에 입력 칸을 두고 Enter로 더하며, 여러 줄을 붙여 넣으면 줄마다 더한다.
const TagChips = ({ label, items, onToggle, onAdd = null, addLabel = "", inputId = undefined, autoFocus = false }) => {
    const [text, setText] = useState("");

    const add = (labels) => {
        const clean = labels.map((item) => item.trim()).filter(Boolean);

        if (clean.length > 0) {
            onAdd(clean);
        }

        setText("");
    };

    const handleKeyDown = (event) => {
        // 한글 입력 중의 Enter는 글자를 맺는 것이라 넘긴다.
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            add([text]);
        }
    };

    const handlePaste = (event) => {
        const pasted = event.clipboardData.getData("text");

        if (pasted.includes("\n")) {
            event.preventDefault();
            add(pasted.split(/\r?\n/));
        }
    };

    return (
        <div className="tags" role="group" aria-label={label}>
            {items.map((item, index) => (
                <button key={item.label} type="button" className="tag-chip" data-picked={item.picked ? "" : undefined} aria-pressed={item.picked} onClick={() => onToggle(index)}>
                    <Icon symbol={item.picked ? "icon-check" : "icon-plus"} />
                    {item.label}
                </button>
            ))}
            {onAdd ? (
                <label className="tag-add">
                    <Icon symbol="icon-plus" />
                    <input
                        id={inputId}
                        value={text}
                        maxLength={60}
                        spellCheck={false}
                        placeholder={addLabel}
                        aria-label={addLabel}
                        autoFocus={autoFocus}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onBlur={() => text.trim() && add([text])}
                    />
                </label>
            ) : null}
        </div>
    );
};

export { TagChips };
