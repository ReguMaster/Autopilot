import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSessionPool } = require("../desktop/sessionPool.cjs");
const { getProjectKey } = require("../desktop/settingsStore.cjs");

const createPool = (initialDir) => {
    const context = { activeDir: initialDir, created: [] };

    context.pool = createSessionPool({
        getKey: (projectDir) => (projectDir ? getProjectKey(projectDir) : ""),
        getActiveDir: () => context.activeDir,
        createSession: (projectDir) => {
            context.created.push(projectDir);

            return { projectDir: projectDir };
        }
    });

    return context;
};

const createProject = () => fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-session-"));

// 생략하거나 활성 프로젝트를 요청하면 세션을 한 번만 만들고, 열려 있지 않은 프로젝트는 받지 않는다.
const checkActiveSession = () => {
    const projectA = createProject();
    const projectB = createProject();

    try {
        const context = createPool(projectA);
        const { pool } = context;
        const session = pool.get();

        assert.equal(session.projectDir, projectA);
        assert.equal(pool.get(), session, "같은 프로젝트는 같은 세션");
        assert.equal(pool.get(projectA), session);
        assert.equal(pool.get(""), session, "빈 경로는 생략과 같다");
        assert.equal(pool.get({ type: "focus" }), session, "문자열이 아닌 값(이벤트 객체 등)은 생략과 같다");
        assert.equal(context.created.length, 1);

        assert.equal(pool.get(projectB), null, "열린 적 없는 프로젝트는 렌더러가 보내도 세션을 만들지 않는다");
        assert.equal(pool.get(path.join(projectA, "..", "nowhere")), null);
        assert.equal(pool.getAll().length, 1);
    } finally {
        fs.rmSync(projectA, { recursive: true, force: true });
        fs.rmSync(projectB, { recursive: true, force: true });
    }
};

// 활성 프로젝트가 바뀌어도 열었던 세션은 남고, 경로 표기가 달라도 같은 프로젝트는 하나의 세션이다.
const checkOpenedSessions = () => {
    const projectA = createProject();
    const projectB = createProject();
    const link = `${projectA}-link`;

    try {
        const context = createPool(projectA);
        const { pool } = context;
        const sessionA = pool.get();
        const sessionB = pool.open(projectB);

        assert.notEqual(sessionA, sessionB);
        assert.equal(pool.get(projectB), sessionB, "연 프로젝트는 활성이 아니어도 요청할 수 있다");
        assert.equal(pool.open(projectB), sessionB, "다시 열어도 새 세션을 만들지 않는다");

        context.activeDir = projectB;

        assert.equal(pool.get(), sessionB);
        assert.equal(pool.get(projectA), sessionA, "활성이 아니게 된 세션도 남는다");
        assert.deepEqual(
            pool.getAll().map((session) => session.projectDir),
            [projectA, projectB]
        );

        fs.symlinkSync(projectA, link, "junction");

        assert.equal(pool.get(link), sessionA, "junction으로 가리킨 같은 프로젝트는 같은 세션");
        assert.equal(pool.open(projectA.toUpperCase()), sessionA, "대소문자가 달라도 같은 세션");
        assert.equal(pool.open(projectA + path.sep), sessionA, "끝 구분자가 있어도 같은 세션");
        assert.equal(context.created.length, 2);

        context.activeDir = "";

        const noProject = pool.get();

        assert.equal(noProject.projectDir, "", "프로젝트가 없어도 세션이 있다(시작은 프로젝트 검사에서 막힌다)");
        assert.equal(pool.get(), noProject);
        assert.equal(pool.get(projectA), sessionA);
    } finally {
        fs.rmSync(link, { recursive: true, force: true });
        fs.rmSync(projectA, { recursive: true, force: true });
        fs.rmSync(projectB, { recursive: true, force: true });
    }
};

checkActiveSession();
checkOpenedSessions();

console.log("Desktop session checks passed.");
