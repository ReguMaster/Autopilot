const PAGE_STEP = 8;
const TYPEAHEAD_RESET_MS = 600;

// 열린 목록에서 키로 옮길 위치. 옮기는 키가 아니면 null이다.
const getNextIndex = (key, index, count) => {
    if (count === 0) {
        return null;
    }

    const moves = {
        ArrowDown: Math.min(index + 1, count - 1),
        ArrowUp: Math.max(index - 1, 0),
        PageDown: Math.min(index + PAGE_STEP, count - 1),
        PageUp: Math.max(index - PAGE_STEP, 0),
        Home: 0,
        End: count - 1
    };

    return moves[key] ?? null;
};

// 글자를 이어 치면 그 접두어로, 같은 글자를 반복하면 그 글자로 시작하는 항목을 차례로 돈다. 없으면 -1이다.
const findByTypeahead = (labels, text, fromIndex) => {
    const query = text.toLowerCase();
    const isRepeat = query.length > 1 && [...query].every((char) => char === query[0]);
    const needle = isRepeat ? query[0] : query;
    const startOffset = needle.length === 1 ? 1 : 0;

    for (let step = 0; step < labels.length; step++) {
        const index = (fromIndex + startOffset + step + labels.length) % labels.length;

        if (labels[index].toLowerCase().startsWith(needle)) {
            return index;
        }
    }

    return -1;
};

export { getNextIndex, findByTypeahead, TYPEAHEAD_RESET_MS };
