import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const UI_DIR = path.join(import.meta.dirname, "../desktop/ui");

// 화면 코드는 JSX라 Node가 바로 읽지 못한다. 확인할 모듈과 서버 렌더러를 한 번들로 묶어(react 복사본이 하나여야 훅이 동작한다) 임시 폴더에서 불러온다.
const loadUi = async () => {
    const entry = `
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { Select } from "./components/Select.jsx";
        import { Seg } from "./components/Seg.jsx";
        import { Stepper } from "./components/Stepper.jsx";
        import { EffortSlider } from "./components/EffortSlider.jsx";
        import { Modal } from "./components/Modal.jsx";
        import { ProjectList } from "./features/shell/Rail.jsx";
        import { StepCard } from "./features/steps/StepCard.jsx";
        import { DocPreview } from "./features/approval/DocPreview.jsx";
        import { TagChips } from "./features/create/TagChips.jsx";
        import { DetailPane } from "./features/archive/ArchiveSheet.jsx";
        export * from "./selectKeys.js";
        export * from "./lib/buildSteps.js";
        export { ALLOW_KEYS, ON_FAIL_CHOICES, PHASE_LABELS } from "./lib/constants.js";
        export * from "./lib/phaseAgents.js";
        export * from "./lib/effortLevels.js";
        export const renderSelect = (props) => renderToStaticMarkup(createElement(Select, props));
        export const renderEffortSlider = (props) => renderToStaticMarkup(createElement(EffortSlider, props));
        export const renderStepper = (props) => renderToStaticMarkup(createElement(Stepper, props));
        export const renderSeg = (props) => renderToStaticMarkup(createElement(Seg, props));
        export const renderModal = (props, children) => renderToStaticMarkup(createElement(Modal, props, children));
        export const renderProjectList = (props) => renderToStaticMarkup(createElement(ProjectList, props));
        export const renderStepCard = (props) => renderToStaticMarkup(createElement(StepCard, props));
        export const renderDocPreview = (props) => renderToStaticMarkup(createElement(DocPreview, props));
        export const renderTagChips = (props) => renderToStaticMarkup(createElement(TagChips, props));
        export const renderDetailPane = (props) => renderToStaticMarkup(createElement(DetailPane, props));
    `;
    const result = await build({
        stdin: { contents: entry, resolveDir: UI_DIR, loader: "js" },
        bundle: true,
        write: false,
        format: "cjs",
        platform: "node",
        jsx: "automatic",
        outdir: "out",
        define: { "process.env.NODE_ENV": '"production"' },
        logLevel: "silent"
    });
    const script = result.outputFiles.find((file) => file.path.endsWith(".js"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-ui-"));
    const file = path.join(dir, "ui.cjs");

    fs.writeFileSync(file, script.text);

    try {
        return createRequire(import.meta.url)(file);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const checkKeys = ({ getNextIndex, findByTypeahead }) => {
    assert.equal(getNextIndex("ArrowDown", 0, 5), 1);
    assert.equal(getNextIndex("ArrowDown", 4, 5), 4, "끝에서는 더 내려가지 않는다");
    assert.equal(getNextIndex("ArrowUp", 0, 5), 0);
    assert.equal(getNextIndex("ArrowDown", -1, 5), 0, "활성 항목이 없으면 처음으로 간다");
    assert.equal(getNextIndex("Home", 3, 5), 0);
    assert.equal(getNextIndex("End", 1, 5), 4);
    assert.equal(getNextIndex("PageDown", 1, 20), 9);
    assert.equal(getNextIndex("PageUp", 3, 20), 0);
    assert.equal(getNextIndex("a", 1, 5), null, "이동 키가 아니면 null이다");
    assert.equal(getNextIndex("ArrowDown", 0, 0), null, "항목이 없으면 null이다");

    const labels = ["최신 버전 (기본)", "Opus 5.5", "Opus 4.8", "Sonnet 5.5"];

    assert.equal(findByTypeahead(labels, "o", 0), 1, "현재 다음부터 그 글자로 시작하는 항목");
    assert.equal(findByTypeahead(labels, "o", 1), 2, "같은 글자를 다시 치면 다음 항목으로 돈다");
    assert.equal(findByTypeahead(labels, "o", 2), 1, "끝에서는 처음으로 돌아온다");
    assert.equal(findByTypeahead(labels, "oo", 1), 2, "같은 글자 반복도 그 글자로 돈다");
    assert.equal(findByTypeahead(labels, "opus 4", 1), 2, "이어 친 글자는 접두어로 찾는다");
    assert.equal(findByTypeahead(labels, "opus 5", 2), 1);
    assert.equal(findByTypeahead(labels, "s", 0), 3);
    assert.equal(findByTypeahead(labels, "z", 0), -1);
};

const checkSelectMarkup = ({ renderSelect }) => {
    const options = [
        { value: "", label: "최신 버전 (기본)", hint: "새 모델이 나오면 따라가요" },
        { value: "claude-opus-4-8", label: "Opus 4.8", hint: "claude-opus-4-8" },
        { value: "claude-opus-4-7", label: "Opus 4.7", hint: "claude-opus-4-7" }
    ];
    const html = renderSelect({ value: "claude-opus-4-8", options: options, onChange: () => {}, labelId: "version-label-opus" });

    assert.match(html, /role="combobox"/);
    assert.match(html, /aria-haspopup="listbox"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-labelledby="version-label-opus [^"]+"/, "보이는 제목과 현재 값을 함께 이름으로 쓴다");
    assert.match(html, /popovertarget="[^"]+"/i, "서버 렌더러는 속성 이름을 popoverTarget으로 쓰지만 HTML에서는 같다");
    assert.match(html, /anchor-name:--select-/, "인스턴스마다 앵커 이름이 있어야 목록이 자기 트리거에 붙는다");
    assert.match(html, /<span id="[^"]+-value" class="select-value">Opus 4\.8<\/span>/, "트리거에는 고른 항목의 이름이 보인다");
    assert.equal(html.match(/role="option"/g).length, 3);
    assert.equal(html.match(/aria-selected="true"/g).length, 1, "고른 항목은 하나다");
    assert.ok(html.includes("claude-opus-4-7"), "항목 설명이 보인다");
    assert.ok(!html.includes("disabled"));

    const locked = renderSelect({ value: "", options: options, onChange: () => {}, ariaLabel: "Opus 버전", disabled: true, disabledReason: "실행 중에는 바꿀 수 없어요" });

    assert.match(locked, /disabled=""/);
    assert.match(locked, /title="실행 중에는 바꿀 수 없어요"/);
    assert.match(locked, /aria-label="Opus 버전"/);

    const unknown = renderSelect({ value: "claude-gone", options: options, onChange: () => {} });

    assert.match(unknown, /class="select-value">최신 버전 \(기본\)</, "목록에 없는 값이면 첫 항목을 보여준다");
};

const checkModalMarkup = ({ renderModal }) => {
    const html = renderModal({ open: false, title: "강제 종료할까요?", onClose: () => {}, role: "alertdialog", footer: "버튼 줄" }, "되돌릴 수 없어요.");

    assert.match(html, /^<dialog [^>]*class="modal"/, "네이티브 dialog로 그린다");
    assert.match(html, /role="alertdialog"/);
    assert.match(html, /aria-labelledby="([^"]+)-title"/);
    assert.match(html, /aria-describedby="([^"]+)-body"/);
    assert.equal(html.match(/aria-labelledby="([^"]+)-title"/)[1], html.match(/id="([^"]+)-title"/)[1], "제목 id가 aria-labelledby와 이어진다");
    assert.equal(html.match(/aria-describedby="([^"]+)-body"/)[1], html.match(/id="([^"]+)-body"/)[1], "본문 id가 aria-describedby와 이어진다");
    assert.match(html, /<h2 [^>]*class="modal-title">강제 종료할까요\?<\/h2>/);
    assert.match(html, /<button [^>]*class="modal-close"[^>]*aria-label="닫기"/);
    assert.match(html, /class="modal-body">되돌릴 수 없어요\.<\/div>/);
    assert.match(html, /<footer class="modal-foot">버튼 줄<\/footer>/);
    assert.ok(!html.includes(" open"), "닫힌 채로 그린다. 여는 것은 showModal이다");

    const plain = renderModal({ open: false, title: "안내", onClose: () => {} }, "본문");

    assert.match(plain, /role="dialog"/, "기본 역할은 dialog다");
    assert.ok(!plain.includes("modal-foot"), "footer가 없으면 버튼 줄도 없다");
};

// 닫히는 전환 동안은 [open]이 빠져도 display만 flex로 남는다. 방향이 [open] 규칙에만 있으면 그동안 row로 풀려 제목·본문·버튼이 가로로 놓이고 상자가 늘어난다.
const checkModalClosingLayout = () => {
    const css = fs.readFileSync(path.join(UI_DIR, "components/Modal.css"), "utf8");
    const base = css.match(/(?:^|\n)\.modal \{([^}]*)\}/)[1];

    assert.match(base, /flex-direction:\s*column/, "모달의 세로 쌓기는 .modal 기본 규칙에 있어야 닫히는 동안에도 유지된다");
};

// 레일의 프로젝트 목록: 보는 프로젝트만 탭 순서에 들고 자세한 상태 줄을 보이며, 실행 중이거나 확인을 기다리는 프로젝트는 타일 모서리에 점이 있고 실행 중인 프로젝트는 닫을 수 없다. 단계는 다섯 칸 눈금이다.
const checkProjectListMarkup = ({ renderProjectList, getTabTicks }) => {
    assert.doesNotMatch(renderProjectList({ tabs: [], active: "" }), /role="tab"/, "열린 프로젝트가 없으면 항목이 없다");

    const html = renderProjectList({
        active: "E:/Work/app",
        activeNote: { text: "기획 확인을 기다려요", tone: "warn" },
        tabs: [
            { projectDir: "E:/Work/app", name: "app", status: "idle" },
            { projectDir: "E:/Personal/app", name: "app", status: "running" },
            { projectDir: "E:/Work/api", name: "api", status: "idle" }
        ]
    });

    assert.match(html, /role="tablist" aria-orientation="vertical" aria-label="열린 프로젝트"/);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1, "보는 프로젝트는 하나다");
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, "탭 순서에는 보는 프로젝트만 든다(방향키로 옮긴다)");
    assert.equal((html.match(/class="proj-badge"/g) ?? []).length, 2, "실행 중인 프로젝트와 확인을 기다리는 프로젝트에 점이 있다");
    assert.doesNotMatch(html, /class="ring"/);
    assert.doesNotMatch(html, /proj-ticks/, "신규 개발 단계를 모르면 눈금이 없다");
    assert.match(html, /class="proj-name rail-label">Work\/app</, "폴더 이름이 같으면 상위 폴더까지 보인다");
    assert.match(html, /class="proj-name rail-label">Personal\/app</);
    assert.match(html, /data-tone="warn"[^]*class="proj-note rail-label">기획 확인을 기다려요</, "보는 프로젝트는 받은 상태 줄을 보인다");
    assert.match(html, /class="proj-note rail-label">실행 중</);
    assert.match(html, /class="proj-note rail-label">쉬는 중</, "저장된 작업 모드를 모르면 쉬는 중이라고만 한다");
    assert.match(html, /aria-label="Personal\/app 닫기"[^>]*disabled/, "실행 중인 프로젝트는 닫기 버튼이 잠긴다");
    assert.equal((html.match(/disabled/g) ?? []).length, 1);
    assert.match(html, /title="E:\/Work\/app"/, "마우스를 올리면 전체 경로가 보인다");

    // 눈금: 실행 중이면 지금 단계, 쉬는 중이면 확인 대기·마친 단계까지. 다른 프로젝트는 탭 요약의 단계와 기억해 둔 단계 상태로 그린다.
    const ticks = (options) => getTabTicks({ status: "idle", mode: "", step: null, buildPhase: null, ...options });

    assert.deepEqual(ticks({ status: "running", mode: "build", step: { phase: "build", status: "running" } }), ["done", "done", "active", "", ""]);
    assert.deepEqual(ticks({ status: "running", mode: "build", step: { phase: "plan" } }), ["active", "", "", "", ""]);
    assert.deepEqual(ticks({ status: "stopping", mode: "build", step: { phase: "qa", status: "running" } }), ["done", "done", "done", "stop", ""]);
    assert.deepEqual(ticks({ status: "running", mode: "build", step: { phase: "plan", status: "awaiting" } }), ["hold", "", "", "", ""]);
    assert.deepEqual(ticks({ buildPhase: { phase: "design", awaiting: "plan" } }), ["hold", "", "", "", ""]);
    assert.deepEqual(ticks({ buildPhase: { phase: "build", awaiting: null } }), ["done", "done", "", "", ""]);
    assert.deepEqual(ticks({ buildPhase: { phase: "done", awaiting: null } }), ["done", "done", "done", "done", "done"]);
    assert.equal(ticks({ status: "running", mode: "", step: null }), null, "유지 보수 실행에는 단계 눈금이 없다");
    assert.equal(ticks({ buildPhase: { phase: "plan", awaiting: null } }), null, "아직 기획도 시작하지 않았다");
    assert.equal(ticks({}), null);

    const withTicks = renderProjectList({
        active: "E:/Work/app",
        activeNote: { text: "신규 개발, 개발 단계", tone: "run" },
        activeTicks: ["done", "done", "active", "", ""],
        phases: { "E:/Work/api": { phase: "design", awaiting: "plan", qaRetries: 0 } },
        tabs: [
            { projectDir: "E:/Work/app", name: "app", status: "running", mode: "build", step: "build" },
            { projectDir: "E:/Work/api", name: "api", status: "idle", mode: "", step: "" }
        ]
    });

    const savedModes = renderProjectList({
        active: "E:/Work/app",
        activeNote: { text: "유지 보수", tone: "" },
        tabs: [
            { projectDir: "E:/Work/app", name: "app", status: "idle", savedMode: "maintain" },
            { projectDir: "E:/Work/api", name: "api", status: "idle", savedMode: "build" },
            { projectDir: "E:/Work/web", name: "web", status: "idle", savedMode: "maintain" }
        ]
    });

    assert.match(savedModes, /class="proj-note rail-label">신규 개발</, "다른 프로젝트도 저장된 작업 모드를 처음부터 보인다");
    assert.match(savedModes, /class="proj-note rail-label">유지 보수<\/span>[^]*class="proj-note rail-label">신규 개발<\/span>[^]*class="proj-note rail-label">유지 보수</);

    assert.match(withTicks, /<span class="proj-ticks" aria-hidden="true"><i data-s="done"><\/i><i data-s="done"><\/i><i data-s="active"><\/i><i><\/i><i><\/i><\/span>/);
    assert.match(withTicks, /기획 확인을 기다려요<\/span><span class="proj-ticks" aria-hidden="true"><i data-s="hold"><\/i><i><\/i><i><\/i><i><\/i><i><\/i>/, "다른 프로젝트도 확인 대기를 알린다");
};

// 신규 개발 단계 막대: 단계마다 막대와 라벨, 상태, 막대 아래의 설정 묶음
const checkStepCard = ({ renderStepCard, getReadySteps, getBuildGreeting, getBuildActionLabel }) => {
    const fresh = getReadySteps(null);

    assert.deepEqual(
        fresh.map((cell) => [cell.phase, cell.state]),
        [
            ["plan", "waiting"],
            ["design", "waiting"],
            ["build", "waiting"],
            ["qa", "waiting"],
            ["security", "waiting"]
        ]
    );
    assert.equal(fresh[4].detail, "약점을 찾아 고쳐요");
    assert.deepEqual(
        getReadySteps({ phase: "build", awaiting: null, qaRetries: 0 }).map((cell) => cell.state),
        ["done", "done", "next", "waiting", "waiting"]
    );
    assert.deepEqual(
        getReadySteps({ phase: "design", awaiting: "plan", qaRetries: 0 }).map((cell) => cell.state),
        ["hold", "waiting", "waiting", "waiting", "waiting"],
        "확인을 기다리던 단계는 승인 없이 시작하면 다시 하므로 그 칸이 멈춤이다"
    );
    assert.deepEqual(
        getReadySteps({ phase: "done", awaiting: null, qaRetries: 1 }).map((cell) => cell.state),
        ["done", "done", "done", "done", "done"]
    );

    assert.equal(getBuildActionLabel(null), "기획 시작");
    assert.equal(getBuildActionLabel({ phase: "build", awaiting: "design", qaRetries: 0 }), "디자인 다시 하기");
    assert.equal(getBuildActionLabel({ phase: "qa", awaiting: null, qaRetries: 0 }), "테스트/QA 시작");
    assert.equal(getBuildActionLabel({ phase: "security", awaiting: null, qaRetries: 0, securityRetries: 0 }), "보안검토 시작");
    assert.equal(
        getBuildGreeting({ buildPhase: null, endLabel: "07:00", gates: ["plan"] }).lead,
        "적어 주신 내용으로 기획부터 시작해서 07:00까지 이어 갈게요. 기획 단계가 끝나면 멈추고 확인을 기다려요."
    );
    assert.doesNotMatch(
        getBuildGreeting({ buildPhase: { phase: "build", awaiting: null, qaRetries: 0 }, endLabel: "월요일 07:00", gates: ["plan", "design"] }).lead,
        /멈추고/,
        "지난 단계의 확인받기는 알리지 않는다"
    );
    assert.equal(getBuildGreeting({ buildPhase: { phase: "done", awaiting: null, qaRetries: 0 }, endLabel: "", gates: [] }).title, "모든 단계를 마쳤어요");

    const html = renderStepCard({ id: "steps", cells: getReadySteps({ phase: "design", awaiting: "plan", qaRetries: 0 }), settings: { design: "설정" } });

    assert.match(html, /<div id="steps" class="steps"><ol class="step-card" aria-label="신규 개발 단계">/);
    assert.match(
        html,
        /data-phase="plan" data-state="hold" aria-current="step" title="기획: 확인을 기다려요"><span class="step-seg" aria-hidden="true"><\/span><span class="step-top"><b class="step-label">기획<\/b><span class="step-detail">확인을 기다려요<\/span>/
    );
    assert.match(html, /data-phase="design" data-state="waiting"/);
    assert.equal((html.match(/class="step-seg"/g) ?? []).length, 5, "단계마다 막대가 하나다");
    // 설정은 막대 아래에 준 단계의 묶음으로만 붙는다.
    assert.match(html, /<\/ol><div class="step-settings" role="group" aria-label="단계 설정"><div class="step-group" data-phase="design"><b class="step-group-name">디자인<\/b>설정<\/div><\/div>/);
    assert.equal((html.match(/step-group"/g) ?? []).length, 1, "설정은 준 단계에만 둔다");

    const compact = renderStepCard({ cells: getReadySteps({ phase: "build", awaiting: null, qaRetries: 0 }) });

    assert.match(compact, /<div class="steps"><ol class="step-card"/);
    assert.doesNotMatch(compact, /step-settings/);
    assert.equal((compact.match(/data-state="done"/g) ?? []).length, 2);
};

// Codex 선택 상자: Codex가 알려 준 목록 그대로이고(Codex 설정을 따르는 기본 항목은 없다), 저장된 모델이 목록에 없어도 고른 값은 보인다.
const checkCodexOptions = ({ getCodexModelOptions }) => {
    const models = [
        { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
        { id: "gpt-6-luna", label: "GPT-6-Luna" }
    ];

    assert.deepEqual(
        getCodexModelOptions(models, "gpt-6-luna").map((option) => option.value),
        ["gpt-6.1-sol", "gpt-6-luna"]
    );
    assert.deepEqual(
        getCodexModelOptions([], "gpt-6.1-sol").map((option) => option.value),
        ["gpt-6.1-sol"],
        "목록을 못 읽어도 고른 값은 보인다"
    );
    assert.deepEqual(
        getCodexModelOptions(models, "gpt-9")
            .map((option) => [option.value, option.label])
            .at(-1),
        ["gpt-9", "gpt-9"],
        "목록에 없는 저장값도 그대로 보인다"
    );
};

// 허용 항목: 위험도 순으로 늘어서고, 고른 것 중 가장 높은 위험도를 알려 준다. 보내기가 기대는 설정이 있으면 그 사실도 알린다.
const checkAllowOptions = ({ ALLOW_OPTIONS, ALLOW_RISKS, getAllowRisk, getAllowUsage }, ALLOW_KEYS) => {
    const levels = Object.keys(ALLOW_RISKS);

    assert.deepEqual([...ALLOW_OPTIONS.map((option) => option.key)].sort(), [...ALLOW_KEYS].sort(), "허용 항목은 엔진이 받는 값과 같다");
    assert.deepEqual(
        ALLOW_OPTIONS.map((option) => levels.indexOf(option.risk)),
        [...ALLOW_OPTIONS.map((option) => levels.indexOf(option.risk))].sort(),
        "위험도가 낮은 것부터 늘어선다"
    );
    assert.ok(
        ALLOW_OPTIONS.every((option) => option.desc && option.riskNote && option.keeps),
        "항목마다 설명·위험한 이유·지키는 선이 있다"
    );
    assert.equal(getAllowRisk([]), "");
    assert.equal(getAllowRisk(["large"]), "low");
    assert.equal(getAllowRisk(["large", "deps"]), "mid");
    assert.equal(getAllowRisk(["send", "large"]), "high");
    assert.deepEqual(getAllowUsage("deps", { brainstorm: ["plan"], designFormat: "figma" }), []);
    assert.equal(getAllowUsage("send", { brainstorm: ["plan"], designFormat: "figma" }).length, 2);
    assert.equal(getAllowUsage("send", { brainstorm: [], designFormat: "html" }).length, 0);
};

// 단계 설정 문장의 선택지: 메인(Claude·Codex)과 보조(메인의 반대쪽 AI), 보조가 있는 단계는 늘 멈춘다는 말이 따로 있고, 실패 처리는 횟수와 되돌리지 않음을 고른다.
const checkSentenceOptions = ({ getMainOptions, getAssistOptions, BRAINSTORM_AFTER, GATE_OPTIONS, ON_FAIL_CHOICES, MAX_ON_FAIL_RETRIES, getMaxRetries, toOnFailValue, ON_FAIL_WHEN }) => {
    const missing = { available: false, reason: "Codex 로그인이 필요해요" };

    assert.deepEqual(
        getMainOptions(null).map((option) => [option.value, option.label, option.icon, Boolean(option.disabled)]),
        [
            ["claude", "Claude가 메인", "logo-claude", false],
            ["codex", "Codex가 메인", "logo-openai", false]
        ]
    );
    assert.deepEqual(
        getMainOptions(missing).map((option) => Boolean(option.disabled)),
        [false, true],
        "Codex를 쓸 수 없으면 메인으로 고를 수 없다"
    );
    assert.equal(getMainOptions(missing)[1].hint, "Codex 로그인이 필요해요");

    // 보조는 늘 메인의 반대쪽 AI다. 보조가 없음이면 로고가 없고, Codex가 보조인데 쓸 수 없으면 보조 항목이 잠긴다(Claude 보조는 잠기지 않는다).
    assert.deepEqual(
        getAssistOptions("claude", null).map((option) => [option.value, option.label]),
        [
            ["none", "보조 없이"],
            ["compare", "Codex가 따로 안을 내서"],
            ["debate", "Codex와 협의해서"]
        ]
    );
    assert.deepEqual(
        getAssistOptions("codex", null).map((option) => option.label),
        ["보조 없이", "Claude가 따로 안을 내서", "Claude와 협의해서"]
    );
    assert.equal(getAssistOptions("codex", null)[1].icon, "logo-claude");
    assert.equal(getAssistOptions("claude", null)[0].icon, undefined);
    assert.ok(
        getAssistOptions("claude", missing)
            .slice(1)
            .every((option) => option.disabled)
    );
    assert.ok(getAssistOptions("codex", missing).every((option) => !option.disabled));
    assert.deepEqual(Object.keys(BRAINSTORM_AFTER), ["compare", "debate"], "보조가 없는 단계만 끝난 뒤 멈출지 고른다");
    assert.deepEqual(
        GATE_OPTIONS.map((option) => option.value),
        ["stop", "go"]
    );
    assert.ok(
        [...getMainOptions(null), ...getAssistOptions("claude", null), ...GATE_OPTIONS].every((option) => option.label && option.hint),
        "문장 속 선택은 목록에서 뜻을 풀어 준다"
    );
    // 되돌리는 횟수: 0~최대(엔진 허용 값 stop·retry:1~5)를 횟수로 다루고, 저장 값으로 되돌려도 같아야 한다.
    assert.equal(MAX_ON_FAIL_RETRIES, 5);
    assert.deepEqual([0, 1, 5].map(toOnFailValue), ["stop", "retry:1", "retry:5"]);
    assert.ok(
        ON_FAIL_CHOICES.every((value) => toOnFailValue(getMaxRetries(value)) === value),
        "저장 값 ↔ 횟수가 서로 되돌려진다"
    );
    assert.deepEqual(Object.keys(ON_FAIL_WHEN), ["qa", "security"]);
};

// 단계별 메인과 보조(엔진 phaseUtil과 같은 규칙)와 노력·추론의 다섯 단계.
const checkPhaseAgents = ({ getMain, getAssistant, getOtherProvider, getMainPhases, PHASE_LABELS, LEVEL_INFO, getLevelNames, getLevelValues }) => {
    assert.equal(getMain({}, "plan"), "claude");
    assert.equal(getMain({ plan: "codex" }, "plan"), "codex");
    assert.equal(getMain({ plan: "codex" }, "design"), "claude", "맵에 없는 단계는 Claude다");
    assert.equal(getAssistant({ plan: "codex" }, "plan"), "claude");
    assert.equal(getAssistant({}, "plan"), "codex");
    assert.equal(getOtherProvider("claude"), "codex");
    assert.deepEqual(getMainPhases({ plan: "codex", security: "codex" }, "codex", PHASE_LABELS), ["기획", "보안검토"]);
    assert.deepEqual(getMainPhases({ plan: "codex", security: "codex" }, "claude", PHASE_LABELS), ["디자인", "개발", "테스트/QA"]);

    assert.equal(LEVEL_INFO.length, 5);
    assert.deepEqual(getLevelNames("claude"), ["Low", "Medium", "High", "Extra High", "Max"]);
    assert.deepEqual(getLevelNames("codex"), getLevelNames("claude"));
    assert.deepEqual(getLevelValues("codex"), ["low", "medium", "high", "xhigh", "max"]);
    assert.deepEqual([LEVEL_INFO[2].tags.claude, LEVEL_INFO[2].tags.codex], ["기본값", "기본값"], "가운데(High)가 두 AI 모두의 기본값이다");
    assert.ok(LEVEL_INFO.every((info) => info.desc && info.tags.claude && info.tags.codex));
};

// 실행 중 단계 카드: [단계] 줄이 지금 단계를 정하고, 오기 전에는 시작할 단계가 지금이다. 확인받기로 둔 지난 단계는 "확인함"이다.
// 문장 속 선택 상자는 inline 클래스를 달고, 미끄러지는 스위치는 고른 칸의 순서와 칸 수를 변수로 알린다.
const checkInlineControls = ({ renderSelect, renderSeg, renderStepper, renderEffortSlider }) => {
    const zero = renderStepper({ value: 0, max: 5, onChange: () => {}, ariaLabel: "횟수" });
    const full = renderStepper({ value: 5, max: 5, onChange: () => {}, ariaLabel: "횟수" });

    assert.match(zero, /role="spinbutton"[^>]*aria-label="횟수"[^>]*aria-valuenow="0"/);
    assert.match(zero, /aria-label="줄이기" disabled=""/, "0에서는 줄일 수 없다");
    assert.doesNotMatch(zero, /aria-label="늘리기" disabled/);
    assert.match(full, /aria-label="늘리기" disabled=""/, "최대에서는 늘릴 수 없다");
    assert.match(full, /<output>5<\/output>/);

    const options = [
        { value: "a", label: "가" },
        { value: "b", label: "나" }
    ];

    assert.match(renderSelect({ value: "a", options: options, onChange: () => {}, ariaLabel: "x", inline: true }), /class="select select-inline"/);
    assert.doesNotMatch(renderSelect({ value: "a", options: options, onChange: () => {}, ariaLabel: "x" }), /select-inline/);

    // 로고가 있는 항목은 트리거에도 로고가 보이고, 고를 수 없는 항목은 잠긴다.
    const withIcons = renderSelect({
        value: "a",
        options: [
            { value: "a", label: "가", icon: "logo-claude" },
            { value: "b", label: "나", icon: "logo-openai", disabled: true, hint: "이유" }
        ],
        onChange: () => {},
        ariaLabel: "x"
    });

    assert.match(withIcons, /class="mark logo select-logo"[^>]*><use href="#logo-claude"/);
    assert.match(withIcons, /aria-disabled="true"[^>]*data-icon=""/);
    assert.equal((withIcons.match(/aria-disabled="true"/g) ?? []).length, 1);

    // 노력·추론 슬라이드: 단계 이름과 설명이 칸마다 바뀌고, 잠그면 비활성이다.
    const high = renderEffortSlider({ provider: "claude", level: 2, onChange: () => {} });
    const maxLevel = renderEffortSlider({ provider: "claude", level: 4, onChange: () => {} });
    const locked = renderEffortSlider({ provider: "codex", level: 1, disabled: true, onChange: () => {} });

    assert.match(high, /class="slider" data-provider="claude" data-level="2"/);
    assert.match(high, /aria-label="노력"[^>]*aria-valuetext="High, 기본값"/);
    assert.match(high, /<b>High<\/b>[\s\S]*대부분의 작업에 알맞은 균형이에요/);
    assert.match(maxLevel, /data-level="4"[\s\S]*<b>Max<\/b>[\s\S]*가장 깊게/);
    assert.match(locked, /data-provider="codex" data-level="1" data-off=""/);
    assert.match(locked, /disabled=""[^>]*aria-label="추론"/);
    assert.equal((high.match(/<i><\/i>/g) ?? []).length, 5, "다섯 칸 점");

    const slid = renderSeg({ name: "m", label: "모드", options: options, value: "b", onChange: () => {}, slide: true });

    assert.match(slid, /class="seg seg-slide"/);
    assert.match(slid, /--seg-index:1/);
    assert.match(slid, /--seg-count:2/);
    assert.match(slid, /<i class="seg-thumb"/);
    assert.doesNotMatch(renderSeg({ name: "m", label: "모드", options: options, value: "b", onChange: () => {} }), /seg-thumb/);
};

// 건너뛰는 단계: 시작 단계 · 단계 카드 · 안내 · 단계 문서에 반영되고, 이미 지나간 단계는 건너뛰기로 보이지 않는다. 남은 단계를 모두 건너뛰면 시작할 수 없다.
const checkSkippedSteps = ({ renderStepCard, getBuildStartPhase, getNextPhase, isAllSkipped, getReadySteps, getRunSteps, getPhaseDocs, getBuildGreeting, getBuildActionLabel, hasNoScreens }) => {
    const planDone = { phase: "design", awaiting: null, qaRetries: 0, securityRetries: 0 };
    const getStates = (cells) => cells.map((cell) => `${cell.state}`);

    assert.equal(getBuildStartPhase(planDone, []), "design");
    assert.equal(getBuildStartPhase(planDone, ["design"]), "build");
    assert.equal(getBuildStartPhase({ ...planDone, phase: "qa" }, ["qa", "security"]), "qa", "남은 단계를 모두 건너뛰면 done이 아니라 지금 단계에 머문다");
    assert.equal(getBuildStartPhase({ ...planDone, phase: "done" }, ["qa"]), "done");
    assert.equal(getBuildStartPhase({ ...planDone, awaiting: "plan" }, ["design"]), "plan", "확인을 기다리던 단계는 다시 한다");
    assert.equal(getBuildStartPhase(null, ["design"]), "plan");
    assert(isAllSkipped({ ...planDone, phase: "qa" }, ["qa", "security"]));
    assert(!isAllSkipped({ ...planDone, phase: "qa" }, ["security"]));
    assert(!isAllSkipped({ ...planDone, phase: "done" }, ["qa", "security"]));
    assert(!isAllSkipped(null, ["design", "qa", "security"]));
    assert.equal(getNextPhase("plan", ["design"]), "build");
    assert.equal(getNextPhase("plan", []), "design");
    assert.equal(getNextPhase("design", ["design"]), "build");
    assert.equal(getNextPhase("build", ["qa", "security"]), "done");

    assert.deepEqual(getStates(getReadySteps(null, ["design", "security"])), ["waiting", "skipped", "waiting", "waiting", "skipped"]);
    assert.deepEqual(getStates(getReadySteps(planDone, ["design"])), ["done", "skipped", "next", "waiting", "waiting"]);
    assert.deepEqual(getStates(getReadySteps({ ...planDone, phase: "build" }, ["design"])), ["done", "done", "next", "waiting", "waiting"], "이미 지난 디자인은 건너뛰기로 보이지 않는다");
    assert.deepEqual(getStates(getReadySteps({ ...planDone, awaiting: "plan" }, ["design"])), ["hold", "skipped", "waiting", "waiting", "waiting"]);
    assert.equal(getReadySteps(null, ["qa"])[3].detail, "건너뛰어요");

    assert.match(
        getBuildGreeting({ buildPhase: null, endLabel: "07:00", gates: ["plan", "design"], skip: ["design", "security"] }).lead,
        /기획 단계가 끝나면 멈추고 확인을 기다려요\. 디자인·보안검토 단계는 건너뛰어요\./
    );
    assert.doesNotMatch(getBuildGreeting({ buildPhase: null, endLabel: "07:00", gates: ["plan", "design"], skip: ["design"] }).lead, /디자인 단계가 끝나면/);
    assert.doesNotMatch(getBuildGreeting({ buildPhase: null, endLabel: "07:00", gates: [], skip: [] }).lead, /건너뛰/);
    assert.equal(getBuildActionLabel(planDone, ["design"]), "개발 시작");
    assert.equal(getBuildActionLabel(planDone, []), "디자인 시작");

    const run = { buildPhase: null, gates: [], qaOnFail: "retry:3", securityOnFail: "retry:3", round: 2, skip: ["design", "security"] };
    const cells = getRunSteps({ ...run, step: { phase: "build", status: "running", qaRetries: 0, securityRetries: 0 } });

    assert.deepEqual(getStates(cells), ["done", "skipped", "active", "waiting", "skipped"]);
    assert.equal(cells[1].detail, "건너뛰었어요");
    assert.deepEqual(getStates(getRunSteps({ ...run, step: { phase: "qa", status: "done", qaRetries: 0, securityRetries: 0 } })), ["done", "skipped", "done", "done", "skipped"]);

    assert.deepEqual(
        getPhaseDocs({ step: { phase: "qa", status: "running", qaRetries: 0 }, buildPhase: null, gates: [], designFormat: "html", skip: ["design"] }).map((doc) => doc.path),
        ["docs/autopilot/plan.md", "docs/autopilot/qa.md"]
    );

    // 건너뛴 단계의 칸은 점선 상태로 그리고 이름만 보인다.
    const html = renderStepCard({ cells: getReadySteps(null, ["design"]) });

    assert.match(html, /data-phase="design" data-state="skipped"/);
    assert.match(html, /title="디자인: 건너뛰어요"/);

    // 기획서 5절(화면 목록)이 `화면 없음`으로 시작하면 화면이 없는 프로젝트다.
    assert(hasNoScreens("# 기획\n\n## 4) 기능 목록\n- 변환\n\n## 5) 화면(또는 명령 · API) 목록\n화면 없음\n- `convert` 명령\n\n## 6) 데이터 구조\n"));
    assert(hasNoScreens("## 5. 화면 목록\n\n**화면 없음** (CLI)\n"));
    assert(hasNoScreens("### 5) 화면(또는 명령) 목록\r\n- 화면  없음\r\n"));
    assert(!hasNoScreens("## 5) 화면 목록\n- 로그인 화면\n- 예약 화면\n\n## 8) 이번에 하지 않는 것\n- 화면 없음 모드\n"), "다른 절의 화면 없음은 보지 않는다");
    assert(!hasNoScreens("## 4) 기능 목록\n화면 없음\n"), "5절이 아니면 보지 않는다");
    assert(!hasNoScreens(""));
    assert(!hasNoScreens(null));
};

const checkRunSteps = ({ getRunSteps, getPhaseDocs, getRevisionTasks, renderDocPreview }) => {
    const base = { buildPhase: { phase: "build", awaiting: null, qaRetries: 0, securityRetries: 0 }, gates: ["plan"], qaOnFail: "retry:3", securityOnFail: "retry:2", round: 4 };
    const getCells = (options) => getRunSteps({ ...base, ...options }).map((cell) => `${cell.state}:${cell.detail}`);

    assert.deepEqual(getCells({ step: null }), ["done:확인함", "done:마쳤어요", "active:4회차", "waiting:개발로 최대 3번", "waiting:개발로 최대 2번"]);
    assert.equal(getCells({ step: null, securityOnFail: "stop" })[4], "waiting:심각하면 멈춰요");
    assert.deepEqual(getCells({ step: { phase: "build", status: "running", qaRetries: 1, securityRetries: 0 } })[2], "active:다시 개발 QA 1/3");
    assert.deepEqual(getCells({ step: { phase: "build", status: "running", qaRetries: 1, securityRetries: 2 } })[2], "active:QA 1/3, 보안 2/2");
    assert.deepEqual(getCells({ step: { phase: "design", status: "awaiting", qaRetries: 0 } }).slice(0, 2), ["done:확인함", "hold:확인을 기다려요"]);
    assert.deepEqual(
        getCells({ step: { phase: "qa", status: "done", qaRetries: 1 } }).map((cell) => cell.split(":")[0]),
        ["done", "done", "done", "done", "waiting"]
    );
    assert.deepEqual(getCells({ step: { phase: "security", status: "failed", qaRetries: 0, securityRetries: 2 } })[4], "hold:문제가 남았어요");
    assert.deepEqual(getCells({ step: { phase: "qa", status: "failed", qaRetries: 3 }, qaOnFail: "stop" })[3], "hold:문제가 남았어요");
    assert.equal(getCells({ step: null, buildPhase: null, round: 0 })[0], "active:준비하고 있어요");

    assert.deepEqual(
        getPhaseDocs({ step: { phase: "build", status: "running", qaRetries: 0 }, buildPhase: null, gates: ["plan"], designFormat: "html" }).map((doc) => `${doc.path} ${doc.note}`),
        ["docs/autopilot/plan.md 확인함", "docs/autopilot/design/ 마침"]
    );
    assert.deepEqual(
        getPhaseDocs({ step: { phase: "build", status: "running", qaRetries: 0, securityRetries: 1 }, buildPhase: null, gates: [], designFormat: "md" }).map((doc) => `${doc.path} ${doc.note}`),
        ["docs/autopilot/plan.md 마침", "docs/autopilot/design.md 마침", "docs/autopilot/security.md 고칠 항목"],
        "보안검토가 되돌린 개발은 security.md를 고칠 항목으로 보여준다"
    );
    assert.deepEqual(
        getPhaseDocs({ step: null, buildPhase: null, gates: [], designFormat: "md" }).map((doc) => doc.note),
        ["쓰는 중"]
    );

    assert.equal(getRevisionTasks("  주간 보기 추가 ", "미용실 예약 웹앱\n"), "수정 요청:\n주간 보기 추가\n\n처음 적은 만들 것:\n미용실 예약 웹앱");
    assert.equal(getRevisionTasks("주간 보기", ""), "수정 요청:\n주간 보기");

    // 미리보기는 글자로만 그린다. 문서 속 HTML은 태그가 아니라 글자다.
    const html = renderDocPreview({ doc: { kind: "file", path: "docs/autopilot/plan.md", text: "# 기획\n\n- `plan.md` 보기\n\n<img src=x onerror=alert(1)>\n\n[링크](http://x.y)", isPartial: true } });

    assert.match(html, /<h3[^>]*>기획<\/h3>/);
    assert.match(html, /<li><code>plan\.md<\/code> 보기<\/li>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img|<a[ >]|href/);
    assert.match(html, /<span class="md-link">링크<\/span>/);
    assert.doesNotMatch(html, /doc-fold-all/, "제목이 하나면 접는 칸이 없다");

    // 마크다운: 번호 목록은 번호를, 중첩 목록은 들여쓰기를, 표·인용·체크 목록·굵게·구분선을 그대로 보인다.
    const plan = [
        "# 기획서",
        "",
        "## 1. 범위",
        "",
        "3. **굵은** 항목",
        "   - 중첩 하나",
        "   - 중첩 둘",
        "4. 다음 항목",
        "",
        "> 인용은 따로 그려요",
        "",
        "| 화면 | 설명 |",
        "| :-- | --: |",
        "| 홈 | **첫** 화면 |",
        "",
        "- [x] 끝낸 일",
        "- [ ] 남은 일",
        "",
        "---",
        "",
        "## 2. 화면",
        "",
        "```",
        "| 코드 | 안 |",
        "```"
    ].join("\n");
    const markdown = renderDocPreview({ doc: { kind: "file", path: "docs/autopilot/plan.md", text: plan } });

    assert.match(markdown, /<ol start="3"><li><strong>굵은<\/strong> 항목<ul><li>중첩 하나<\/li><li>중첩 둘<\/li><\/ul><\/li><li>다음 항목<\/li><\/ol>/);
    assert.match(markdown, /<blockquote><p>인용은 따로 그려요<\/p><\/blockquote>/);
    assert.match(markdown, /<th data-align="left">화면<\/th><th data-align="right">설명<\/th>/);
    assert.match(markdown, /<td data-align="left">홈<\/td><td data-align="right"><strong>첫<\/strong> 화면<\/td>/);
    assert.match(markdown, /<li class="md-task"><span class="md-check" role="img" aria-label="완료" data-checked=""><\/span>끝낸 일<\/li>/);
    assert.match(markdown, /<li class="md-task"><span class="md-check" role="img" aria-label="아직"><\/span>남은 일<\/li>/);
    assert.match(markdown, /<hr\/>/);
    assert.match(markdown, /<pre><code>\| 코드 \| 안 \|<\/code><\/pre>/);
    // ## 제목이 둘이라 칸으로 나뉘어 접고 펼 수 있다. 첫 제목 앞의 # 기획서는 머리글이다.
    assert.equal(markdown.match(/class="doc-section"/g).length, 2);
    assert.match(markdown, /<button type="button" class="doc-section-head" aria-expanded="true">/);
    assert.match(markdown, /모두 접기/);
    assert.match(markdown, /<h3[^>]*>기획서<\/h3>/);

    const folder = renderDocPreview({ doc: { kind: "folder", path: "docs/autopilot/design", entries: ["index.html", "screens/"] } });

    assert.match(folder, /docs\/autopilot\/design[^]*<code>index\.html<\/code>[^]*<code>screens\/<\/code>/);
    assert.match(renderDocPreview({ doc: null }), /아직 찾지 못했어요/);
};

// 새 프로젝트의 칩: 넣은 것은 체크·data-picked, 추천은 +이고 눌린 상태를 aria-pressed로 알린다. 더하기 칸은 이름표가 있다.
const checkTagChips = ({ renderTagChips }) => {
    const html = renderTagChips({
        label: "꼭 있어야 할 기능",
        items: [
            { label: "예약", picked: true },
            { label: "알림", picked: false }
        ],
        onToggle: () => {},
        onAdd: () => {},
        addLabel: "기능 추가"
    });

    assert.match(html, /<div class="tags" role="group" aria-label="꼭 있어야 할 기능">/);
    assert.match(html, /data-picked="" aria-pressed="true"><svg[^>]*><use href="#icon-check"><\/use><\/svg>예약<\/button>/);
    assert.match(html, /aria-pressed="false"><svg[^>]*><use href="#icon-plus"><\/use><\/svg>알림<\/button>/);
    assert.match(html, /<input[^>]*placeholder="기능 추가" aria-label="기능 추가"/);
    assert.doesNotMatch(renderTagChips({ label: "어디서", items: [], onToggle: () => {} }), /<input/, "더할 수 없는 묶음에는 입력 칸이 없다");
};

// 지난 실행을 읽는 동안(detail이 null) 로그 열기·삭제를 누르면 없는 기록의 id를 읽다 오류가 나므로 리포트처럼 꺼 둔다.
const checkArchiveDetailButtons = ({ renderDetailPane }) => {
    const getDisabled = (html) => ["archive-report", "archive-log", "archive-delete"].map((id) => new RegExp(`id="${id}" disabled=""`).test(html));

    assert.deepEqual(getDisabled(renderDetailPane({ detail: null, view: null, hidden: false })), [true, true, true], "읽는 중에는 기록 버튼을 모두 끈다");
    assert.deepEqual(getDisabled(renderDetailPane({ detail: { run: { id: "r1", hasReport: true } }, view: null, hidden: false })), [false, false, false]);
    assert.deepEqual(getDisabled(renderDetailPane({ detail: { run: { id: "r1", hasReport: true, isUnreadable: true, isActive: true } }, view: null, hidden: false })), [false, true, true]);
};

const checkUi = async () => {
    const ui = await loadUi();

    checkKeys(ui);
    checkSelectMarkup(ui);
    checkModalMarkup(ui);
    checkProjectListMarkup(ui);
    checkStepCard(ui);
    checkCodexOptions(ui);
    checkAllowOptions(ui, ui.ALLOW_KEYS);
    checkSentenceOptions(ui);
    checkPhaseAgents(ui);
    checkInlineControls(ui);
    checkRunSteps(ui);
    checkSkippedSteps(ui);
    checkTagChips(ui);
    checkArchiveDetailButtons(ui);
    checkModalClosingLayout();

    console.log("Desktop UI checks passed.");
};

await checkUi();
