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
        export * from "./selectKeys.js";
        export const renderSelect = (props) => renderToStaticMarkup(createElement(Select, props));
        export const renderModal = (props, children) => renderToStaticMarkup(createElement(Modal, props, children));
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

const checkUi = async () => {
    const ui = await loadUi();

    checkKeys(ui);
    checkSelectMarkup(ui);
    checkModalMarkup(ui);
    checkModalClosingLayout();

    console.log("Desktop UI checks passed.");
};

await checkUi();
