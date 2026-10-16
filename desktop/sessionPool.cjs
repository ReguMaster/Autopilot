// 프로젝트마다 하나씩 갖는 실행 세션(러너와 시작·재연결 진행 여부)을 보관한다. Electron에 의존하지 않아 단독으로 검증한다.
// getKey는 같은 프로젝트를 같은 키로 만드는 함수(경로 표기가 달라도 하나), getActiveDir은 지금 활성인 프로젝트다.
const createSessionPool = ({ getKey, getActiveDir, createSession }) => {
    const sessions = new Map();

    const open = (projectDir) => {
        const key = getKey(projectDir);

        if (!sessions.has(key)) {
            sessions.set(key, createSession(projectDir));
        }

        return sessions.get(key);
    };

    // 열려 있는 프로젝트의 세션. 생략하면 활성 프로젝트이고, 렌더러가 보낸 경로가 열려 있지 않으면 null이다(임의 경로를 받지 않는다).
    const get = (requestedDir) => {
        const activeDir = getActiveDir();
        const projectDir = typeof requestedDir === "string" && requestedDir ? requestedDir : activeDir;

        if (sessions.has(getKey(projectDir)) || getKey(projectDir) === getKey(activeDir)) {
            return open(projectDir);
        }

        return null;
    };

    const getAll = () => [...sessions.values()];

    return { open: open, get: get, getAll: getAll };
};

module.exports = { createSessionPool };
