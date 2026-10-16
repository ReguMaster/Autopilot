import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { activateTab, closeTab, openTab } from "../../actions/tabs.js";
import { Icon } from "../../components/Icon.jsx";
import { getTabLabels } from "../../lib/projectName.js";
import { useTabsStore } from "../../stores/tabsStore.js";

const getRunningTitle = (label) => `${label} · 실행 중에는 닫을 수 없어요`;

// 방향키는 포커스만 옮기고, 탭을 여는 것은 Enter·Space(버튼의 기본 동작)로 한다. 실행 중인 탭을 지나쳐도 전환이 일어나지 않는다.
const moveFocus = (event) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };

    if (!(event.key in keys)) {
        return;
    }

    const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const current = buttons.indexOf(document.activeElement);
    const next = Math.min(buttons.length - 1, Math.max(0, current + keys[event.key]));

    event.preventDefault();
    buttons[next]?.focus();
};

// 탭이 줄을 넘치면 세로 휠로도 가로로 옮겨 볼 수 있다(스크롤 막대는 숨겼다).
const scrollTabs = (event) => {
    if (event.deltaX === 0 && !event.shiftKey) {
        event.currentTarget.scrollLeft += event.deltaY;
    }
};

// 받은 탭 목록을 그린다. 열린 탭이 없으면 그리지 않는다.
const TabList = ({ tabs, active }) => {
    const listRef = useRef(null);
    const labels = getTabLabels(tabs);

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }, [active, tabs.length]);

    if (tabs.length === 0) {
        return null;
    }

    return (
        <nav id="tabbar" className="tabbar" aria-label="열린 프로젝트">
            <div id="tabs" ref={listRef} className="tabs" role="tablist" aria-label="프로젝트" onKeyDown={moveFocus} onWheel={scrollTabs}>
                {tabs.map((tab, index) => {
                    const isActive = tab.projectDir === active;
                    const isRunning = tab.status !== "idle";

                    return (
                        <div key={tab.projectDir} className="tab" data-active={isActive ? "" : undefined} data-status={tab.status}>
                            <button
                                type="button"
                                role="tab"
                                className="tab-main"
                                aria-selected={isActive}
                                tabIndex={isActive ? 0 : -1}
                                title={tab.projectDir}
                                onClick={() => activateTab(tab.projectDir)}
                            >
                                {isRunning ? <span className="tab-dot" aria-label="실행 중" /> : null}
                                <span className="tab-name">{labels[index]}</span>
                            </button>
                            <button
                                type="button"
                                className="tab-close"
                                aria-label={`${labels[index]} 탭 닫기`}
                                title={isRunning ? getRunningTitle(labels[index]) : "탭 닫기"}
                                disabled={isRunning}
                                onClick={() => closeTab(tab.projectDir)}
                            >
                                <Icon symbol="icon-x" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <button type="button" id="tab-add" className="tab-add" aria-label="프로젝트 탭 추가" title="프로젝트 탭 추가" onClick={openTab}>
                <Icon symbol="icon-plus" />
            </button>
        </nav>
    );
};

// 프로젝트 탭 줄. 헤더 바로 아래에 둔다.
const TabBar = () => {
    const { tabs, active } = useTabsStore(useShallow((store) => ({ tabs: store.tabs, active: store.active })));

    return <TabList tabs={tabs} active={active} />;
};

export { TabBar, TabList };
