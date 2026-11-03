import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { settings } from "../../actions/settings.js";
import { RAIL_WIDTH } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";

const KEY_STEP = 8;
// 끌어서 이 너비보다 좁아지면 아이콘만 남은 띠로 접힌다(접힌 너비와 펼친 최소 너비의 가운데).
const COLLAPSE_BELOW = (RAIL_WIDTH.collapsed + RAIL_WIDTH.min) / 2;
const SNAP_MS = 400;
// 960px보다 좁은 창은 저장한 너비와 상관없이 접힌다. shell.css의 반응형 기준과 같다.
const NARROW_QUERY = "(max-width: 960px)";

const subscribeNarrow = (notify) => {
    const query = matchMedia(NARROW_QUERY);

    query.addEventListener("change", notify);

    return () => query.removeEventListener("change", notify);
};

const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW_QUERY).matches);

const normalizeWidth = (width) => {
    if (width < COLLAPSE_BELOW) {
        return RAIL_WIDTH.collapsed;
    }

    return Math.round(Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, width)));
};

const getKeyWidth = (key, width) => {
    return {
        Home: RAIL_WIDTH.collapsed,
        End: RAIL_WIDTH.max,
        ArrowLeft: width <= RAIL_WIDTH.min ? RAIL_WIDTH.collapsed : width - KEY_STEP,
        ArrowRight: width < RAIL_WIDTH.min ? RAIL_WIDTH.min : width + KEY_STEP
    }[key];
};

// 레일 오른쪽 경계의 끌기 손잡이. 끄는 동안은 이 컴포넌트만 다시 그리고 루트의 CSS 변수·속성으로 너비와 접힘을 바꾸며, 놓을 때 한 번 저장한다.
const RailResizer = () => {
    const savedWidth = useAppStore((store) => store.settings.railWidth ?? RAIL_WIDTH.default);
    const isNarrow = useNarrow();
    const [width, setWidth] = useState(savedWidth);
    const [isDragging, setIsDragging] = useState(false);
    // 놓는 이벤트가 마지막으로 그린 너비보다 먼저 올 수 있어 저장할 값은 ref로 읽는다.
    const widthRef = useRef(savedWidth);
    const grabOffsetRef = useRef(0);
    const snapTimerRef = useRef(0);
    const isCollapsed = isNarrow || width === RAIL_WIDTH.collapsed;
    const wasCollapsedRef = useRef(isCollapsed);

    const update = (next) => {
        widthRef.current = next;
        setWidth(next);
    };

    useEffect(() => {
        update(savedWidth);
    }, [savedWidth]);

    useLayoutEffect(() => {
        const root = document.documentElement;

        root.style.setProperty("--rail-size", `${isCollapsed ? RAIL_WIDTH.collapsed : width}px`);
        root.toggleAttribute("data-rail-collapsed", isCollapsed);
    }, [width, isCollapsed]);

    // 끄는 동안 너비는 손을 바로 따르고, 접힘이 바뀌는 순간만 전환을 켜 부드럽게 옮겨 간다(shell.css).
    useLayoutEffect(() => {
        const root = document.documentElement;

        root.toggleAttribute("data-rail-dragging", isDragging);

        if (wasCollapsedRef.current !== isCollapsed) {
            wasCollapsedRef.current = isCollapsed;
            root.setAttribute("data-rail-snapping", "");
            clearTimeout(snapTimerRef.current);
            snapTimerRef.current = setTimeout(() => root.removeAttribute("data-rail-snapping"), SNAP_MS);
        }
    }, [isDragging, isCollapsed]);

    useEffect(() => {
        const root = document.documentElement;

        return () => {
            clearTimeout(snapTimerRef.current);
            root.removeAttribute("data-rail-dragging");
            root.removeAttribute("data-rail-snapping");
        };
    }, []);

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
            update(normalizeWidth(event.clientX - grabOffsetRef.current));
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
            update(normalizeWidth(next));
        }
    };

    if (isNarrow) {
        return null;
    }

    return (
        <div
            className="rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="사이드바 너비"
            aria-valuemin={RAIL_WIDTH.collapsed}
            aria-valuemax={RAIL_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            title="끌어서 너비 조절, 많이 좁히면 아이콘만 남아요. 두 번 누르면 기본값"
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
