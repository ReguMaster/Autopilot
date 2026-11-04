import { useEffect, useRef } from "react";
import { Panel } from "../../components/Panel.jsx";
import { ui, useUiStore } from "../../stores/uiStore.js";
import { AiSection } from "./AiSection.jsx";
import { BuildSection } from "./BuildSection.jsx";
import { DataSection } from "./DataSection.jsx";
import { GeneralSection } from "./GeneralSection.jsx";
import { ProjectSection } from "./ProjectSection.jsx";
import { RunSection } from "./RunSection.jsx";
import { ScopeSwitch } from "./ScopeControls.jsx";

// 항목마다 한 번에 하나만 그린다. isScoped는 전역과 이 프로젝트 중 어디에 저장할지 고르는 값이 있는 항목이라 범위 스위치를 보인다.
const SECTIONS = [
    { id: "general", label: "일반", hint: "화면 · 트레이 · 알림", lead: "화면과 알림처럼 앱 전체에 적용돼요.", isScoped: false, Content: GeneralSection },
    { id: "project", label: "프로젝트", hint: "저장소 · Git · 기록 보관", lead: "작업할 저장소와 Git에 남는 이름, 지난 기록을 얼마나 둘지 정해요.", isScoped: true, Content: ProjectSection },
    { id: "run", label: "실행", hint: "모드 · 한도 · PC", lead: "실행을 시작할 때의 기본값과 한도를 만났을 때, 끝난 뒤의 동작이에요.", isScoped: true, Content: RunSection },
    {
        id: "build",
        label: "신규 개발",
        hint: "단계 · 메인과 보조 · 허용",
        lead: "기획부터 보안검토까지 다섯 단계를 누가, 어떻게 맡을지 정해요. 시작할 때 입력창에 미리 채워 둬요.",
        isScoped: true,
        Content: BuildSection
    },
    { id: "ai", label: "AI", hint: "Claude · Codex · 계정", lead: "두 AI의 모델과 노력, 계정과 한도를 정해요.", isScoped: true, Content: AiSection },
    { id: "data", label: "데이터", hint: "기록 · 내보내기 · 초기화", lead: "지난 기록을 보고, 설정을 옮기거나 처음으로 되돌려요.", isScoped: false, Content: DataSection }
];

// 레일 오른쪽 본문 전체를 차지하는 설정 페이지. 왼쪽에 항목, 오른쪽에 선택한 항목의 내용을 둔다.
const SettingsPanel = () => {
    const open = useUiStore((store) => store.panel === "settings");
    const sectionId = useUiStore((store) => store.settingsSection);
    const section = SECTIONS.find((item) => item.id === sectionId) ?? SECTIONS[0];
    const bodyRef = useRef(null);
    const { Content } = section;

    useEffect(() => {
        bodyRef.current?.scrollTo({ top: 0 });
    }, [section.id]);

    return (
        <Panel id="settings" className="settings-panel" aria-labelledby="settings-title" open={open}>
            <div className="settings-page">
                <h2 id="settings-title" className="settings-title">
                    설정
                </h2>
                <nav className="settings-nav" aria-label="설정 항목">
                    {SECTIONS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            id={`settings-nav-${item.id}`}
                            className="settings-nav-item"
                            aria-current={item.id === section.id ? "page" : undefined}
                            onClick={() => ui.set({ settingsSection: item.id })}
                        >
                            <b>{item.label}</b>
                            <small>{item.hint}</small>
                        </button>
                    ))}
                </nav>
                <div id="settings-body" className="settings-body" ref={bodyRef}>
                    <header className="settings-sechead">
                        <h3 id="settings-section-title">{section.label}</h3>
                        <p>{section.lead}</p>
                    </header>
                    {section.isScoped ? <ScopeSwitch /> : null}
                    <Content />
                </div>
            </div>
        </Panel>
    );
};

export { SettingsPanel, SECTIONS };
