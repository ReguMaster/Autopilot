const REVEAL_FEATHER_PX = 96;
const REVEAL_SPEED = 0.36;

// 지금 문장을 줄 순서대로 부드러운 마스크로 쓸어 드러낸다. 글자 위치는 그대로라 움직임 줄이기 설정에서도 쓴다.
// 끝나거나 stop을 부르면 마스크를 걷고 done을 푼다. React가 그리는 요소의 inline mask만 건드리므로 style prop을 두지 않는다.
const startReveal = (line) => {
    const box = line.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(line).lineHeight);
    const range = document.createRange();
    const widths = [];
    let resolveDone = () => {};
    let isStopped = false;
    let frame = 0;
    let startedAt = 0;
    const done = new Promise((resolve) => {
        resolveDone = resolve;
    });

    range.selectNodeContents(line);

    for (const rect of range.getClientRects()) {
        if (rect.width > 0) {
            const index = Math.floor((rect.top + rect.height / 2 - box.top) / lineHeight);

            widths[index] = Math.max(widths[index] || 0, rect.right - box.left);
        }
    }

    const lines = Array.from(widths, (width, index) => ({ top: index * lineHeight, width: (width || 0) + REVEAL_FEATHER_PX }));
    const total = lines.reduce((sum, item) => sum + item.width, 0);

    const finish = () => {
        isStopped = true;
        line.style.removeProperty("mask");
        resolveDone();
    };

    const paint = (now) => {
        if (isStopped) {
            return;
        }

        startedAt = startedAt || now;

        let travelled = (now - startedAt) * REVEAL_SPEED;
        const layers = lines.map((item) => {
            const edge = Math.min(travelled, item.width);

            travelled -= edge;

            return `linear-gradient(90deg, #000 ${edge - REVEAL_FEATHER_PX}px, rgb(0 0 0 / 0.35) ${edge - REVEAL_FEATHER_PX / 2}px, transparent ${edge}px) 0 ${item.top}px / 100% ${lineHeight}px no-repeat`;
        });

        if ((now - startedAt) * REVEAL_SPEED >= total) {
            finish();

            return;
        }

        line.style.setProperty("mask", layers.join(", "));
        frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);

    return {
        done: done,
        stop: () => {
            if (!isStopped) {
                cancelAnimationFrame(frame);
                finish();
            }
        }
    };
};

export { startReveal };
