const path = require("node:path");
const { MODEL_CHOICES, MODEL_ID_PATTERN, EFFORT_CHOICES } = require("./autopilotRunner.cjs");
const { normalizeSchedules } = require("./scheduleRules.cjs");
const { readJsonFile, writeJsonFile, recoverJsonFile, BACKUP_SUFFIX } = require("./jsonFile.cjs");

// 저장 형식이 바뀔 때마다 올린다. 버전 키가 없는 옛 파일은 0으로 본다.
const SETTINGS_VERSION = 1;
const SETTINGS_FILE_NAME = "settings.json";
const POLICY_CHOICES = ["auto", "todo"];
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECOVERY_NOTICES = {
    restored: "설정 파일이 손상돼 직전 백업으로 복구했어요.",
    reset: `설정 파일이 손상돼 기본값으로 시작했어요. 손상된 파일은 ${SETTINGS_FILE_NAME}.corrupt로 남겨 뒀어요.`
};

const DEFAULT_SETTINGS = {
    projectDir: "",
    tasks: "",
    endTime: "",
    policy: "auto",
    extendOnLimit: false,
    model: "opus",
    modelVersions: {},
    effort: "high",
    accounts: [],
    accountId: "default",
    claudeDir: "",
    keepInTray: false,
    launchAtLogin: false,
    schedules: []
};

// modelVersions는 계열(opus 등)마다 고정한 모델 ID이고, 없으면 그 계열의 최신 별칭을 쓴다.
const isModelVersions = (value) => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([family, id]) => MODEL_CHOICES.includes(family) && MODEL_ID_PATTERN.test(id));
};

// 저장된 값이 허용 범위를 벗어나면 기본값으로 대신한다.
const SETTING_VALIDATORS = {
    projectDir: (value) => typeof value === "string",
    tasks: (value) => typeof value === "string",
    endTime: (value) => value === "" || END_TIME_PATTERN.test(value),
    policy: (value) => POLICY_CHOICES.includes(value),
    extendOnLimit: (value) => typeof value === "boolean",
    model: (value) => MODEL_CHOICES.includes(value),
    modelVersions: isModelVersions,
    effort: (value) => EFFORT_CHOICES.includes(value),
    accounts: (value) => Array.isArray(value),
    accountId: (value) => typeof value === "string",
    claudeDir: (value) => typeof value === "string",
    keepInTray: (value) => typeof value === "boolean",
    launchAtLogin: (value) => typeof value === "boolean",
    schedules: (value) => Array.isArray(value)
};

// MIGRATIONS[n]은 버전 n의 저장 내용을 n+1 형식으로 바꾼다. 키 이름이나 의미를 바꿀 때 여기에 더한다.
const MIGRATIONS = {
    0: (saved) => saved
};

const migrateSettings = (saved, migrations = MIGRATIONS, targetVersion = SETTINGS_VERSION) => {
    let migrated = saved;

    for (let version = Number.isInteger(saved.version) ? saved.version : 0; version < targetVersion; version++) {
        migrated = migrations[version](migrated);
    }

    return migrated;
};

const normalizeSettings = (saved) => {
    const settings = Object.fromEntries(Object.entries(SETTING_VALIDATORS).map(([key, isValid]) => [key, isValid(saved[key]) ? saved[key] : structuredClone(DEFAULT_SETTINGS[key])]));

    return { ...settings, schedules: normalizeSchedules(settings.schedules) };
};

// 앱 데이터 폴더의 settings.json 하나를 읽고 쓴다. 쓰기는 항상 원자적이고, 읽지 못하면 직전 백업, 그것도 없으면 기본값을 돌려준다.
const createSettingsStore = ({ dir }) => {
    const file = path.join(dir, SETTINGS_FILE_NAME);
    let notice = "";

    const read = () => {
        let loaded = readJsonFile(file);

        if (loaded.state === "corrupt") {
            loaded = readJsonFile(`${file}${BACKUP_SUFFIX}`);
        }

        return loaded.state === "ok" ? normalizeSettings(migrateSettings(loaded.data)) : normalizeSettings({});
    };

    const write = (settings) => {
        writeJsonFile(file, { version: SETTINGS_VERSION, ...normalizeSettings(settings) });
    };

    // 읽은 직후의 최신 값에 바뀐 키만 얹는다. await 사이에 다른 곳이 저장한 값을 옛 스냅샷으로 덮지 않는다.
    const update = (patch) => {
        const next = normalizeSettings({ ...read(), ...patch });

        write(next);

        return next;
    };

    // 앱을 켤 때 한 번. 손상됐으면 복구하고, 화면이 한 번 알릴 안내를 남긴다.
    const recover = () => {
        const result = recoverJsonFile(file);

        notice = RECOVERY_NOTICES[result] || notice;

        return result;
    };

    const takeNotice = () => {
        const taken = notice;

        notice = "";

        return taken;
    };

    return { file: file, read: read, write: write, update: update, recover: recover, takeNotice: takeNotice };
};

module.exports = { createSettingsStore, normalizeSettings, migrateSettings, DEFAULT_SETTINGS, POLICY_CHOICES, END_TIME_PATTERN, SETTINGS_VERSION, SETTINGS_FILE_NAME };
