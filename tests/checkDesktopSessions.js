import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSessionPool } = require("../desktop/sessionPool.cjs");
const { getProjectKey } = require("../desktop/settingsStore.cjs");

const createPool = (initialDir) => {
    const context = { activeDir: initialDir, openDirs: [], created: [] };

    context.pool = createSessionPool({
        getKey: (projectDir) => (projectDir ? getProjectKey(projectDir) : ""),
        getActiveDir: () => context.activeDir,
        getOpenDirs: () => context.openDirs,
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

// 열린 탭의 프로젝트는 활성이 아니어도 요청할 수 있고, 세션은 처음 요청될 때 탭에 저장된 경로 표기로 만든다.
const checkOpenTabs = () => {
    const projectA = createProject();
    const projectB = createProject();
    const projectC = createProject();
    const link = `${projectB}-link`;

    try {
        fs.symlinkSync(projectB, link, "junction");

        const context = createPool(projectA);
        const { pool } = context;

        context.openDirs = [projectA, projectB];

        assert.equal(context.created.length, 0, "탭이 열려 있다고 세션을 미리 만들지는 않는다");

        const sessionB = pool.get(link);

        assert.equal(sessionB.projectDir, projectB, "다른 표기로 요청해도 탭에 저장된 표기로 만든다");
        assert.equal(pool.get(projectB), sessionB);
        assert.equal(context.created.length, 1);
        assert.equal(pool.get(projectC), null, "열린 탭이 아닌 프로젝트는 받지 않는다");

        context.openDirs = [projectA];

        assert.equal(pool.get(projectB), sessionB, "이미 만든 세션은 탭 목록과 무관하게 남는다");
        assert.equal(pool.get(projectA).projectDir, projectA);
    } finally {
        fs.rmSync(link, { recursive: true, force: true });
        fs.rmSync(projectA, { recursive: true, force: true });
        fs.rmSync(projectB, { recursive: true, force: true });
        fs.rmSync(projectC, { recursive: true, force: true });
    }
};

// 탭을 닫으면 그 프로젝트의 세션을 버리고, 열려 있지 않게 된 프로젝트는 더 받지 않는다.
const checkCloseSession = () => {
    const projectA = createProject();
    const projectB = createProject();

    try {
        const context = createPool(projectA);
        const { pool } = context;

        context.openDirs = [projectA, projectB];

        const sessionB = pool.get(projectB);

        assert.equal(pool.close(projectB), true);

        context.openDirs = [projectA];

        assert.equal(pool.get(projectB), null, "닫은 탭의 프로젝트는 더 받지 않는다");
        assert.deepEqual(
            pool.getAll().map((session) => session.projectDir),
            [],
            "닫은 세션은 보관하지 않는다"
        );
        assert.equal(pool.close(projectB), false, "이미 닫았으면 아무것도 하지 않는다");

        context.openDirs = [projectA, projectB];

        assert.notEqual(pool.get(projectB), sessionB, "다시 열면 새 세션이다");
    } finally {
        fs.rmSync(projectA, { recursive: true, force: true });
        fs.rmSync(projectB, { recursive: true, force: true });
    }
};

checkActiveSession();
checkOpenedSessions();
checkOpenTabs();
checkCloseSession();

console.log("Desktop session checks passed.");
