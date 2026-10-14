// Electron으로 실행한다: electron tests/tools/ui/runScenes.cjs -- --root <저장소 폴더> --page <html> --out <폴더> [--scenes a,b] [--reduced]
// 장면마다 화면을 새로 띄워 가짜 preload로 데이터를 흘리고, 진짜 마우스·키보드 입력을 보내고, 영역별로 PNG와 정규화한 DOM을 저장한다.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const readArgument = (name, fallback = "") => {
    const index = process.argv.indexOf(`--${name}`);

    return index >= 0 ? process.argv[index + 1] : fallback;
};

const ROOT = readArgument("root");
const PAGE = readArgument("page", "index.html");
const OUT = readArgument("out");
const ONLY = readArgument("scenes") ? readArgument("scenes").split(",") : null;
const IS_REDUCED = process.argv.includes("--reduced");
const DEFAULT_SIZE = [600, 800];

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

if (IS_REDUCED) {
    app.commandLine.appendSwitch("force-prefers-reduced-motion");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 화면 쪽 도우미: 정규화한 DOM 문자열, 끝나지 않은 애니메이션 수
const PAGE_HELPERS = `(() => {
    // 애니메이션을 다시 거는 클래스와 값이 빈 속성은 상태가 아니라 흔적이라 비교에서 뺀다. 숨은 요소의 안쪽도 보이지 않으므로 뺀다.
    const REPLAY_CLASSES = ["swap", "appear", "tick-up", "tick-down", "tick-up", "model-swap", "effort-swap"];
    const EMPTY_IGNORED = ["class", "data-tone", "data-length", "title"];

    // 입력 값은 속성이 아니라 프로퍼티로 다뤄지고, 숨은 입력·datalist는 새 화면에 없다. 값이 아닌 모양만 비교한다.
    const IGNORED_ATTRIBUTES = ["checked", "data-default", "value"];
    const SKIPPED_SELECTOR = "datalist, input[type=hidden], input[hidden]";

    const norm = (node) => {
        if (node.nodeType === 3) {
            return node.data.replace(/\\s+/g, " ").trim();
        }

        if (node.nodeType !== 1 || node.tagName === "SCRIPT" || node.matches(SKIPPED_SELECTOR)) {
            return "";
        }

        if (node.hasAttribute("hidden")) {
            return "<" + node.tagName.toLowerCase() + " hidden></" + node.tagName.toLowerCase() + ">";
        }

        const attrs = [...node.attributes]
            .map((attr) => (attr.name === "class" ? { name: attr.name, value: attr.value.split(/\\s+/).filter((token) => token && !REPLAY_CLASSES.includes(token)).join(" ") } : attr))
            .filter((attr) => attr.name !== "style" && !(attr.value === "" && EMPTY_IGNORED.includes(attr.name)) && !(attr.name === "id" && node.tagName === "use") && !IGNORED_ATTRIBUTES.includes(attr.name))
            .map((attr) => attr.name + "=" + JSON.stringify(attr.value))
            .sort()
            .join(" ");
        const name = node.tagName.toLowerCase();
        const children = node.tagName === "TEXTAREA" ? "" : [...node.childNodes].map(norm).join("");

        return "<" + name + (attrs ? " " + attrs : "") + ">" + children + "</" + name + ">";
    };

    window.__norm = (selector) => {
        const node = document.querySelector(selector);

        return node ? norm(node) : "(없음)";
    };
    window.__pending = () => {
        const running = document.getAnimations().filter((animation) => animation.effect && animation.effect.getComputedTiming().endTime !== Infinity && animation.playState !== "finished");

        return running.length + document.querySelectorAll('[style*="mask"]').length;
    };
    window.__freeze = () => {
        document.getAnimations().filter((animation) => animation.effect && animation.effect.getComputedTiming().endTime === Infinity).forEach((animation) => animation.cancel());
    };
    window.__rect = (selector) => {
        const node = document.querySelector(selector);

        if (!node) {
            return null;
        }

        const rect = node.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
})()`;

const createTools = (win, scene, sceneDir, report) => {
    const evaluate = (code) => win.webContents.executeJavaScript(code);

    const tools = {
        eval: evaluate,
        wait: wait,
        drive: (name, ...args) => evaluate(`window.__drive.${name}(...${JSON.stringify(args)})`),
        state: (patch) => tools.drive("state", patch),
        log: (lines) => tools.drive("log", lines),
        calls: () => evaluate("window.__calls"),
        clearCalls: () => evaluate("window.__calls.length = 0"),
        settle: async (maxMs = 15000) => {
            const started = Date.now();
            let calm = 0;

            while (calm < 3 && Date.now() - started < maxMs) {
                calm = (await evaluate("window.__pending()")) === 0 ? calm + 1 : 0;
                await wait(100);
            }

            return Date.now() - started;
        },
        rect: (selector) => evaluate(`window.__rect(${JSON.stringify(selector)})`),
        point: async (selector) => {
            const rect = await tools.rect(selector);

            if (!rect) {
                throw new Error(`요소를 찾을 수 없어요: ${selector}`);
            }

            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        },
        hover: async (selector) => {
            const { x, y } = await tools.point(selector);

            win.webContents.sendInputEvent({ type: "mouseMove", x: x, y: y });
            await wait(150);
        },
        click: async (selector) => {
            await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "nearest" })`);
            await wait(60);

            const { x, y } = await tools.point(selector);

            win.webContents.sendInputEvent({ type: "mouseMove", x: x, y: y });
            win.webContents.sendInputEvent({ type: "mouseDown", x: x, y: y, button: "left", clickCount: 1 });
            win.webContents.sendInputEvent({ type: "mouseUp", x: x, y: y, button: "left", clickCount: 1 });
            await wait(120);
        },
        press: async (keyCode) => {
            const chars = { Return: "\r", Space: " " };

            win.webContents.sendInputEvent({ type: "keyDown", keyCode: keyCode });

            if (keyCode.length === 1 || chars[keyCode]) {
                win.webContents.sendInputEvent({ type: "char", keyCode: chars[keyCode] || keyCode.toLowerCase() });
            }

            win.webContents.sendInputEvent({ type: "keyUp", keyCode: keyCode });
            await wait(100);
        },
        type: async (text) => {
            for (const char of text) {
                win.webContents.sendInputEvent({ type: "keyDown", keyCode: char });
                win.webContents.sendInputEvent({ type: "char", keyCode: char });
                win.webContents.sendInputEvent({ type: "keyUp", keyCode: char });
            }

            await wait(100);
        },
        focus: (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`),
        // 레이아웃이 자리 잡은 뒤에도 같은 위치에 있도록 두 번 맞춘다.
        scrollTo: async (selector, top) => {
            for (let attempt = 0; attempt < 2; attempt++) {
                await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.scrollTop = ${top}; })()`);
                await wait(200);
            }
        },
        resize: async (width, height) => {
            win.setContentSize(width, height);
            await wait(300);
        },
        // 영역의 PNG(없으면 화면 전체)와 정규화한 DOM을 저장한다. 끝없이 도는 애니메이션은 멈춰 같은 프레임으로 찍는다.
        shot: async (name, selector = "", options = {}) => {
            await tools.settle();
            await evaluate("window.__freeze()");

            // 그려 온 이력에 따라 글자의 안티앨리어싱이 달라지므로, 찍기 전에 화면 전체를 다시 그리게 한다.
            win.webContents.invalidate();
            await wait(150);

            const rect = selector ? await tools.rect(selector) : null;
            const isEmpty = selector && (!rect || rect.width < 1 || rect.height < 1);
            const bounds = rect ? { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) } : undefined;

            fs.mkdirSync(sceneDir, { recursive: true });

            // 숨겨져 크기가 없는 요소는 찍을 화면이 없다. DOM만 남긴다.
            if (!isEmpty) {
                if (options.tolerant) {
                    fs.writeFileSync(path.join(sceneDir, `${name}.tolerant`), "");
                }

                const image = bounds ? await win.webContents.capturePage(bounds) : await win.webContents.capturePage();

                fs.writeFileSync(path.join(sceneDir, `${name}.png`), image.toPNG());
            }

            if (selector && !options.skipDom) {
                fs.writeFileSync(path.join(sceneDir, `${name}.dom.txt`), await evaluate(`window.__norm(${JSON.stringify(selector)})`));
            }
        },
        dom: async (name, selector) => {
            fs.mkdirSync(sceneDir, { recursive: true });
            fs.writeFileSync(path.join(sceneDir, `${name}.dom.txt`), await evaluate(`window.__norm(${JSON.stringify(selector)})`));
        },
        note: (key, value) => {
            report[scene.name] = { ...report[scene.name], [key]: value };
        }
    };

    return tools;
};

const runScene = async (scene, report) => {
    const sceneDir = path.join(OUT, scene.name);
    const initFile = path.join(os.tmpdir(), `ap-fake-init-${process.pid}-${scene.name}.json`);
    const [width, height] = scene.size || DEFAULT_SIZE;
    const consoleLines = [];

    fs.writeFileSync(initFile, JSON.stringify({ root: ROOT.replace(/\\/g, "/"), ...scene.init }));

    const win = new BrowserWindow({
        width: width,
        height: height,
        useContentSize: true,
        show: false,
        webPreferences: {
            offscreen: true,
            preload: path.join(__dirname, "fakePreload.cjs"),
            additionalArguments: [`--ap-fake-init=${initFile}`],
            contextIsolation: false,
            sandbox: false
        }
    });

    win.webContents.setFrameRate(30);
    win.webContents.on("console-message", (...args) => {
        const detail = args[0] && args[0].message ? args[0] : { level: args[1], message: args[2] };

        if (detail.message && !String(detail.message).includes("Download the React DevTools")) {
            consoleLines.push(String(detail.message).slice(0, 300));
        }
    });

    try {
        await win.loadFile(path.join(ROOT, "desktop", PAGE));
        await win.webContents.executeJavaScript(PAGE_HELPERS);
        await wait(1200);
        await scene.run(createTools(win, scene, sceneDir, report));
    } catch (error) {
        report[scene.name] = { ...report[scene.name], error: String(error.message || error) };
    }

    report[scene.name] = { ...report[scene.name], console: consoleLines };
    win.destroy();
    fs.rmSync(initFile, { force: true });
};

const main = async () => {
    const { SCENES } = require("./scenes/index.cjs");
    const report = {};

    fs.mkdirSync(OUT, { recursive: true });

    for (const scene of SCENES) {
        if (!ONLY || ONLY.includes(scene.name)) {
            await runScene(scene, report);
        }
    }

    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(`장면 ${Object.keys(report).length}개 완료: ${OUT}`);
    app.exit(0);
};

setTimeout(
    () => {
        console.log("장면 실행이 너무 오래 걸려 중단했어요.");
        app.exit(2);
    },
    Number(readArgument("timeout", "900000"))
);

app.whenReady().then(() =>
    main().catch((error) => {
        console.log("실행 오류", error);
        app.exit(1);
    })
);
