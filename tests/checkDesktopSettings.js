import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readJsonFile, writeJsonFile, recoverJsonFile } = require("../desktop/jsonFile.cjs");
const { createSettingsStore, normalizeSettings, normalizeOverrides, migrateSettings, getProjectKey, DEFAULT_SETTINGS, SETTINGS_VERSION } = require("../desktop/settingsStore.cjs");
const { getDefaultSchedule } = require("../desktop/scheduleRules.cjs");

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

checkJsonFile();
checkRecover();
checkMigrate();
checkNormalize();
checkStore();
checkProjectSettings();
checkUpgrade();

console.log("Desktop settings checks passed.");
