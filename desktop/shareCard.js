// 성과 카드 페이지. 메인 프로세스가 window.renderCard({ sentence, strong, facts })를 불러 내용을 채운다.
const SENTENCE_SIZES = [70, 62, 54, 48, 42, 36];
const MAX_SENTENCE_HEIGHT = 330;
const UNDERLINE_GAP = 6;

// 문장이 길면 글자 크기를 낮춰 사실 줄과 겹치지 않는 높이 안에 넣는다.
const fitSentence = (sentence) => {
    for (const size of SENTENCE_SIZES) {
        sentence.style.setProperty("font-size", `${size}px`);

        if (sentence.offsetHeight <= MAX_SENTENCE_HEIGHT) {
            return;
        }
    }
};

// 밑줄은 문장의 마지막 줄 아래에 긋는다. 줄바꿈은 브라우저가 정하므로 글자 상자들의 위치를 재서 마지막 줄을 찾는다.
const placeUnderline = (sentence, underline) => {
    const range = document.createRange();

    range.selectNodeContents(sentence);

    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);

    if (!rects.length) {
        underline.toggleAttribute("hidden", true);

        return;
    }

    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const lastLine = rects.filter((rect) => bottom - rect.bottom < 4);
    const left = Math.min(...lastLine.map((rect) => rect.left));
    const right = Math.max(...lastLine.map((rect) => rect.right));

    underline.style.setProperty("left", `${left - 4}px`);
    underline.style.setProperty("top", `${bottom + UNDERLINE_GAP}px`);
    underline.style.setProperty("width", `${right - left + 10}px`);
    underline.toggleAttribute("hidden", false);
};

window.renderCard = async ({ sentence, strong, facts }) => {
    const sentenceElement = document.getElementById("sentence");

    document.getElementById("sentence-before").textContent = sentence && strong ? `${sentence} ` : sentence;
    document.getElementById("sentence-strong").textContent = strong;
    document.getElementById("facts").textContent = facts.join("\n");

    await document.fonts.ready;

    fitSentence(sentenceElement);
    placeUnderline(sentenceElement, document.getElementById("underline"));

    return true;
};
