import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readJsonFile, writeJsonFile, recoverJsonFile } = require("../desktop/jsonFile.cjs");
const { createSettingsStore, normalizeSettings, normalizeOverrides, migrateSettings, getProjectKey, DEFAULT_SETTINGS, SETTINGS_VERSION, MAX_TABS } = require("../desktop/settingsStore.cjs");
const { getDefaultSchedule } = require("../desktop/scheduleRules.cjs");

const IS_CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-settings-"));

const readText = (file) => fs.readFileSync(file, "utf8");

// 원자적 쓰기: 직전 정상 파일만 .bak으로 남기고, 쓰다가 실패해도 원본과 임시 파일이 남지 않는다.
const checkJsonFile = () => {
    const dir = createTempDir();
    const file = path.join(dir, "a.json");

    try {
        writeJsonFile(file, { value: 1 });

        assert.deepEqual(readJsonFile(file), { state: "ok", data: { value: 1 } });
        assert.equal(fs.existsSync(`${file}.bak`), false);

        writeJsonFile(file, { value: 2 });

        assert.deepEqual(JSON.parse(readText(`${file}.bak`)), { value: 1 });

        assert.throws(() => writeJsonFile(file, { value: 10n }));
        assert.deepEqual(readJsonFile(file).data, { value: 2 });
        assert.deepEqual(fs.readdirSync(dir).sort(), ["a.json", "a.json.bak"]);

        fs.writeFileSync(file, "{ 깨진");

        assert.equal(readJsonFile(file).state, "corrupt");

        writeJsonFile(file, { value: 3 });

        assert.deepEqual(JSON.parse(readText(`${file}.bak`)), { value: 1 }, "깨진 파일이 좋은 백업을 덮으면 안 된다");

        fs.writeFileSync(file, "[1, 2]");

        assert.equal(readJsonFile(file).state, "corrupt", "객체가 아닌 JSON도 손상으로 본다");
        assert.equal(readJsonFile(path.join(dir, "none.json")).state, "missing");

        fs.writeFileSync(file, `\uFEFF{"value": 4}`);

        assert.deepEqual(readJsonFile(file).data, { value: 4 }, "BOM이 있어도 읽는다");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const checkRecover = () => {
    const dir = createTempDir();
    const file = path.join(dir, "a.json");

    try {
        assert.equal(recoverJsonFile(file), "none");

        writeJsonFile(file, { value: 1 });
        writeJsonFile(file, { value: 2 });

        assert.equal(recoverJsonFile(file), "none");

        fs.writeFileSync(file, "{ 깨진");

        assert.equal(recoverJsonFile(file), "restored");
        assert.deepEqual(readJsonFile(file).data, { value: 1 });
        assert.equal(readText(`${file}.corrupt`), "{ 깨진");

        fs.rmSync(`${file}.bak`);
        fs.writeFileSync(file, "깨짐");

        assert.equal(recoverJsonFile(file), "reset");
        assert.equal(fs.existsSync(file), false);
        assert.equal(readText(`${file}.corrupt`), "깨짐");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const checkMigrate = () => {
    const migrations = { 0: (saved) => ({ ...saved, step: `${saved.step || ""}a` }), 1: (saved) => ({ ...saved, step: `${saved.step}b` }) };

    assert.equal(migrateSettings({}, migrations, 2).step, "ab");
    assert.equal(migrateSettings({ version: 1 }, migrations, 2).step, "undefinedb");
    assert.deepEqual(migrateSettings({ version: 2, keep: 1 }, migrations, 2), { version: 2, keep: 1 });
    assert.deepEqual(migrateSettings({ version: 9, keep: 1 }, migrations, 2), { version: 9, keep: 1 }, "더 새 버전의 파일은 건드리지 않는다");
    assert.equal(migrateSettings({ version: "x" }, migrations, 2).step, "ab");
};

const checkNormalize = () => {
    const settings = normalizeSettings({ model: "nope", effort: "max", policy: 3, projectDir: "/p", unknown: 1, modelVersions: { opus: "claude-opus-4-8" }, schedules: [{ nope: true }] });

    assert.equal(settings.model, DEFAULT_SETTINGS.model);
    assert.equal(settings.effort, "max");
    assert.equal(settings.policy, DEFAULT_SETTINGS.policy);
    assert.equal(settings.projectDir, "/p");
    assert.equal(settings.unknown, undefined);
    assert.deepEqual(settings.modelVersions, { opus: "claude-opus-4-8" });
    assert.deepEqual(settings.schedules, []);
    assert.deepEqual(normalizeSettings({ modelVersions: { opus: "x y" } }).modelVersions, {});

    assert.equal(normalizeSettings({}).notifyFinish, true, "알림은 기본으로 켜져 있다");
    assert.equal(normalizeSettings({}).notifyFocused, false);
    assert.equal(normalizeSettings({}).checkUpdates, true, "새 버전 확인은 기본으로 켜져 있다");
    assert.equal(normalizeSettings({ checkUpdates: "no" }).checkUpdates, true);
    assert.equal(normalizeSettings({}).extendLimitMinutes, 0, "연장 상한은 기본이 제한 없음");
    assert.equal(normalizeSettings({ extendLimitMinutes: 180 }).extendLimitMinutes, 180);
    assert.equal(normalizeSettings({ extendLimitMinutes: 100 }).extendLimitMinutes, 0, "허용되지 않은 값은 기본값");
    assert.equal(normalizeSettings({}).commitPrefix, "[ap]");
    assert.equal(normalizeSettings({}).workBranch, "ai/autopilot");
    assert.equal(normalizeSettings({ commitPrefix: "feat:", workBranch: "bot/x" }).workBranch, "bot/x");
    assert.equal(normalizeSettings({ workBranch: "main" }).workBranch, "ai/autopilot", "보호 브랜치는 기본값으로");
    assert.equal(normalizeSettings({ commitPrefix: "a`b" }).commitPrefix, "[ap]");
    assert.equal(normalizeSettings({}).logRetentionDays, 30);
    assert.equal(normalizeSettings({ logRetentionDays: 7 }).logRetentionDays, 7);
    assert.equal(normalizeSettings({ logRetentionDays: 10 }).logRetentionDays, 30, "허용되지 않은 값은 기본값");
    assert.equal(normalizeSettings({}).postRunAction, "none", "끝난 뒤 PC 동작은 기본으로 하지 않는다");
    assert.equal(normalizeSettings({ postRunAction: "sleep" }).postRunAction, "sleep");
    assert.equal(normalizeSettings({ postRunAction: "reboot" }).postRunAction, "none");
    assert.equal(normalizeSettings({}).sleepBlock, "always");
    assert.equal(normalizeSettings({ sleepBlock: "plugged" }).sleepBlock, "plugged");
    assert.equal(normalizeSettings({ sleepBlock: "sometimes" }).sleepBlock, "always", "허용되지 않은 값은 기본값");
    assert.equal(normalizeSettings({ notifyFinish: false }).notifyFinish, false);
    assert.equal(normalizeSettings({ notifyFocused: "yes" }).notifyFocused, false, "불리언이 아니면 기본값");

    const first = normalizeSettings({});

    first.accounts.push({ id: "x" });
    first.modelVersions.opus = "claude-opus-4-8";

    assert.deepEqual(normalizeSettings({}).accounts, [], "기본값 배열·객체를 호출끼리 공유하면 안 된다");
    assert.deepEqual(normalizeSettings({}).modelVersions, {});
};

// 옛 파일(버전 키 없음)을 읽어 새 형식으로 쓰고, 손상되면 백업으로 복구하며 안내를 한 번만 남긴다.
const checkStore = () => {
    const dir = createTempDir();

    try {
        const store = createSettingsStore({ dir: dir });

        assert.deepEqual(store.read(), DEFAULT_SETTINGS, "파일이 없으면 기본값");
        assert.equal(store.recover(), "none");
        assert.equal(store.takeNotice(), "");

        fs.writeFileSync(store.file, JSON.stringify({ projectDir: "/legacy", effort: "low", keepInTray: "yes" }));

        const legacy = store.read();

        assert.equal(legacy.projectDir, "/legacy");
        assert.equal(legacy.effort, "low");
        assert.equal(legacy.keepInTray, false);

        store.write(legacy);

        assert.equal(JSON.parse(readText(store.file)).version, SETTINGS_VERSION);

        const updated = store.update({ model: "sonnet" });

        assert.equal(updated.model, "sonnet");
        assert.equal(updated.projectDir, "/legacy", "update는 읽은 직후의 값에 바뀐 키만 얹는다");
        assert.equal(store.read().model, "sonnet");

        // 깨진 직후 앱이 켜져 있는 동안에도 읽기는 직전 백업으로 이어간다.
        fs.writeFileSync(store.file, "{ 깨진");

        assert.equal(store.read().projectDir, "/legacy");

        assert.equal(store.recover(), "restored");
        assert.match(store.takeNotice(), /백업으로 복구/);
        assert.equal(store.takeNotice(), "", "안내는 한 번만");
        assert.equal(store.read().model, "opus", "백업은 직전 쓰기 전 상태다");

        fs.writeFileSync(store.file, "깨짐");
        fs.rmSync(`${store.file}.bak`);

        assert.equal(store.recover(), "reset");
        assert.match(store.takeNotice(), /기본값으로 시작/);
        assert.deepEqual(store.read(), DEFAULT_SETTINGS);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

// 전역과 프로젝트: 덮어쓴 키만 프로젝트 파일에 있고, 없는 키는 전역 값을 따른다.
const checkProjectSettings = () => {
    const dir = createTempDir();
    const projectA = createTempDir();
    const projectB = createTempDir();

    try {
        const store = createSettingsStore({ dir: dir });

        store.update({ projectDir: projectA, model: "sonnet", effort: "low" });

        let view = store.resolve();

        assert.equal(view.settings.model, "sonnet");
        assert.deepEqual(view.overridden, []);
        assert.equal(view.globals.model, "sonnet");

        store.updateProject(projectA, { effort: "max", tasks: "A 작업", unknown: 1, model: "nope" });

        view = store.resolve();

        assert.equal(view.settings.effort, "max");
        assert.equal(view.settings.tasks, "A 작업");
        assert.equal(view.settings.model, "sonnet", "허용되지 않은 값은 버리고 전역 값을 따른다");
        assert.deepEqual([...view.overridden].sort(), ["effort", "tasks"]);
        assert.equal(view.globals.effort, "low", "전역 값은 그대로");
        assert.equal(view.settings.accountId, "default", "전역에만 있는 키는 그대로 보인다");

        store.update({ projectDir: projectB });
        view = store.resolve();

        assert.equal(view.settings.effort, "low", "다른 프로젝트는 전역 값");
        assert.equal(view.settings.tasks, "");
        assert.deepEqual(store.readProject(projectA), { effort: "max", tasks: "A 작업" });

        // 시작할 때 기억: 전역과 같은 값은 덮어쓰지 않고, 이미 덮어쓴 값이 전역과 같아지면 지운다.
        store.remember(projectB, { model: "sonnet", effort: "high", policy: "todo", tasks: "B", endTime: "" });

        assert.deepEqual(store.readProject(projectB), { effort: "high", policy: "todo", tasks: "B" });

        store.remember(projectB, { effort: "low", tasks: "" });

        assert.deepEqual(store.readProject(projectB), { policy: "todo" });

        store.remember("", { model: "haiku" });

        assert.equal(store.read().model, "haiku", "프로젝트가 없으면 전역에 기억한다");

        store.clearProject(projectB, ["policy", "nope"]);

        assert.deepEqual(store.readProject(projectB), {});
        assert.deepEqual(store.readProject(""), {});

        // 예약은 전역 목록과 프로젝트 목록이 따로 있다.
        const schedule = { ...getDefaultSchedule("time"), id: "sch-0123abcd" };

        store.updateProject(projectA, { schedules: [schedule, { nope: true }] });

        assert.deepEqual(store.readProject(projectA).schedules, [schedule]);
        assert.deepEqual(store.read().schedules, []);
        assert.equal(store.resolve().settings.schedules.length, 0);
        assert.deepEqual(
            store
                .listProjects()
                .map((project) => project.projectDir)
                .sort(),
            [projectA, projectB].sort()
        );

        // 파일 이름은 폴더 이름과 실제 경로의 해시이고 항상 같다.
        assert.equal(getProjectKey(projectA), getProjectKey(projectA));
        assert.notEqual(getProjectKey(projectA), getProjectKey(projectB));
        assert(getProjectKey(projectA).startsWith(path.basename(projectA) + "-"));
        assert(fs.existsSync(path.join(dir, "project-settings", getProjectKey(projectA) + ".json")));

        // 손상된 프로젝트 파일은 백업으로 복구하고 안내를 한 번 남긴다.
        const file = path.join(dir, "project-settings", getProjectKey(projectA) + ".json");

        store.updateProject(projectA, { effort: "xhigh" });
        fs.writeFileSync(file, "{ 깨진");

        assert.equal(store.readProject(projectA).effort, "max", "복구한 값은 직전 쓰기 전의 백업이다");
        assert.match(store.takeNotice(), /백업으로 복구/);
        assert.equal(store.takeNotice(), "");
        assert.deepEqual(normalizeOverrides(null), {});
    } finally {
        for (const target of [dir, projectA, projectB]) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

// 옛 형식(전역 작업 하나)을 올리면 작업이 마지막으로 고른 프로젝트로 옮겨 가고, 이미 새 형식이면 건드리지 않는다.
const checkUpgrade = () => {
    const dir = createTempDir();
    const project = createTempDir();

    try {
        const store = createSettingsStore({ dir: dir });

        fs.writeFileSync(store.file, JSON.stringify({ projectDir: project, tasks: "옛 작업", model: "sonnet", effort: "low" }));

        assert.equal(store.upgrade(), true);

        const upgraded = JSON.parse(readText(store.file));

        assert.equal(upgraded.version, SETTINGS_VERSION);
        assert.deepEqual(upgraded.tabs, [project], "마지막으로 고른 프로젝트가 탭 하나로 이어진다");
        assert.equal(upgraded.tasks, "");
        assert.equal(upgraded.model, "sonnet", "나머지는 전역 기본값으로 남는다");
        assert.deepEqual(store.readProject(project), { tasks: "옛 작업" });
        assert.equal(store.resolve().settings.tasks, "옛 작업");
        assert.equal(JSON.parse(readText(`${store.file}.bak`)).tasks, "옛 작업", "올리기 전 파일은 백업으로 남는다");
        assert.equal(store.upgrade(), false);

        const empty = createTempDir();

        try {
            const other = createSettingsStore({ dir: empty });

            fs.writeFileSync(other.file, JSON.stringify({ version: 1, tasks: "프로젝트 없음" }));

            assert.equal(other.upgrade(), true);
            assert.equal(other.read().tasks, "", "프로젝트를 모르면 옮길 곳이 없어 비운다");
            assert.deepEqual(other.listProjects(), []);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }

        const missing = createSettingsStore({ dir: path.join(dir, "none") });

        assert.equal(missing.upgrade(), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(project, { recursive: true, force: true });
    }
};

// 내보내기·가져오기: 이 PC에서만 뜻이 있는 키는 오가지 않고, 파일의 잘못된 값·낯선 파일·더 새 버전은 막는다.
const checkPorting = () => {
    const dirs = [createTempDir(), createTempDir(), createTempDir(), createTempDir(), createTempDir()];
    const [dirA, dirB, projectA, projectB, projectGone] = dirs;

    try {
        const source = createSettingsStore({ dir: dirA });
        const schedule = { ...getDefaultSchedule("time"), id: "sch-0123abcd" };

        source.update({
            projectDir: projectA,
            accountId: "acct-1",
            claudeDir: "/c",
            launchAtLogin: true,
            postRunAction: "shutdown",
            keepInTray: true,
            model: "haiku",
            effort: "max",
            schedules: [schedule]
        });
        source.updateProject(projectA, { policy: "todo", tasks: "A 작업", schedules: [schedule] });
        source.updateProject(projectGone, { effort: "low" });

        const exported = JSON.parse(JSON.stringify(source.exportData()));

        assert.deepEqual([exported.app, exported.kind, exported.version], ["AutoPilot", "settings", 1]);

        for (const key of ["projectDir", "accounts", "accountId", "claudeDir", "launchAtLogin"]) {
            assert.equal(Object.hasOwn(exported.global, key), false, `${key}는 내보내지 않는다`);
        }

        assert.equal(Object.hasOwn(exported.global, "postRunAction"), false, "PC를 끄는 동작은 내보내지 않는다");
        assert.equal(exported.global.model, "haiku");
        assert.equal(exported.global.keepInTray, true);
        assert.equal(exported.projects.length, 2);

        const target = createSettingsStore({ dir: dirB });

        target.update({ projectDir: projectB, accountId: "mine", model: "sonnet", launchAtLogin: false });

        const result = target.importData(exported, { canUseProject: (projectDir) => projectDir !== projectGone });

        assert.deepEqual(result, { keyCount: Object.keys(exported.global).length, projectCount: 1, skippedCount: 1 });

        const imported = target.read();

        assert.equal(imported.model, "haiku");
        assert.equal(imported.effort, "max");
        assert.equal(imported.keepInTray, true);
        assert.equal(imported.schedules.length, 1);
        assert.equal(imported.projectDir, projectB, "이 PC의 선택한 프로젝트는 그대로");
        assert.equal(imported.accountId, "mine");
        assert.equal(imported.launchAtLogin, false);
        assert.equal(imported.postRunAction, "none", "파일로 PC 종료를 켜지 않는다");
        assert.deepEqual(target.readProject(projectA), { policy: "todo", tasks: "A 작업", schedules: [schedule] });
        assert.deepEqual(target.readProject(projectGone), {}, "이 PC에 없는 프로젝트는 만들지 않는다");

        // 파일에 있는 키만, 허용 범위 안의 값만 바꾼다.
        const partial = target.importData({
            app: "AutoPilot",
            kind: "settings",
            version: 1,
            global: { model: "nope", effort: "low", accountId: "hack", unknown: 1 },
            projects: [{ projectDir: "" }, null, "x"]
        });

        assert.deepEqual(partial, { keyCount: 1, projectCount: 0, skippedCount: 0 });
        assert.equal(target.read().effort, "low");
        assert.equal(target.read().model, "haiku", "잘못된 값은 건드리지 않는다");
        assert.equal(target.read().accountId, "mine");

        assert.match(target.importData({ app: "Other", kind: "settings", version: 1 }).error, /설정 파일이 아니에요/);
        assert.match(target.importData(null).error, /설정 파일이 아니에요/);
        assert.match(target.importData({ app: "AutoPilot", kind: "settings", version: 99 }).error, /더 새 버전/);
        assert.equal(target.read().effort, "low", "거부한 파일은 아무것도 바꾸지 않는다");

        // 기본값으로 되돌리기: 이 PC의 값과 예약은 두고 나머지는 기본값, 프로젝트가 덮어쓴 값은 지운다.
        target.update({ launchAtLogin: true, keepInTray: false, claudeDir: "/keep", postRunAction: "sleep" });
        target.resetPreferences();

        const reset = target.read();

        assert.equal(reset.model, DEFAULT_SETTINGS.model);
        assert.equal(reset.effort, DEFAULT_SETTINGS.effort);
        assert.equal(reset.projectDir, projectB);
        assert.equal(reset.claudeDir, "/keep");
        assert.equal(reset.accountId, "mine");
        assert.equal(reset.launchAtLogin, true);
        assert.equal(reset.keepInTray, true, "로그인 자동 실행이 켜져 있으면 트레이 상주도 켜 둔다");
        assert.equal(reset.postRunAction, "none", "되돌리면 PC 동작은 하지 않음으로 돌아간다");
        assert.equal(reset.schedules.length, 1, "예약은 지우지 않는다");
        assert.deepEqual(target.readProject(projectA), { schedules: [schedule] }, "프로젝트가 덮어쓴 값은 지우고 예약만 남긴다");
    } finally {
        for (const target of dirs) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

// 프로젝트를 지정해 읽는다: 활성 프로젝트가 아니어도 그 프로젝트의 설정이 나오고, 기억한 값의 뷰도 그 프로젝트 기준이다.
const checkResolveByProject = () => {
    const dir = createTempDir();
    const projectA = createTempDir();
    const projectB = createTempDir();

    try {
        const store = createSettingsStore({ dir: dir });

        store.update({ projectDir: projectA, effort: "low" });
        store.updateProject(projectA, { tasks: "A 작업" });
        store.updateProject(projectB, { tasks: "B 작업", effort: "max" });

        const active = store.resolve();
        const background = store.resolve(projectB);

        assert.equal(active.settings.projectDir, projectA);
        assert.equal(active.settings.tasks, "A 작업");
        assert.equal(background.settings.projectDir, projectB, "지정한 프로젝트가 settings.projectDir이다");
        assert.equal(background.settings.tasks, "B 작업");
        assert.equal(background.settings.effort, "max");
        assert.deepEqual([...background.overridden].sort(), ["effort", "tasks"]);
        assert.deepEqual(store.resolve(projectA), active, "활성 프로젝트를 지정해도 생략한 것과 같다");
        assert.equal(store.resolve("").settings.projectDir, "", "빈 경로는 프로젝트 없음이다");

        const remembered = store.remember(projectB, { tasks: "B 다음 작업" });

        assert.equal(remembered.settings.projectDir, projectB, "활성이 아닌 프로젝트에 기억해도 그 프로젝트의 뷰를 돌려준다");
        assert.equal(remembered.settings.tasks, "B 다음 작업");
        assert.equal(store.read().projectDir, projectA, "활성 프로젝트는 바뀌지 않는다");
        assert.equal(store.resolve().settings.tasks, "A 작업");
    } finally {
        for (const target of [dir, projectA, projectB]) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

// 열린 탭: 같은 프로젝트는 표기가 달라도 한 탭이고, 활성 프로젝트는 항상 탭 목록에 있다.
const checkTabs = () => {
    const dir = createTempDir();
    const projectA = createTempDir();
    const projectB = createTempDir();
    const link = `${projectA}-link`;

    try {
        fs.symlinkSync(projectA, link, "junction");

        assert.deepEqual(normalizeSettings({}).tabs, [], "프로젝트가 없으면 탭도 없다");
        assert.deepEqual(normalizeSettings({ tabs: [projectA, 3, "", projectB] }).tabs, [], "문자열이 아닌 항목이 있는 목록은 통째로 버린다");

        const settings = normalizeSettings({ tabs: [projectA, link, ...(IS_CASE_INSENSITIVE_FS ? [projectA.toUpperCase()] : []), projectB], projectDir: projectB });

        assert.deepEqual(settings.tabs, [projectA, projectB], "표기가 달라도 같은 프로젝트는 앞의 탭 하나만 남는다");
        assert.equal(settings.projectDir, projectB);
        assert.equal(normalizeSettings({ tabs: [projectA], projectDir: link }).projectDir, projectA, "활성 프로젝트의 표기는 탭에 저장된 것을 따른다");
        assert.deepEqual(normalizeSettings({ projectDir: projectA }).tabs, [projectA], "탭이 없어도 활성 프로젝트는 탭에 들어간다(탭이 없는 옛 파일·낮은 버전 앱이 쓴 파일)");
        assert.deepEqual(normalizeSettings({ tabs: [projectA], projectDir: projectB }).tabs, [projectA, projectB]);
        assert.deepEqual(normalizeSettings({ tabs: [projectA, projectB], projectDir: "" }).tabs, [projectA, projectB], "활성 프로젝트가 없어도 열린 탭은 남는다");

        const many = Array.from({ length: MAX_TABS + 3 }, (_, index) => path.join(dir, `p${index}`));

        assert.equal(normalizeSettings({ tabs: many }).tabs.length, MAX_TABS, "탭은 상한까지만 둔다");
        assert.equal(normalizeSettings({ tabs: many, projectDir: many.at(-1) }).tabs.at(-1), many.at(-1), "상한을 넘겨도 활성 프로젝트는 탭에 남는다");

        assert.deepEqual(migrateSettings({ version: 2, projectDir: projectA }).tabs, [projectA]);
        assert.deepEqual(migrateSettings({ version: 2, projectDir: "" }).tabs, []);

        const store = createSettingsStore({ dir: dir });

        assert.deepEqual(store.openTab(projectA), { projectDir: projectA, existing: false });
        assert.deepEqual(store.read().tabs, [projectA]);
        assert.equal(store.read().projectDir, projectA);

        assert.deepEqual(store.openTab(projectB), { projectDir: projectB, existing: false });
        assert.deepEqual(store.read().tabs, [projectA, projectB], "새 프로젝트는 새 탭이다");
        assert.equal(store.read().projectDir, projectB, "연 탭이 활성이 된다");

        assert.deepEqual(store.openTab(link), { projectDir: projectA, existing: true }, "이미 열린 프로젝트는 새 탭 없이 원래 탭을 돌려준다");
        assert.deepEqual(store.read().tabs, [projectA, projectB]);
        assert.equal(store.read().projectDir, projectA, "원래 탭이 활성이 된다");

        const replacement = createTempDir();

        try {
            assert.deepEqual(store.openTab(replacement, { replaceDir: link }), { projectDir: replacement, existing: false });
            assert.deepEqual(store.read().tabs, [replacement, projectB], "지정한 탭 자리에서 프로젝트를 바꾼다(표기가 달라도)");
            assert.equal(store.read().projectDir, replacement);

            const filler = Array.from({ length: MAX_TABS - 2 }, (_, index) => path.join(dir, `f${index}`));

            store.update({ tabs: [replacement, projectB, ...filler] });

            assert.equal(store.read().tabs.length, MAX_TABS);
            assert.match(store.openTab(path.join(dir, "extra")).error, /탭은 \d+개까지/, "탭이 상한이면 새 탭을 열지 않는다");
            assert.equal(store.read().tabs.length, MAX_TABS);
            assert.equal(store.openTab(path.join(dir, "swap"), { replaceDir: projectB }).error, undefined, "상한이어도 열린 탭의 프로젝트를 바꾸는 것은 된다");
            assert.equal(store.read().tabs.length, MAX_TABS);
        } finally {
            fs.rmSync(replacement, { recursive: true, force: true });
        }

        const exported = store.exportData();

        assert.equal(Object.hasOwn(exported.global, "tabs"), false, "탭 목록은 이 PC에서만 뜻이 있어 내보내지 않는다");

        const before = store.read().tabs;

        store.importData({ app: "AutoPilot", kind: "settings", version: 1, global: { tabs: ["/elsewhere"], model: "haiku" }, projects: [] });

        assert.deepEqual(store.read().tabs, before, "가져오지도 않는다");

        store.resetPreferences();

        assert.deepEqual(store.read().tabs, before, "기본값으로 되돌려도 지우지 않는다");
    } finally {
        fs.rmSync(link, { recursive: true, force: true });

        for (const target of [dir, projectA, projectB]) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

// 탭 닫기: 활성 탭을 닫으면 오른쪽(없으면 왼쪽) 탭이 활성이 되고, 열려 있지 않은 프로젝트는 아무것도 바꾸지 않는다.
const checkCloseTab = () => {
    const dir = createTempDir();
    const projects = [createTempDir(), createTempDir(), createTempDir()];
    const [projectA, projectB, projectC] = projects;
    const link = `${projectB}-link`;

    try {
        fs.symlinkSync(projectB, link, "junction");

        const store = createSettingsStore({ dir: dir });

        store.update({ tabs: projects, projectDir: projectB });

        assert.deepEqual(store.closeTab(projectA), { projectDir: projectB, closed: true }, "활성이 아닌 탭을 닫아도 활성 탭은 그대로다");
        assert.deepEqual(store.read().tabs, [projectB, projectC]);

        assert.deepEqual(store.closeTab(link), { projectDir: projectC, closed: true }, "활성 탭을 닫으면 오른쪽 탭이 활성이 된다(경로 표기가 달라도)");
        assert.deepEqual(store.read().tabs, [projectC]);
        assert.equal(store.read().projectDir, projectC);

        store.update({ tabs: [projectA, projectB, projectC], projectDir: projectC });

        assert.deepEqual(store.closeTab(projectC), { projectDir: projectB, closed: true }, "오른쪽 탭이 없으면 왼쪽 탭이 활성이 된다");

        assert.deepEqual(store.closeTab(path.join(dir, "nowhere")), { projectDir: projectB, closed: false }, "열려 있지 않은 프로젝트는 아무것도 바꾸지 않는다");
        assert.deepEqual(store.read().tabs, [projectA, projectB]);

        store.closeTab(projectB);

        assert.deepEqual(store.closeTab(projectA), { projectDir: "", closed: true }, "마지막 탭을 닫으면 활성 프로젝트가 비게 된다");
        assert.deepEqual(store.read().tabs, []);
        assert.equal(store.read().projectDir, "");
    } finally {
        fs.rmSync(link, { recursive: true, force: true });

        for (const target of [dir, ...projects]) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

// 계정은 프로젝트(탭)마다 고른다: 고르지 않으면 전역 계정을 따르고, 이 PC에서만 뜻이 있어 파일로 오가지 않는다.
const checkProjectAccount = () => {
    const dir = createTempDir();
    const projectA = createTempDir();
    const projectB = createTempDir();

    try {
        const store = createSettingsStore({ dir: dir });

        store.update({ projectDir: projectA, accountId: "acct-global" });
        store.updateProject(projectB, { accountId: "acct-b", tasks: "B 작업" });

        assert.equal(store.resolve().settings.accountId, "acct-global", "고르지 않은 프로젝트는 전역 계정을 따른다");
        assert.equal(store.resolve(projectB).settings.accountId, "acct-b", "프로젝트가 고른 계정이 우선한다");
        assert.equal(store.resolve(projectA).settings.accountId, "acct-global");
        assert.deepEqual(store.resolve(projectB).overridden, ["tasks"], "계정은 설정 범위(덮어쓴 키)에 들지 않는다");
        assert.deepEqual(normalizeOverrides({ accountId: "" }), {}, "빈 값은 고른 것이 아니다");
        assert.deepEqual(normalizeOverrides({ accountId: 5 }), {});

        store.remember(projectB, { tasks: "다음" });

        assert.equal(store.readProject(projectB).accountId, "acct-b", "작업을 기억해도 고른 계정은 남는다");

        store.clearProject(projectB, ["tasks"]);

        assert.equal(store.readProject(projectB).accountId, "acct-b");

        const exported = store.exportData();
        const exportedB = exported.projects.find((project) => project.projectDir === projectB);

        assert.equal(Object.hasOwn(exportedB.settings, "accountId"), false, "내보내기에 계정이 없다");
        assert.equal(exported.global.accountId, undefined);

        store.importData({ app: "AutoPilot", kind: "settings", version: 1, global: {}, projects: [{ projectDir: projectB, settings: { accountId: "acct-evil", effort: "low" } }] });

        assert.equal(store.readProject(projectB).accountId, "acct-b", "가져와도 이 PC의 계정이 남고 파일의 계정은 받지 않는다");
        assert.equal(store.readProject(projectB).effort, "low");

        store.resetPreferences();

        assert.deepEqual(store.readProject(projectB), { accountId: "acct-b" }, "기본값으로 되돌려도 고른 계정은 남는다");
    } finally {
        for (const target of [dir, projectA, projectB]) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
};

checkJsonFile();
checkRecover();
checkMigrate();
checkNormalize();
checkStore();
checkProjectSettings();
checkResolveByProject();
checkTabs();
checkCloseTab();
checkProjectAccount();
checkUpgrade();
checkPorting();

console.log("Desktop settings checks passed.");
