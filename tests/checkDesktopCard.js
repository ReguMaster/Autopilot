import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sanitizeCardContent, getCardFileName } = require("../desktop/shareCard.cjs");

const checkSanitize = () => {
    assert.deepEqual(sanitizeCardContent({ sentence: "자는 동안  테스트를\n채웠어요", strong: "뒀어요.", facts: ["어젯밤 23:10 ~ 07:00, mireu-api", "커밋 14개"] }), {
        sentence: "자는 동안 테스트를 채웠어요",
        strong: "뒀어요.",
        facts: ["어젯밤 23:10 ~ 07:00, mireu-api", "커밋 14개"]
    });

    // 제어 문자는 공백이 되고, 길이는 잘리며, 사실 줄은 둘까지만 받는다.
    const long = sanitizeCardContent({ sentence: "가".repeat(500), strong: "", facts: ["a\u0000b", "", "  c  ", "d"] });

    assert.equal(long.sentence.length, 120);
    assert.deepEqual(long.facts, ["a b", "c"]);
    assert.deepEqual(sanitizeCardContent({ sentence: "", strong: "완료했어요.", facts: "x" }), { sentence: "", strong: "완료했어요.", facts: [] });

    // 그릴 문장이 없거나 모양이 틀리면 거부한다.
    for (const broken of [null, undefined, "x", 5, {}, { sentence: " ", strong: "\n" }, { sentence: 3, strong: {} }]) {
        assert.equal(sanitizeCardContent(broken), null, JSON.stringify(broken));
    }
};

const checkFileName = () => {
    const day = new Date(2026, 9, 14, 7, 0).getTime();

    assert.equal(getCardFileName("mireu-api", day), "AutoPilot-mireu-api-2026-10-14.png");
    assert.equal(getCardFileName("정산 서버", day), "AutoPilot-정산-서버-2026-10-14.png");
    assert.equal(getCardFileName("", day), "AutoPilot-2026-10-14.png");
    assert.equal(getCardFileName(undefined, day), "AutoPilot-2026-10-14.png");

    // 경로 구분자와 파일 이름에 못 쓰는 글자는 남지 않는다.
    const unsafe = getCardFileName('..\\evil/:*?"<>|name', day);

    assert.doesNotMatch(unsafe, /[\\/:*?"<>|]/);
    assert(unsafe.endsWith("-2026-10-14.png"));
};

checkSanitize();
checkFileName();

console.log("Desktop card checks passed.");
