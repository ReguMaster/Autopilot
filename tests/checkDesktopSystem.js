import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildDesktopEntry, HIDDEN_ARG } = require("../desktop/launchAtLogin.cjs");

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

checkDesktopEntry();

console.log("Desktop system checks passed.");
