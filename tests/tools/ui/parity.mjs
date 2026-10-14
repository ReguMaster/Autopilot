// 기준(옛 화면)과 지금 화면을 같은 장면으로 띄워 비교한다.
//   node tests/tools/ui/parity.mjs [--baseline <git ref>] [--baseline-page index.html] [--page index.html] [--scenes a,b] [--reduced]
// 기준은 git ref의 desktop·docs를 임시 폴더에 풀어 쓴다. 기본은 HEAD다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "../../..");
const readArgument = (name, fallback = "") => {
    const index = process.argv.indexOf(`--${name}`);

    return index >= 0 ? process.argv[index + 1] : fallback;
};

const ref = readArgument("baseline", "HEAD");
const baselinePage = readArgument("baseline-page", "index.html");
const page = readArgument("page", "index.html");
const scenes = readArgument("scenes");
const isReduced = process.argv.includes("--reduced");
const electron = path.join(REPO, "node_modules/electron/dist/electron.exe");
const electronBinary = fs.existsSync(electron) ? electron : path.join(REPO, "node_modules/.bin/electron");
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-parity-"));
const baselineRoot = path.join(work, "baseline");

fs.mkdirSync(baselineRoot);

const archive = spawnSync("git", ["archive", ref, "desktop", "docs"], { cwd: REPO, maxBuffer: 256 * 1024 * 1024 });

if (archive.status !== 0) {
    console.error(archive.stderr.toString());
    process.exit(2);
}

const extract = spawnSync("tar", ["-x"], { cwd: baselineRoot, input: archive.stdout });

if (extract.status !== 0) {
    console.error(extract.stderr.toString());
    process.exit(2);
}

const toolDir = path.join(REPO, "tests/tools/ui");
const run = (script, args) => spawnSync(electronBinary, [path.join(toolDir, script), "--", ...args], { cwd: REPO, env: env, stdio: "inherit" });
const extra = [...(scenes ? ["--scenes", scenes] : []), ...(isReduced ? ["--reduced"] : [])];

console.log(`기준 ${ref}(${baselinePage}) ↔ 지금(${page})`);
run("runScenes.cjs", ["--root", baselineRoot, "--page", baselinePage, "--out", path.join(work, "A"), ...extra]);
run("runScenes.cjs", ["--root", REPO, "--page", page, "--out", path.join(work, "B"), ...extra]);

const isFull = process.argv.includes("--full");
const result = run("compareScenes.cjs", ["--a", path.join(work, "A"), "--b", path.join(work, "B"), ...(isFull ? [] : ["--ignore", "page"])]);

console.log(`결과 폴더: ${work}`);
process.exit(result.status ?? 1);
