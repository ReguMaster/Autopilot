// 프로젝트마다 하나씩 갖는 실행 세션(러너와 시작·재연결 진행 여부)을 보관한다. Electron에 의존하지 않아 단독으로 검증한다.
// getKey는 같은 프로젝트를 같은 키로 만드는 함수(경로 표기가 달라도 하나), getActiveDir은 지금 활성인 프로젝트, getOpenDirs는 열려 있는 탭의 프로젝트들이다.
const createSessionPool = ({ getKey, getActiveDir, getOpenDirs = () => [], createSession }) => {
    const sessions = new Map();

    const open = (projectDir) => {
        const key = getKey(projectDir);

        if (!sessions.has(key)) {
            sessions.set(key, createSession(projectDir));
        }

        return sessions.get(key);
    };

    // 열려 있는 프로젝트(활성이거나 열린 탭)의 세션. 생략하면 활성 프로젝트이고, 열려 있지 않은 경로는 null이다(렌더러가 보낸 임의 경로를 받지 않는다).
    // 세션은 처음 요청될 때 만들고 경로 표기는 탭에 저장된 것을 쓴다.
    const get = (requestedDir) => {
        const activeDir = getActiveDir();
        const projectDir = typeof requestedDir === "string" && requestedDir ? requestedDir : activeDir;
        const key = getKey(projectDir);

        if (sessions.has(key)) {
            return sessions.get(key);
        }

        const openDir = [activeDir, ...getOpenDirs()].find((dir) => getKey(dir) === key);

        return openDir === undefined ? null : open(openDir);
    };

    const getAll = () => [...sessions.values()];

    // 탭을 닫을 때 그 프로젝트의 세션을 버린다. 실행 중인 세션은 호출한 쪽이 먼저 막는다.
    const close = (projectDir) => sessions.delete(getKey(projectDir));

    return { open: open, get: get, getAll: getAll, close: close };
};

module.exports = { createSessionPool };
