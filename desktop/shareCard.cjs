const path = require("node:path");

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const MAX_SENTENCE_LENGTH = 120;
const MAX_FACT_LENGTH = 80;
const MAX_FACT_COUNT = 2;
const RENDER_TIMEOUT_MS = 15000;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/g;
const FILE_NAME_UNSAFE_PATTERN = /[^\w가-힣.-]+/g;

const cleanText = (value, maxLength) => {
    return typeof value === "string" ? value.replace(CONTROL_PATTERN, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
};

// 렌더러가 보낸 값은 글자와 길이만 믿는다. 문장이 비어 있으면 그릴 것이 없으므로 null이다.
const sanitizeCardContent = (raw) => {
    const sentence = cleanText(raw?.sentence, MAX_SENTENCE_LENGTH);
    const strong = cleanText(raw?.strong, MAX_SENTENCE_LENGTH);
    const facts = (Array.isArray(raw?.facts) ? raw.facts : [])
        .map((fact) => cleanText(fact, MAX_FACT_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_FACT_COUNT);

    return sentence || strong ? { sentence: sentence, strong: strong, facts: facts } : null;
};

// 저장 대화상자의 기본 파일 이름. 프로젝트 이름에서 파일 이름에 못 쓰는 글자는 뺀다.
const getCardFileName = (projectName, nowMs) => {
    const date = new Date(nowMs);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const name = cleanText(projectName, 40)
        .replace(FILE_NAME_UNSAFE_PATTERN, "-")
        .replace(/^-+|-+$/g, "");

    return `AutoPilot-${name ? `${name}-` : ""}${day}.png`;
};

// 숨겨 둔 창에 카드 페이지를 그려 PNG로 찍는다. 창은 화면에 나타나지 않고 끝나면 닫는다.
const renderCardPng = async (content) => {
    const { BrowserWindow } = require("electron");
    const window = new BrowserWindow({
        show: false,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        useContentSize: true,
        frame: false,
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, devTools: false }
    });
    const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error("카드를 그리는 데 너무 오래 걸렸어요.")), RENDER_TIMEOUT_MS).unref());

    try {
        const draw = async () => {
            await window.loadFile(path.join(__dirname, "shareCard.html"));

            await window.webContents.executeJavaScript(`window.renderCard(${JSON.stringify(content)})`);

            // 그린 결과가 화면에 반영될 시간을 준다.
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 창 가장자리 때문에 몇 픽셀 더 크게 찍히는 환경이 있어 카드 크기로 자른다.
            return (await window.webContents.capturePage()).crop({ x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT }).toPNG();
        };

        return await Promise.race([draw(), timeout]);
    } finally {
        if (!window.isDestroyed()) {
            window.destroy();
        }
    }
};

// 스모크 테스트용: 숨긴 창에 카드를 그려 정해진 크기의 PNG가 나오는지 본다.
const checkCardRender = async () => {
    try {
        const png = await renderCardPng({ sentence: "자는 동안 테스트가 비어 있던 경로를", strong: "채워 뒀어요.", facts: ["어젯밤 23:10 ~ 07:00, mireu-api", "커밋 14개, +1,284줄 -312줄"] });
        const { width, height } = require("electron").nativeImage.createFromBuffer(png).getSize();

        return width === CARD_WIDTH && height === CARD_HEIGHT;
    } catch {
        return false;
    }
};

module.exports = { sanitizeCardContent, getCardFileName, renderCardPng, checkCardRender, CARD_WIDTH, CARD_HEIGHT };
