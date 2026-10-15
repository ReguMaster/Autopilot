const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { MODEL_CHOICES, MODEL_ID_PATTERN, EFFORT_CHOICES } = require("./autopilotRunner.cjs");
const { normalizeSchedules } = require("./scheduleRules.cjs");
const { readJsonFile, writeJsonFile, recoverJsonFile, BACKUP_SUFFIX } = require("./jsonFile.cjs");

// 저장 형식이 바뀔 때마다 올린다. 버전 키가 없는 옛 파일은 0으로 본다.
const SETTINGS_VERSION = 2;
const PROJECT_SETTINGS_VERSION = 1;
const SETTINGS_FILE_NAME = "settings.json";
const PROJECT_SETTINGS_DIR_NAME = "project-settings";
const PROJECT_KEY_HASH_LENGTH = 8;
const POLICY_CHOICES = ["auto", "todo"];
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECOVERY_NOTICES = {
    restored: "설정 파일이 손상돼 직전 백업으로 복구했어요.",
    reset: "설정 파일이 손상돼 기본값으로 시작했어요. 손상된 파일은 .corrupt 확장자로 남겨 뒀어요."
};

// 프로젝트가 따로 정하지 않으면 전역 값을 쓰는 키. 전역 파일에는 기본값으로, 프로젝트 파일에는 덮어쓴 값만 들어간다.
const OVERRIDABLE_KEYS = ["tasks", "endTime", "policy", "extendOnLimit", "model", "modelVersions", "effort"];
const SCHEDULES_KEY = "schedules";
// 실행과 무관하게 언제든 바꾸는 전역 환경설정(알림 등). autopilot:set-preferences가 이 키만 받는다.
const PREFERENCE_KEYS = ["notifyFinish", "notifyFailure", "notifyLimit", "notifySchedule", "notifyFocused"];
// 이 PC에서만 뜻이 있는 값. 내보내지도 가져오지도 않고, 기본값으로 되돌릴 때도 그대로 둔다.
const MACHINE_KEYS = ["projectDir", "accounts", "accountId", "claudeDir", "launchAtLogin"];
const EXPORT_APP = "AutoPilot";
const EXPORT_KIND = "settings";
const EXPORT_VERSION = 1;
const MAX_IMPORT_PROJECTS = 200;

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
    schedules: [],
    notifyFinish: true,
    notifyFailure: true,
    notifyLimit: true,
    notifySchedule: true,
    notifyFocused: false
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
    schedules: (value) => Array.isArray(value),
    notifyFinish: (value) => typeof value === "boolean",
    notifyFailure: (value) => typeof value === "boolean",
    notifyLimit: (value) => typeof value === "boolean",
    notifySchedule: (value) => typeof value === "boolean",
    notifyFocused: (value) => typeof value === "boolean"
};

// MIGRATIONS[n]은 버전 n의 저장 내용을 n+1 형식으로 바꾼다. 키 이름이나 의미를 바꿀 때 여기에 더한다. context.writeProject는 프로젝트 파일에 쓰는 함수다.
const MIGRATIONS = {
    0: (saved) => saved,
    // 작업은 프로젝트마다 다르므로 전역의 작업 하나를 마지막으로 고른 프로젝트의 작업으로 옮긴다.
    1: (saved, context) => {
        if (saved.tasks && saved.projectDir) {
            context.writeProject?.(saved.projectDir, { tasks: saved.tasks });
        }

        return { ...saved, tasks: "" };
    }
};

const migrateSettings = (saved, migrations = MIGRATIONS, targetVersion = SETTINGS_VERSION, context = {}) => {
    let migrated = saved;

    for (let version = Number.isInteger(saved.version) ? saved.version : 0; version < targetVersion; version++) {
        migrated = migrations[version](migrated, context);
    }

    return migrated;
};

const normalizeSettings = (saved) => {
    const settings = Object.fromEntries(Object.entries(SETTING_VALIDATORS).map(([key, isValid]) => [key, isValid(saved[key]) ? saved[key] : structuredClone(DEFAULT_SETTINGS[key])]));

    return { ...settings, schedules: normalizeSchedules(settings.schedules) };
};

// 프로젝트 파일에는 덮어쓴 키만 둔다. 허용 범위를 벗어난 값은 버려 전역 값으로 되돌린다.
const normalizeOverrides = (saved) => {
    const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    const overrides = {};

    for (const key of OVERRIDABLE_KEYS) {
        if (Object.hasOwn(source, key) && SETTING_VALIDATORS[key](source[key])) {
            overrides[key] = structuredClone(source[key]);
        }
    }

    if (Object.hasOwn(source, SCHEDULES_KEY)) {
        overrides[SCHEDULES_KEY] = normalizeSchedules(source[SCHEDULES_KEY]);
    }

    return overrides;
};

// 프로젝트 폴더를 가리키는 파일 이름. 진행 기록과 같은 규칙(폴더 이름 + 실제 경로의 해시)이다.
const getProjectKey = (projectDir) => {
    let realPath = path.resolve(projectDir);

    try {
        realPath = fs.realpathSync.native(realPath);
    } catch {}

    return `${path.basename(realPath)}-${crypto.createHash("sha256").update(realPath).digest("hex").slice(0, PROJECT_KEY_HASH_LENGTH)}`;
};

const isSameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// 전역 settings.json 하나와 프로젝트별 project-settings/<키>.json을 읽고 쓴다. 쓰기는 항상 원자적이고, 읽지 못하면 직전 백업, 그것도 없으면 기본값을 돌려준다.
const createSettingsStore = ({ dir }) => {
    const file = path.join(dir, SETTINGS_FILE_NAME);
    const projectDirectory = path.join(dir, PROJECT_SETTINGS_DIR_NAME);
    let notice = "";

    const getProjectFile = (projectDir) => path.join(projectDirectory, `${getProjectKey(projectDir)}.json`);

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

    // 프로젝트 파일이 손상됐으면 그 자리에서 복구하고 안내를 남긴다.
    const readProject = (projectDir) => {
        if (!projectDir) {
            return {};
        }

        const projectFile = getProjectFile(projectDir);
        let loaded = readJsonFile(projectFile);

        if (loaded.state === "corrupt") {
            notice = RECOVERY_NOTICES[recoverJsonFile(projectFile)] || notice;
            loaded = readJsonFile(projectFile);
        }

        return loaded.state === "ok" ? normalizeOverrides(loaded.data.settings) : {};
    };

    const writeProject = (projectDir, overrides) => {
        writeJsonFile(getProjectFile(projectDir), { version: PROJECT_SETTINGS_VERSION, projectDir: projectDir, settings: normalizeOverrides(overrides) });
    };

    const updateProject = (projectDir, patch) => {
        const next = { ...readProject(projectDir), ...patch };

        writeProject(projectDir, next);

        return normalizeOverrides(next);
    };

    // 덮어쓴 값을 지워 그 키가 전역 값을 따라가게 한다.
    const clearProject = (projectDir, keys) => {
        const next = readProject(projectDir);

        for (const key of keys) {
            delete next[key];
        }

        writeProject(projectDir, next);
    };

    // 전역 값과 다른 것만 프로젝트에 덮어쓰고, 같아지면 덮어쓴 값을 지운다. 실행을 시작할 때처럼 고른 값을 암묵적으로 기억하는 경로다.
    const remember = (projectDir, values) => {
        if (!projectDir) {
            return update(values);
        }

        const globals = read();
        const next = readProject(projectDir);

        for (const key of OVERRIDABLE_KEYS.filter((candidate) => Object.hasOwn(values, candidate))) {
            if (isSameValue(values[key], globals[key])) {
                delete next[key];
            } else {
                next[key] = values[key];
            }
        }

        writeProject(projectDir, next);

        return resolve();
    };

    // 선택한 프로젝트 기준의 설정. settings는 프로젝트가 덮어쓴 값을 전역 값 위에 얹은 것, overridden은 덮어쓴 키, globals는 전역에 저장된 덮어쓸 수 있는 키의 값이다.
    const resolve = () => {
        const globals = read();
        const overrides = readProject(globals.projectDir);
        const overridden = OVERRIDABLE_KEYS.filter((key) => Object.hasOwn(overrides, key));
        const settings = { ...globals, ...Object.fromEntries(overridden.map((key) => [key, overrides[key]])) };

        return { settings: settings, overridden: overridden, globals: Object.fromEntries(OVERRIDABLE_KEYS.map((key) => [key, globals[key]])) };
    };

    // 프로젝트 파일 목록(내보내기와 예약 상태 정리에 쓴다). 읽을 수 없는 파일은 건너뛴다.
    const listProjects = () => {
        let names = [];

        try {
            names = fs.readdirSync(projectDirectory).filter((name) => name.endsWith(".json"));
        } catch {
            return [];
        }

        return names.flatMap((name) => {
            const loaded = readJsonFile(path.join(projectDirectory, name));

            return loaded.state === "ok" && typeof loaded.data.projectDir === "string" ? [{ projectDir: loaded.data.projectDir, overrides: normalizeOverrides(loaded.data.settings) }] : [];
        });
    };

    // 다른 PC로 옮기거나 보관할 설정. 이 PC에서만 뜻이 있는 값(MACHINE_KEYS)은 빼고, 프로젝트는 경로와 덮어쓴 값을 담는다.
    const exportData = () => {
        const globals = read();

        return {
            app: EXPORT_APP,
            kind: EXPORT_KIND,
            version: EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            global: Object.fromEntries(Object.entries(globals).filter(([key]) => !MACHINE_KEYS.includes(key))),
            projects: listProjects().map((project) => ({ projectDir: project.projectDir, settings: project.overrides }))
        };
    };

    // 내보낸 파일의 내용을 적용한다. 파일에 있고 허용 범위 안인 키만 바꾸고, canUseProject가 거짓인 프로젝트(이 PC에 없는 폴더 등)는 건너뛴다.
    const importData = (raw, { canUseProject = () => true } = {}) => {
        if (!raw || typeof raw !== "object" || raw.app !== EXPORT_APP || raw.kind !== EXPORT_KIND || !Number.isInteger(raw.version)) {
            return { error: "AutoPilot 설정 파일이 아니에요." };
        }

        if (raw.version > EXPORT_VERSION) {
            return { error: "더 새 버전의 AutoPilot이 내보낸 파일이에요. 앱을 업데이트한 뒤 가져와 주세요." };
        }

        const incoming = raw.global && typeof raw.global === "object" && !Array.isArray(raw.global) ? raw.global : {};
        const normalized = normalizeSettings(incoming);
        const keys = Object.keys(incoming).filter((key) => Object.hasOwn(SETTING_VALIDATORS, key) && !MACHINE_KEYS.includes(key) && SETTING_VALIDATORS[key](incoming[key]));
        const entries = (Array.isArray(raw.projects) ? raw.projects : []).slice(0, MAX_IMPORT_PROJECTS).filter((entry) => entry && typeof entry.projectDir === "string" && entry.projectDir);
        const usable = entries.filter((entry) => canUseProject(entry.projectDir));

        update(Object.fromEntries(keys.map((key) => [key, normalized[key]])));

        for (const entry of usable) {
            writeProject(entry.projectDir, entry.settings);
        }

        return { keyCount: keys.length, projectCount: usable.length, skippedCount: entries.length - usable.length };
    };

    // 기본값으로 되돌린다. 계정·선택한 프로젝트·자동 실행(MACHINE_KEYS)과 예약은 그대로 두고, 프로젝트가 덮어쓴 값은 모두 지운다.
    const resetPreferences = () => {
        const current = read();
        const kept = Object.fromEntries([...MACHINE_KEYS, SCHEDULES_KEY].map((key) => [key, current[key]]));

        write({ ...structuredClone(DEFAULT_SETTINGS), ...kept, keepInTray: current.launchAtLogin || DEFAULT_SETTINGS.keepInTray });

        for (const project of listProjects()) {
            writeProject(project.projectDir, project.overrides.schedules ? { schedules: project.overrides.schedules } : {});
        }
    };

    // 앱을 켤 때 한 번. 손상됐으면 복구하고, 옛 형식이면 새 형식으로 올려 저장한다. 화면이 한 번 알릴 안내를 남긴다.
    const recover = () => {
        const result = recoverJsonFile(file);

        notice = RECOVERY_NOTICES[result] || notice;

        return result;
    };

    const upgrade = () => {
        const loaded = readJsonFile(file);

        if (loaded.state !== "ok" || (Number.isInteger(loaded.data.version) ? loaded.data.version : 0) >= SETTINGS_VERSION) {
            return false;
        }

        write(migrateSettings(loaded.data, MIGRATIONS, SETTINGS_VERSION, { writeProject: updateProject }));

        return true;
    };

    const takeNotice = () => {
        const taken = notice;

        notice = "";

        return taken;
    };

    return {
        file: file,
        read: read,
        write: write,
        update: update,
        readProject: readProject,
        writeProject: writeProject,
        updateProject: updateProject,
        clearProject: clearProject,
        remember: remember,
        resolve: resolve,
        listProjects: listProjects,
        exportData: exportData,
        importData: importData,
        resetPreferences: resetPreferences,
        recover: recover,
        upgrade: upgrade,
        takeNotice: takeNotice
    };
};

module.exports = {
    createSettingsStore,
    normalizeSettings,
    normalizeOverrides,
    migrateSettings,
    getProjectKey,
    DEFAULT_SETTINGS,
    SETTING_VALIDATORS,
    OVERRIDABLE_KEYS,
    SCHEDULES_KEY,
    PREFERENCE_KEYS,
    MACHINE_KEYS,
    EXPORT_APP,
    EXPORT_KIND,
    EXPORT_VERSION,
    POLICY_CHOICES,
    END_TIME_PATTERN,
    SETTINGS_VERSION,
    SETTINGS_FILE_NAME
};
