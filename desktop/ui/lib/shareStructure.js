const isContainer = (value) => {
    return value !== null && typeof value === "object" && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
};

// 새 값에서 이전 값과 같은 부분은 이전 참조를 그대로 쓴다. IPC로 상태가 올 때마다 객체가 새로 만들어지므로,
// 이렇게 해 두면 바뀌지 않은 회차·성과 같은 조각을 보는 컴포넌트는 다시 그려지지 않는다.
const shareStructure = (previous, next) => {
    if (previous === next) {
        return previous;
    }

    if (!isContainer(previous) || !isContainer(next) || Array.isArray(previous) !== Array.isArray(next)) {
        return next;
    }

    if (Array.isArray(next)) {
        const items = next.map((item, index) => shareStructure(previous[index], item));

        return items.length === previous.length && items.every((item, index) => item === previous[index]) ? previous : items;
    }

    const keys = Object.keys(next);
    const shared = {};
    let isSame = keys.length === Object.keys(previous).length;

    for (const key of keys) {
        shared[key] = shareStructure(previous[key], next[key]);

        if (shared[key] !== previous[key]) {
            isSame = false;
        }
    }

    return isSame ? previous : shared;
};

export { shareStructure };
