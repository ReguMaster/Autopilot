import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { settings } from "../../actions/settings.js";
import { RAIL_WIDTH } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";

const KEY_STEP = 8;

const clampWidth = (width) => Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, width)));

const getKeyWidth = (key, width) => {
    return { Home: RAIL_WIDTH.min, End: RAIL_WIDTH.max, ArrowLeft: width - KEY_STEP, ArrowRight: width + KEY_STEP }[key];
};

// 레일 오른쪽 경계의 끌기 손잡이. 끄는 동안은 이 컴포넌트만 다시 그리고 CSS 변수로 너비를 바꾸며, 놓을 때 한 번 저장한다.
const RailResizer = () => {
    const savedWidth = useAppStore((store) => store.settings.railWidth ?? RAIL_WIDTH.default);
    const [width, setWidth] = useState(savedWidth);
    const [isDragging, setIsDragging] = useState(false);
    // 놓는 이벤트가 마지막으로 그린 너비보다 먼저 올 수 있어 저장할 값은 ref로 읽는다.
    const widthRef = useRef(savedWidth);
    const grabOffsetRef = useRef(0);

    const update = (next) => {
        widthRef.current = next;
        setWidth(next);
    };

    useEffect(() => {
        update(savedWidth);
    }, [savedWidth]);

    useLayoutEffect(() => {
        document.documentElement.style.setProperty("--rail-size", `${width}px`);
    }, [width]);

    const commit = (next) => {
        update(next);

        if (next !== savedWidth) {
            settings.setPreferences({ railWidth: next });
        }
    };

    const handlePointerDown = (event) => {
        if (event.button !== 0) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        grabOffsetRef.current = event.clientX - widthRef.current;
        setIsDragging(true);
    };

    const handlePointerMove = (event) => {
        if (isDragging) {
            update(clampWidth(event.clientX - grabOffsetRef.current));
        }
    };

    const handlePointerEnd = () => {
        if (isDragging) {
            setIsDragging(false);
            commit(widthRef.current);
        }
    };

    const handleKeyDown = (event) => {
        const next = getKeyWidth(event.key, widthRef.current);

        if (next !== undefined) {
            event.preventDefault();
            update(clampWidth(next));
        }
    };

    return (
        <div
            className="rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="사이드바 너비"
            aria-valuemin={RAIL_WIDTH.min}
            aria-valuemax={RAIL_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            title="끌어서 너비 조절, 두 번 누르면 기본값"
            data-dragging={isDragging ? "" : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown}
            onKeyUp={() => commit(widthRef.current)}
            onDoubleClick={() => commit(RAIL_WIDTH.default)}
        />
    );
};

export { RailResizer };
