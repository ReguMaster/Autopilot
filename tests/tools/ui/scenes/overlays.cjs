const { ACCOUNTS, DAY, HOUR, MODELS, NOW, PROJECT, RUNS, RUN_LINES, doneState, makeRun, runningState, withProject } = require("./data.cjs");

const callNames = async (t) => JSON.stringify((await t.calls()).map((call) => call[0]));
const callsWithArgs = async (t) => JSON.stringify(await t.calls());

const openSettings = async (t) => {
    await t.click("#settings-toggle");
    await t.wait(700);
};

const SCENES = [
    {
        name: "settings-panel",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS, settings: { projectDir: PROJECT, modelVersions: { opus: "claude-opus-4-8" } } },
        run: async (t) => {
            await openSettings(t);
            await t.shot("panel-top", "#settings");
            await t.scrollTo("#settings .panel-scroll", 380);
            await t.shot("panel-middle", "#settings");
            await t.scrollTo("#settings .panel-scroll", 9999);
            await t.shot("panel-bottom", "#settings");
            await t.shot("page-open", "", { skipDom: true });
        }
    },
    {
        name: "settings-linked-repos",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS, settings: { projectDir: PROJECT, linkedRepos: ["C:/work/mireu-web", "C:/work/mireu-admin"] } },
        run: async (t) => {
            await t.shot("ready-peek", "", { skipDom: true });
            await openSettings(t);
            await t.shot("linked-repos", "#settings");
            await t.click("#linked-repos .repo-item .button");
            await t.shot("linked-repos-removed", "#settings");
            await t.click("#add-linked-repo");
            await t.shot("linked-repos-added", "#settings");
            await t.note("calls", await callNames(t));
        }
    },
    {
        name: "settings-panel-states",
        init: {
            accounts: { ...ACCOUNTS, claudeDir: { path: "D:/claude-data", isAuto: false, exists: false } },
            models: [],
            model: { canLaunchAtLogin: true },
            isDev: true,
            settings: { keepInTray: true, launchAtLogin: true }
        },
        run: async (t) => {
            await openSettings(t);
            await t.shot("panel-top", "#settings");
            await t.scrollTo("#settings .panel-scroll", 9999);
            await t.shot("panel-bottom", "#settings");
        }
    },
    {
        name: "settings-panel-running",
        init: { ...withProject, state: runningState(), accounts: ACCOUNTS, models: MODELS },
        run: async (t) => {
            await openSettings(t);
            await t.shot("panel-top", "#settings");
            await t.note(
                "heights",
                await t.eval(
                    `JSON.stringify([...document.querySelectorAll("#settings .panel-scroll > *")].map((node) => [node.className || node.tagName, Math.round(node.getBoundingClientRect().height * 10) / 10]))`
                )
            );
            await t.scrollTo("#settings .panel-scroll", 9999);
            await t.note(
                "scroll",
                await t.eval(`(() => { const el = document.querySelector("#settings .panel-scroll"); return JSON.stringify([el.scrollTop, el.scrollHeight, el.clientHeight]); })()`)
            );
            await t.shot("panel-bottom", "#settings");
        }
    },
    {
        name: "settings-actions",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS, state: doneState(), runs: RUNS },
        run: async (t) => {
            await openSettings(t);
            await t.scrollTo("#settings .panel-scroll", 9999);
            await t.clearCalls();
            await t.click("#extend-on-limit");
            await t.click("#keep-in-tray");
            await t.shot("switches", "#settings");
            await t.click("#select-project");
            await t.click("#open-report");
            await t.click("#reset-progress");
            await t.confirm();
            await t.note("calls", await callsWithArgs(t));
            await t.click("#history-toggle");
            await t.wait(700);
            await t.shot("history-opened", "#history");
            await t.note(
                "history-aria",
                await t.eval(
                    'JSON.stringify([document.getElementById("history-toggle").getAttribute("aria-expanded"), document.getElementById("history-toggle").textContent, document.body.className])'
                )
            );
        }
    },
    {
        // 확인 모달: 옛 화면에는 없어 기준과 다른 것이 의도한 차이다. 취소·Esc는 IPC를 보내지 않고, 확인해야 보내며, 그동안 설정 패널은 닫히지 않는다.
        name: "modal-confirm",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS, state: doneState(), runs: RUNS },
        run: async (t) => {
            await openSettings(t);
            await t.scrollTo("#settings .panel-scroll", 9999);
            await t.clearCalls();
            await t.click("#reset-progress");
            await t.wait(500);
            await t.shot("danger", ".modal");
            await t.note("focus", await t.eval("document.activeElement?.textContent?.trim()"));
            await t.press("Escape");
            await t.wait(400);
            await t.note("after-esc", `${await callNames(t)} ${await t.eval('document.body.classList.contains("settings-open")')}`);
            await t.click("#reset-progress");
            await t.confirm();
            await t.note("after-confirm", `${await callNames(t)} ${await t.eval('document.body.classList.contains("settings-open")')}`);
        }
    },
    {
        name: "settings-scope",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS },
        run: async (t) => {
            await openSettings(t);
            await t.shot("global-top", "#settings");
            await t.clearCalls();
            await t.click("#settings .seg-option:nth-child(2)");
            await t.wait(300);
            await t.shot("project-top", "#settings");
            await t.click("#defaults-group .version-row:nth-child(2) .select-trigger");
            await t.click("#defaults-group .version-row:nth-child(2) .select-option:nth-child(2)");
            await t.wait(500);
            await t.shot("project-overridden", "#defaults-group");
            await t.note("calls", await callsWithArgs(t));
            await t.click("#settings .scope-reset");
            await t.wait(500);
            await t.shot("project-reset", "#defaults-group");
            await t.note("calls-after-reset", await callsWithArgs(t));
            await t.scrollTo("#settings .panel-scroll", 380);
            await t.shot("project-middle", "#settings");
        }
    },
    {
        name: "settings-git",
        init: {
            ...withProject,
            accounts: ACCOUNTS,
            models: MODELS,
            responses: { updateSettings: { status: "FAILED", error: { code: "INVALID_OPTIONS", msg: "작업 브랜치는 영문·숫자·._-/로 된 git 브랜치 이름이어야 하고 main·master는 쓸 수 없어요." } } }
        },
        run: async (t) => {
            await openSettings(t);
            await t.eval('document.querySelector("#git-group").scrollIntoView({ block: "center" })');
            await t.wait(200);
            await t.shot("git", "#git-group");
            await t.click("#git-workBranch");
            await t.press("End");
            await t.type("/");
            await t.press("Enter");
            await t.wait(500);
            await t.shot("git-error", "#git-group");
            await t.note("calls", await callsWithArgs(t));
        }
    },
    {
        name: "settings-storage",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS },
        run: async (t) => {
            await openSettings(t);
            await t.eval('document.querySelector("#storage-group").scrollIntoView({ block: "center" })');
            await t.wait(300);
            await t.shot("storage", "#storage-group");
            await t.clearCalls();
            await t.click("#prune-runs");
            await t.wait(300);
            await t.confirm();
            await t.wait(500);
            await t.note("calls", await callsWithArgs(t));
        }
    },
    {
        name: "post-action",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS, state: doneState },
        run: async (t) => {
            await t.drive("postAction", { pending: { action: "sleep", at: await t.eval("Date.now() + 58000") }, error: "" });
            await t.wait(600);
            await t.shot("banner", ".notices");
            await t.clearCalls();
            await t.click("#post-action-cancel");
            await t.note("calls", await callsWithArgs(t));
            await t.drive("postAction", { pending: null, error: "" });
            await t.wait(300);
            await t.shot("after-cancel", ".notices");
            await openSettings(t);
            await t.eval('document.querySelector("#post-run-label").scrollIntoView({ block: "center" })');
            await t.wait(300);
            await t.shot("setting", "#settings .settings-group:has(#post-run-label)");
        }
    },
    {
        name: "settings-model-versions",
        init: { ...withProject, accounts: ACCOUNTS, models: MODELS },
        run: async (t) => {
            await openSettings(t);
            await t.scrollTo("#settings .panel-scroll", 380);
            await t.clearCalls();
            await t.click("#model-versions .select-trigger");
            await t.shot("list-open", "#model-versions .select-list", { skipDom: true });
            await t.click("#model-versions .select-option:nth-child(3)");
            await t.wait(500);
            await t.shot("picked", "#model-versions");
            await t.note("calls", await callsWithArgs(t));
            await t.shot("chip", "#model-chip");
        }
    },
    {
        name: "profile-panel",
        init: { ...withProject, accounts: ACCOUNTS },
        run: async (t) => {
            await t.click("#profile-toggle");
            await t.wait(700);
            await t.shot("panel", "#profile");
            await t.clearCalls();
            await t.click(".account-option:nth-child(2)");
            await t.wait(500);
            await t.shot("second-account", "#profile");
            await t.note("calls", await callNames(t));
        }
    },
    {
        name: "profile-panel-loading",
        init: { ...withProject, accounts: { ...ACCOUNTS, snapshots: {} } },
        run: async (t) => {
            await t.click("#profile-toggle");
            await t.wait(700);
            await t.shot("loading", "#profile");
            await t.drive("account", "default", { profile: null, limits: [], fetchedAt: 0, error: { code: "TOKEN_EXPIRED", msg: "로그인이 만료됐어요." } });
            await t.shot("expired", "#profile");
            await t.drive("account", "default", { ...ACCOUNTS.snapshots.default, fetchedAt: NOW - 3 * HOUR, error: { code: "NETWORK", msg: "네트워크에 연결할 수 없어요." } });
            await t.shot("stale-error", "#profile");
        }
    },
    {
        name: "profile-panel-account-form",
        init: { ...withProject, accounts: ACCOUNTS },
        run: async (t) => {
            await t.click("#profile-toggle");
            await t.wait(700);
            await t.click("#account-add");
            await t.wait(300);
            await t.type("work");
            await t.shot("form", "#profile");
            await t.note("focus", await t.eval("document.activeElement.id"));
            await t.click("#account-form-cancel");
            await t.shot("form-cancelled", "#profile");
        }
    },
    {
        name: "profile-panel-login",
        init: { ...withProject, accounts: ACCOUNTS },
        run: async (t) => {
            await t.click("#profile-toggle");
            await t.wait(700);
            await t.drive("login", { accountId: "default", phase: "waiting", url: "https://claude.ai/oauth/x", message: "브라우저에서 로그인해 주세요." });
            await t.shot("waiting", "#profile");
            await t.drive("login", { accountId: "default", phase: "failed", url: "", message: "로그인하지 못했어요." });
            await t.shot("failed", "#profile");
            await t.drive("login", { accountId: "default", phase: "succeeded", url: "", message: "로그인했어요." });
            await t.shot("succeeded", "#profile");
        }
    },
    {
        // 로그인 만료 안내: 옛 화면에는 없어 기준과 다른 것이 의도한 차이다. 여유가 있으면 프로필 패널 줄만 보이고, 3일 안이면 안내 줄과 다시 로그인 버튼이 더해지며, 안내 줄의 버튼은 로그인을 시작해 패널을 연다.
        name: "login-expiry",
        init: { ...withProject, accounts: { ...ACCOUNTS, snapshots: { ...ACCOUNTS.snapshots, default: { ...ACCOUNTS.snapshots.default, loginExpiresAt: NOW + 29 * DAY } } } },
        run: async (t) => {
            const expiresAt = (loginExpiresAt) => ({ ...ACCOUNTS.snapshots.default, loginExpiresAt: loginExpiresAt });

            await t.click("#profile-toggle");
            await t.wait(700);
            await t.shot("far", "#profile");
            await t.press("Escape");
            await t.wait(700);
            await t.drive("account", "default", expiresAt(NOW + 2 * DAY + 5 * HOUR));
            await t.shot("banner", ".notices");
            await t.clearCalls();
            await t.click("#banner-relogin");
            await t.wait(700);
            await t.note("calls", await callsWithArgs(t));
            await t.shot("expiring", "#profile");
            await t.press("Escape");
            await t.wait(700);
            await t.drive("account", "default", expiresAt(NOW - HOUR));
            await t.shot("expired", ".notices");
        }
    },
    {
        name: "profile-panel-running",
        init: { ...withProject, accounts: ACCOUNTS, state: runningState() },
        run: async (t) => {
            await t.click("#profile-toggle");
            await t.wait(700);
            await t.shot("panel-running", "#profile");
        }
    },
    {
        name: "sheet-history",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            await t.click("#live-panel");
            await t.wait(700);
            await t.shot("empty", "#history");
            await t.log([
                "[앱] 엔진을 시작했어요",
                "AutoPilot --project x",
                "[1회차] 시작 - 남은 시간 420분",
                "10:00:01   > Read a.js",
                "10:00:02 안녕하세요, 먼저 살펴볼게요.",
                "[사용량 한도] 종료 시각 연장",
                "[결과] 완료",
                "[stderr] 경고가 있어요"
            ]);
            await t.wait(300);
            await t.shot("lines", "#history");
            await t.shot("count", "#log-count");
            await t.click("#follow");
            await t.note("follow", await t.eval('document.getElementById("follow").checked'));
            await t.click("#clear-log");
            await t.shot("cleared", "#history");
            await t.click("#history-close");
            await t.wait(700);
            await t.note("closed", await t.eval('JSON.stringify([document.body.className, document.getElementById("history").inert])'));
        }
    },
    {
        name: "sheet-history-many",
        init: { ...withProject, state: runningState() },
        run: async (t) => {
            const lines = Array.from(
                { length: 400 },
                (_, index) => `10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")} 줄 ${index} ${"긴 문장 ".repeat(index % 7)}`
            );

            await t.log(lines);
            await t.wait(300);
            await t.click("#live-panel");
            await t.wait(700);
            await t.shot("tail", "#history", { skipDom: true });
            await t.note("count", await t.eval('document.getElementById("log-count").textContent'));
            await t.note("scroll", await t.eval('(() => { const log = document.getElementById("log"); return Math.abs(log.scrollHeight - log.clientHeight - log.scrollTop) < 2; })()'));
        }
    },
    {
        name: "sheet-archive-list",
        init: { ...withProject, runs: RUNS, runDetails: {} },
        run: async (t) => {
            await t.click("#archive-all");
            await t.wait(700);
            await t.shot("list", "#archive");
            await t.hover("#archive-list .run-item");
            await t.shot("hover", "#archive");
            await t.click("#archive-close");
            await t.wait(700);
            await t.click("#archive-all");
            await t.wait(700);
            await t.click("#archive-list li:nth-child(4) .run-item");
            await t.wait(500);
            await t.shot("error-detail", "#archive");
        }
    },
    {
        name: "sheet-archive-detail",
        init: {
            ...withProject,
            runs: RUNS,
            runDetails: {
                [RUNS[0].id]: { run: RUNS[0], lines: RUN_LINES, omittedLines: 0 },
                [RUNS[1].id]: { run: makeRun(1, { isPartial: true }), lines: ["알 수 없는 줄"], omittedLines: 5 }
            }
        },
        run: async (t) => {
            await t.click("#recent-list li:nth-child(1) .run-item");
            await t.wait(700);
            await t.shot("detail", "#archive");
            await t.scrollTo("#archive-chat", 9999);
            await t.shot("detail-end", "#archive");
            await t.clearCalls();
            await t.click("#archive-report");
            await t.click("#archive-log");
            await t.note("calls", await callsWithArgs(t));
            await t.click("#archive-back");
            await t.wait(500);
            await t.shot("back-to-list", "#archive");
            await t.click("#archive-list li:nth-child(2) .run-item");
            await t.wait(500);
            await t.shot("detail-partial", "#archive");
            await t.clearCalls();
            await t.click("#archive-delete");
            await t.confirm();
            await t.wait(500);
            await t.note("delete-calls", await callNames(t));
            await t.shot("after-delete", "#archive");
        }
    },
    {
        name: "sheet-schedule",
        init: { ...withProject },
        run: async (t) => {
            await t.click("#schedule-toggle");
            await t.wait(700);
            await t.shot("empty", "#schedule");
            await t.drive("schedules", {
                schedules: [
                    { id: "sch-1", enabled: true, kind: "time", time: "23:00", window: "session", from: "", to: "", days: [1, 2, 3, 4, 5, 6, 0], minRemaining: 0, duration: 360 },
                    { id: "sch-2", enabled: true, kind: "reset", time: "23:00", window: "weekly", from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5], minRemaining: 50, duration: 240 },
                    { id: "sch-3", enabled: false, kind: "reset", time: "23:00", window: "session", from: "", to: "", days: [0, 6], minRemaining: 70, duration: 120 },
                    { id: "sch-4", enabled: true, kind: "time", time: "07:30", window: "session", from: "", to: "", days: [1, 3], minRemaining: 30, duration: 300 }
                ],
                statuses: [
                    { id: "sch-1", code: "next-time", at: NOW + 13 * HOUR, last: { at: NOW - 10 * HOUR, ok: true } },
                    { id: "sch-2", code: "low-limit", remaining: 20, need: 50, last: { at: NOW - 30 * HOUR, ok: false, message: "다른 실행이 있었어요." } },
                    { id: "sch-4", code: "outside-window", opensAt: NOW + 20 * HOUR }
                ]
            });
            await t.shot("list", "#schedule");
            await t.shot("peek", "#schedule-peek", { skipDom: true });
            await t.clearCalls();
            await t.click("#schedule-list li:nth-child(1) .switch");
            await t.click("#schedule-list li:nth-child(2) .schedule-delete");
            await t.note("calls", await callsWithArgs(t));
        }
    },
    {
        name: "sheet-schedule-form",
        init: {
            ...withProject,
            schedules: {
                schedules: [{ id: "sch-2", enabled: true, kind: "reset", time: "23:00", window: "weekly", from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5], minRemaining: 50, duration: 240 }],
                statuses: []
            }
        },
        run: async (t) => {
            await t.click("#schedule-toggle");
            await t.wait(700);
            await t.click("#schedule-add");
            await t.wait(300);
            await t.shot("new-time", "#schedule");
            await t.click("#schedule-form label.seg-option:nth-child(2)");
            await t.wait(300);
            await t.shot("new-reset", "#schedule");
            await t.click("#schedule-anytime");
            await t.shot("new-reset-anytime", "#schedule");
            await t.click("#schedule-form-cancel");
            await t.wait(300);
            await t.click("#schedule-list .schedule-body");
            await t.wait(300);
            await t.shot("edit", "#schedule");
            await t.clearCalls();
            await t.click("#schedule-form button[type=submit]");
            await t.wait(300);
            await t.note("calls", await callsWithArgs(t));
            await t.shot("after-save", "#schedule");
        }
    },
    {
        name: "sheet-schedule-error",
        init: { ...withProject, responses: { saveSchedule: { status: "FAILED", error: { code: "INVALID", msg: "시작 시각이 올바르지 않아요." } } } },
        run: async (t) => {
            await t.click("#schedule-toggle");
            await t.wait(700);
            await t.click("#schedule-add");
            await t.wait(300);
            await t.click("#schedule-form button[type=submit]");
            await t.wait(300);
            await t.shot("error", "#schedule");
        }
    },
    {
        name: "overlay-dismiss",
        init: { ...withProject, accounts: ACCOUNTS, state: runningState() },
        run: async (t) => {
            const flags = async () => t.eval('JSON.stringify([...document.body.classList].filter((name) => name.endsWith("-open")))');

            await t.click("#settings-toggle");
            await t.wait(600);
            await t.note("settings-open", await flags());
            await t.press("Escape");
            await t.wait(600);
            await t.note("after-escape", await flags());
            await t.note("focus-after-escape", await t.eval("document.activeElement.id"));
            await t.click("#profile-toggle");
            await t.wait(600);
            await t.click("#settings-toggle");
            await t.wait(600);
            await t.note("swapped", await flags());
            await t.click("#titlebar .brand");
            await t.wait(300);
            await t.click(".course");
            await t.wait(600);
            await t.note("outside-click", await flags());
            await t.click("#live-panel");
            await t.wait(600);
            await t.click("#settings-toggle");
            await t.wait(600);
            await t.note("history-and-settings", await flags());
            await t.click(".scrim");
            await t.wait(600);
            await t.note("scrim", await flags());
            await t.click("#schedule-toggle");
            await t.wait(600);
            await t.click("#schedule-add");
            await t.press("Escape");
            await t.note("form-escape", await t.eval('JSON.stringify([document.body.classList.contains("schedule-open"), document.getElementById("schedule-form").hidden])'));
            await t.press("Escape");
            await t.wait(600);
            await t.note("sheet-escape", await flags());
            await t.shot("final", "", { skipDom: true });
        }
    }
];

module.exports = { SCENES };
