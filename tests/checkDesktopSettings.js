import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readJsonFile, writeJsonFile, recoverJsonFile } = require("../desktop/jsonFile.cjs");
const { createSettingsStore, normalizeSettings, migrateSettings, DEFAULT_SETTINGS, SETTINGS_VERSION } = require("../desktop/settingsStore.cjs");

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

checkJsonFile();
checkRecover();
checkMigrate();
checkNormalize();
checkStore();

console.log("Desktop settings checks passed.");
