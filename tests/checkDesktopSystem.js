import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildDesktopEntry, HIDDEN_ARG } = require("../desktop/launchAtLogin.cjs");
const { shouldNotify, getTransitionNotice, shouldBlockSleep } = require("../desktop/systemIntegration.cjs");
const { shouldRunPostAction, getPowerCommand, createPostAction, POST_RUN_ACTIONS } = require("../desktop/postAction.cjs");

// Linux 자동 시작 항목: 공백·특수 문자가 든 경로도 Exec에서 한 인자로 읽혀야 하고 창 없이 켜는 인자가 붙는다.
const checkDesktopEntry = () => {
    const entry = buildDesktopEntry("/opt/Auto Pilot/AutoPilot.AppImage");

    assert(entry.startsWith("[Desktop Entry]\n"));
    assert(entry.includes('Exec="/opt/Auto Pilot/AutoPilot.AppImage" --hidden\n'));
    assert(entry.includes("Type=Application\n"));
    assert(entry.endsWith("\n"));
    assert.equal(HIDDEN_ARG, "--hidden");

    const escaped = buildDesktopEntry('/home/a"b/$HOME/`x`\\y');

    assert(escaped.includes('Exec="/home/a\\"b/\\$HOME/\\`x\\`\\\\y" --hidden'));
};

// 알림: 종류별로 끄고 켜며, 창을 보고 있을 때는 따로 켠 경우에만 보낸다. 강제 종료는 알리지 않는다.
const checkNotifications = () => {
    const all = { notifyFinish: true, notifyFailure: true, notifyLimit: true, notifySchedule: true, notifyFocused: false };

    for (const kind of ["finish", "failure", "limit", "schedule"]) {
        assert.equal(shouldNotify(kind, all, false), true, `${kind}는 창을 보고 있지 않으면 보낸다`);
        assert.equal(shouldNotify(kind, all, true), false, `${kind}는 창을 보고 있으면 보내지 않는다`);
        assert.equal(shouldNotify(kind, { ...all, notifyFocused: true }, true), true);
    }

    assert.equal(shouldNotify("finish", { ...all, notifyFinish: false }, false), false);
    assert.equal(shouldNotify("failure", { ...all, notifyFinish: false }, false), true, "다른 종류 설정에 영향받지 않는다");
    assert.equal(shouldNotify("limit", { ...all, notifyLimit: false }, false), false);
    assert.equal(shouldNotify("schedule", { ...all, notifySchedule: false }, false), false);
    assert.equal(shouldNotify("unknown", all, false), false, "모르는 종류는 보내지 않는다");
    assert.equal(shouldNotify("finish", {}, false), false, "설정을 읽지 못하면 보내지 않는다");

    const running = { status: "running", phase: "" };
    const done = { status: "idle", phase: "", reason: "예정 시각 도달", exitCode: 0, round: 3 };

    assert.deepEqual(getTransitionNotice(running, done), { kind: "finish", title: "AutoPilot 종료", body: "예정 시각 도달 (3회차)" });
    assert.equal(getTransitionNotice(running, { ...done, exitCode: 1, reason: "연속 4회 실패로 중단" }).kind, "failure");
    assert.equal(getTransitionNotice(running, { ...done, reason: "강제 종료" }), null, "직접 강제 종료한 경우는 알리지 않는다");
    assert.equal(getTransitionNotice({ status: "idle", phase: "" }, done), null, "이미 끝난 뒤의 갱신은 알리지 않는다");

    const waiting = { status: "running", phase: "사용량 한도 대기 - 03:10까지" };

    assert.deepEqual(getTransitionNotice(running, waiting), { kind: "limit", title: "AutoPilot 대기 중", body: waiting.phase });
    assert.equal(getTransitionNotice(waiting, waiting), null, "대기 중인 동안 다시 알리지 않는다");
};

// 절전 방지: 실행 중일 때만, 설정(항상·전원 연결 때만·하지 않음)에 따라 막는다.
const checkSleepBlock = () => {
    assert.equal(shouldBlockSleep("running", "always", true), true);
    assert.equal(shouldBlockSleep("stopping", "always", false), true, "종료 신호 후 마무리 중에도 막는다");
    assert.equal(shouldBlockSleep("idle", "always", false), false, "실행 중이 아니면 막지 않는다");
    assert.equal(shouldBlockSleep("running", "plugged", false), true);
    assert.equal(shouldBlockSleep("running", "plugged", true), false, "배터리로 돌 때는 풀어 둔다");
    assert.equal(shouldBlockSleep("running", "never", false), false);
    assert.equal(shouldBlockSleep("running", undefined, true), true, "설정을 모르면 기존대로 항상 막는다");
};

// 끝난 뒤 PC 동작: 앱이 시작한 실행이 스스로 끝났을 때만, 사용자가 곁에 있는 끝(종료 신호·강제 종료·연결한 엔진)에는 하지 않는다.
const checkPostActionRules = () => {
    const done = { status: "idle", reason: "예정 시각 도달" };
    const base = { previousStatus: "running", state: done, action: "sleep", isOwned: true };

    assert.equal(shouldRunPostAction(base), true);
    assert.equal(shouldRunPostAction({ ...base, action: "shutdown" }), true);
    assert.equal(shouldRunPostAction({ ...base, previousStatus: "stopping" }), true, "마무리 중이던 실행도 끝나면 한다");
    assert.equal(shouldRunPostAction({ ...base, state: { status: "idle", reason: "연속 4회 실패로 중단" } }), true, "실패로 끝나도 자는 동안이므로 한다");
    assert.equal(shouldRunPostAction({ ...base, action: "none" }), false);
    assert.equal(shouldRunPostAction({ ...base, action: "reboot" }), false, "모르는 동작은 하지 않는다");
    assert.equal(shouldRunPostAction({ ...base, state: { status: "idle", reason: "강제 종료" } }), false);
    assert.equal(shouldRunPostAction({ ...base, state: { status: "idle", reason: "중단 요청" } }), false, "직접 종료 신호를 보냈으면 하지 않는다");
    assert.equal(shouldRunPostAction({ ...base, isOwned: false }), false, "연결한 엔진이면 하지 않는다");
    assert.equal(shouldRunPostAction({ ...base, previousStatus: "idle" }), false, "끝난 전환이 아니면 하지 않는다");
    assert.equal(shouldRunPostAction({ ...base, state: { status: "running", reason: "" } }), false);
    assert.deepEqual(POST_RUN_ACTIONS, ["none", "sleep", "shutdown"]);

    for (const platform of ["win32", "darwin", "linux"]) {
        for (const action of ["sleep", "shutdown"]) {
            const power = getPowerCommand(platform, action);

            assert(power.command && Array.isArray(power.args), `${platform} ${action}`);
        }
    }

    assert.deepEqual(getPowerCommand("win32", "shutdown"), { command: "shutdown.exe", args: ["/s", "/t", "0"] });
    assert.deepEqual(getPowerCommand("linux", "sleep"), { command: "systemctl", args: ["suspend"] });
    assert.equal(getPowerCommand("win32", "none"), null);
    assert.equal(getPowerCommand("freebsd", "sleep"), null);
};

// 기다리는 동안 취소할 수 있고, 시간이 되거나 바로 실행하면 한 번만 실행한다.
const checkPostActionController = async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const ran = [];
    const changes = [];
    const controller = createPostAction({ delayMs: 40, run: async (action) => ran.push(action), onChange: (pending) => changes.push(pending?.action ?? null) });

    assert.equal(controller.getPending(), null);

    controller.start("sleep");

    assert.equal(controller.getPending().action, "sleep");
    assert(controller.getPending().at > Date.now());

    controller.cancel();
    await wait(80);

    assert.deepEqual(ran, [], "취소하면 실행하지 않는다");
    assert.deepEqual(changes, ["sleep", null]);

    changes.length = 0;
    controller.start("shutdown");
    await wait(100);

    assert.deepEqual(ran, ["shutdown"], "시간이 되면 실행한다");
    assert.deepEqual(changes, ["shutdown", null]);
    assert.equal(controller.getPending(), null);

    controller.start("sleep");
    controller.start("shutdown");
    await controller.runNow();
    await controller.runNow();
    await wait(80);

    assert.deepEqual(ran, ["shutdown", "shutdown"], "다시 시작하면 앞의 기다림은 버리고, 바로 실행은 한 번만 한다");

    controller.cancel();
    await controller.runNow();

    assert.equal(ran.length, 2, "기다리는 것이 없으면 아무것도 하지 않는다");
};

checkDesktopEntry();
checkNotifications();
checkSleepBlock();
checkPostActionRules();
await checkPostActionController();

console.log("Desktop system checks passed.");
