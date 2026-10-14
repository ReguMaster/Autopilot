const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HIDDEN_ARG = "--hidden";
const AUTOSTART_FILE_NAME = "autopilot.desktop";

// 순수 함수(buildDesktopEntry)를 Electron 없이 검증할 수 있도록 electron은 쓸 때 불러온다.
const getApp = () => {
    return require("electron").app;
};

// 포터블 exe와 AppImage는 실행마다 임시 위치에 풀리므로 원본 파일을 가리켜야 다음 로그인에도 켜진다.
const getLaunchPath = () => {
    return process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
};

const quoteExecArg = (value) => {
    return `"${String(value).replace(/(["`$\\])/g, "\\$1")}"`;
};

// freedesktop 자동 시작 항목. Exec의 경로는 공백을 위해 따옴표로 감싸고 특수 문자를 이스케이프한다.
const buildDesktopEntry = (launchPath) => {
    return ["[Desktop Entry]", "Type=Application", "Name=AutoPilot", `Exec=${quoteExecArg(launchPath)} ${HIDDEN_ARG}`, "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
};

const getAutostartFile = () => {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", AUTOSTART_FILE_NAME);
};

// 개발 실행(electron 바이너리)을 로그인 항목으로 등록하면 안 되므로 패키지 앱에서만 쓴다.
const isSupported = () => {
    return getApp().isPackaged;
};

const isEnabled = () => {
    if (!isSupported()) {
        return false;
    }

    if (process.platform === "linux") {
        return fs.existsSync(getAutostartFile());
    }

    return getApp().getLoginItemSettings({ path: getLaunchPath(), args: [HIDDEN_ARG] }).openAtLogin;
};

const setEnabled = (enabled) => {
    if (process.platform === "linux") {
        const file = getAutostartFile();

        if (enabled) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, buildDesktopEntry(getLaunchPath()), "utf8");
        } else {
            fs.rmSync(file, { force: true });
        }

        return;
    }

    getApp().setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, path: getLaunchPath(), args: [HIDDEN_ARG] });
};

// 로그인으로 켜졌으면 창을 띄우지 않고 트레이에만 둔다. macOS는 인자를 넘길 수 없어 시스템이 알려 주는 값을 본다.
const wasLaunchedHidden = () => {
    return process.argv.includes(HIDDEN_ARG) || (process.platform === "darwin" && getApp().getLoginItemSettings().wasOpenedAtLogin);
};

module.exports = { buildDesktopEntry, isSupported, isEnabled, setEnabled, wasLaunchedHidden, HIDDEN_ARG };
