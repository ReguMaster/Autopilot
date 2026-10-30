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
        import { Modal } from "./components/Modal.jsx";
        import { ProjectList } from "./features/shell/Rail.jsx";
        import { StepCard } from "./features/steps/StepCard.jsx";
        export * from "./selectKeys.js";
        export * from "./lib/buildSteps.js";
        export const renderSelect = (props) => renderToStaticMarkup(createElement(Select, props));
        export const renderModal = (props, children) => renderToStaticMarkup(createElement(Modal, props, children));
        export const renderProjectList = (props) => renderToStaticMarkup(createElement(ProjectList, props));
        export const renderStepCard = (props) => renderToStaticMarkup(createElement(StepCard, props));
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

// 레일의 프로젝트 목록: 보는 프로젝트만 탭 순서에 들고 자세한 상태 줄을 보이며, 실행 중인 프로젝트는 도는 고리가 있고 닫을 수 없다.
const checkProjectListMarkup = ({ renderProjectList }) => {
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
    assert.equal((html.match(/class="ring"/g) ?? []).length, 1, "실행 중인 프로젝트에만 도는 고리가 있다");
    assert.match(html, /class="proj-name rail-label">Work\/app</, "폴더 이름이 같으면 상위 폴더까지 보인다");
    assert.match(html, /class="proj-name rail-label">Personal\/app</);
    assert.match(html, /data-tone="warn"[^]*class="proj-note rail-label">기획 확인을 기다려요</, "보는 프로젝트는 받은 상태 줄을 보인다");
    assert.match(html, /class="proj-note rail-label">실행 중</);
    assert.match(html, /aria-label="Personal\/app 닫기"[^>]*disabled/, "실행 중인 프로젝트는 닫기 버튼이 잠긴다");
    assert.equal((html.match(/disabled/g) ?? []).length, 1);
    assert.match(html, /title="E:\/Work\/app"/, "마우스를 올리면 전체 경로가 보인다");
};

// 신규 개발 단계 카드: 칸의 상태와 번호·체크·멈춤, 마친 비율의 막대, 펼친 카드의 설정
const checkStepCard = ({ renderStepCard, getReadySteps, getBuildGreeting, getBuildActionLabel }) => {
    const fresh = getReadySteps(null);

    assert.deepEqual(
        fresh.map((cell) => cell.state),
        ["waiting", "waiting", "waiting", "waiting"]
    );
    assert.deepEqual(
        getReadySteps({ phase: "build", awaiting: null, qaRetries: 0 }).map((cell) => cell.state),
        ["done", "done", "next", "waiting"]
    );
    assert.deepEqual(
        getReadySteps({ phase: "design", awaiting: "plan", qaRetries: 0 }).map((cell) => cell.state),
        ["hold", "waiting", "waiting", "waiting"],
        "확인을 기다리던 단계는 승인 없이 시작하면 다시 하므로 그 칸이 멈춤이다"
    );
    assert.deepEqual(
        getReadySteps({ phase: "done", awaiting: null, qaRetries: 1 }).map((cell) => cell.state),
        ["done", "done", "done", "done"]
    );

    assert.equal(getBuildActionLabel(null), "기획 시작");
    assert.equal(getBuildActionLabel({ phase: "build", awaiting: "design", qaRetries: 0 }), "디자인 다시 하기");
    assert.equal(getBuildActionLabel({ phase: "qa", awaiting: null, qaRetries: 0 }), "테스트/QA 시작");
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

    assert.match(html, /class="step-card expanded"/);
    assert.match(html, /--step-progress:0%/);
    assert.match(html, /data-phase="plan" data-state="hold" aria-current="step"[^]*href="#icon-pause"[^]*확인을 기다려요/);
    assert.match(html, /data-phase="design"[^]*<span class="step-node" aria-hidden="true">2<\/span>[^]*<div class="step-set">설정<\/div>/);
    assert.equal((html.match(/step-set/g) ?? []).length, 1, "설정은 준 단계에만 펼친다");

    const compact = renderStepCard({ cells: getReadySteps({ phase: "build", awaiting: null, qaRetries: 0 }) });

    assert.match(compact, /class="step-card"/);
    assert.match(compact, /--step-progress:50%/);
    assert.equal((compact.match(/href="#icon-check"/g) ?? []).length, 2);
};

const checkUi = async () => {
    const ui = await loadUi();

    checkKeys(ui);
    checkSelectMarkup(ui);
    checkModalMarkup(ui);
    checkProjectListMarkup(ui);
    checkStepCard(ui);
    checkModalClosingLayout();

    console.log("Desktop UI checks passed.");
};

await checkUi();
