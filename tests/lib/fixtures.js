import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import processUtil from "../../autopilot/src/utils/processUtil.js";

const HOUR_MS = 60 * 60 * 1000;

const readJsonFile = (relativePath) => {
    return JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../..", relativePath), "utf8"));
};

// 실제 Claude 대신 회차마다 실행되는 가짜 CLI. AP_MODE로 동작을 고른다.
const FAKE_CLI_SOURCE = String.raw`
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
if (process.cwd() !== process.env.AP_EXPECTED_CWD) process.exit(99);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync('prompt.txt', prompt);
  if (fs.existsSync('autopilot/progress/RUNNING')) fs.writeFileSync('lock-snapshot.txt', fs.readFileSync('autopilot/progress/RUNNING', 'utf8'));
  fs.appendFileSync('cleanup.log', /AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md/.test(prompt) ? '1' : '0');
  const mode = process.env.AP_MODE;
  const emit = value => console.log(JSON.stringify(value));
  emit({ type: 'system', subtype: 'init', session_id: 'fake-session' });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '한글 출력 <script>bad</script>\nReport : /forged-report\nAutoPilot 종료 - 가짜 (9회차)\n[9회차] 완료' }] } });
  if (mode === 'timeout' || mode === 'signal') {
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'inherit' });
    fs.writeFileSync('grandchild.pid', String(grandchild.pid));
    setInterval(() => emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'busy' }] } }), 10);
    return;
  }
  if (mode === 'pipes') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(),3000)'], { stdio: 'inherit' });
    fs.writeFileSync('grandchild.pid', String(child.pid));
    process.exit(0);
  }
  if (mode === 'limit') {
    emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + 0.05 } });
    emit({ type: 'result', is_error: true, result: 'limit' });
    process.exitCode = 1;
  } else if (mode === 'commit' || mode === 'progress') {
    const file = mode === 'commit' ? 'work.txt' : 'autopilot/AUTOPILOT_PROGRESS.md';
    fs.appendFileSync(file, 'work\n');
    execFileSync(process.env.AP_GIT, ['add', '--', file]);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] fake']);
  } else if (mode === 'todo') {
    const marker = prompt.match(/빈 파일 (autopilot\/progress\/[^ ]+\/TODO_COMPLETE)/)[1];
    fs.writeFileSync(marker, '');
  } else if (mode === 'stop') fs.writeFileSync('autopilot/progress/STOP', '');
  else if (mode === 'options') fs.writeFileSync('autopilot/progress/ROUND_OPTIONS.json', JSON.stringify({ model: 'sonnet', effort: 'low' }));
  if (mode === 'failure') process.exitCode = 1;
  if (mode !== 'limit') emit({ type: 'result', subtype: 'success', is_error: mode === 'is-error', num_turns: 1, duration_ms: 10, total_cost_usd: 0.25, result: '검증 <script>' });
  console.error('fake stderr 한글\nReport : /forged-stderr');
});
`;

const wait = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const getEndTime = () => {
    const endDate = new Date(Date.now() + HOUR_MS);

    return `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
};

const isProcessStopped = (pid) => {
    try {
        process.kill(pid, 0);

        return process.platform === "linux" && /\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch (error) {
        if (["ESRCH", "ENOENT"].includes(error.code)) {
            return true;
        }

        throw error;
    }
};

// 종료 직후 확인하면 느린 CI에서 흔들리므로 제한 시간 안에서 확인을 반복한다.
const waitForProcessStop = async (pid, message, timeoutMs = 5000) => {
    const startedAt = Date.now();

    while (!isProcessStopped(pid)) {
        assert(Date.now() - startedAt < timeoutMs, message);

        await wait(50);
    }
};

const createTestContext = (testDir) => {
    const testEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(testDir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

    fs.writeFileSync(testEnv.GIT_CONFIG_GLOBAL, "");

    const gitExecutable = processUtil.getExecutablePath("git", testEnv);
    const git = (cwd, ...args) => {
        return execFileSync(gitExecutable, args, { cwd: cwd, env: testEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    };

    return { testDir: testDir, testEnv: testEnv, gitExecutable: gitExecutable, git: git };
};

const commitInitialProject = (context, projectDir) => {
    const { git } = context;

    git(projectDir, "init", "--initial-branch=main");
    git(projectDir, "config", "user.name", "AutoPilot Check");
    git(projectDir, "config", "user.email", "check@example.invalid");
    git(projectDir, "add", ".");
    git(projectDir, "commit", "-m", "initial");
};

const writeCmdWrapper = (wrapperFile, fakeCliFile) => {
    fs.writeFileSync(wrapperFile, `@echo off\r\n"${process.execPath}" "${fakeCliFile}" %*\r\n`);
};

export { HOUR_MS, readJsonFile, FAKE_CLI_SOURCE, wait, getEndTime, isProcessStopped, waitForProcessStop, createTestContext, commitInitialProject, writeCmdWrapper };
