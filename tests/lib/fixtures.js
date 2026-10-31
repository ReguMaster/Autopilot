import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import processUtil from "../../autopilot/src/utils/processUtil.js";

const HOUR_MS = 60 * 60 * 1000;

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
  // 보조로서 안·검토를 내는 Claude 호출은 읽기 도구(--tools=Read,Glob,Grep)로 받는다. 코드 블록으로 감싼 안이나 검토 목록을 JSON 결과로 내고 assist-claude.log에 남긴다.
  // AP_CLAUDE_ASSIST_FAIL=1이면 한도 오류로 끝난다.
  const toolsArg = process.argv.find(arg => arg.startsWith('--tools='));
  if (toolsArg && toolsArg !== '--tools=') {
    fs.appendFileSync('assist-claude.log', '---\n' + process.argv.slice(2).join(' ') + '\n' + prompt + '\n');
    if (process.env.AP_CLAUDE_ASSIST_FAIL === '1') {
      console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, session_id: '11111111-2222-3333-4444-555555555555', result: 'usage limit reached' }));
      process.exitCode = 1;
      return;
    }
    const answer = prompt.includes('검토자') ? '- Claude 검토: 빈자리 하나' : '\x60\x60\x60markdown\n# Claude 기획안\n\n1) 한 줄 요약\n\x60\x60\x60';
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: '11111111-2222-3333-4444-555555555555', result: answer }));
    return;
  }
  // 협의의 Claude 발언(도구 없는 짧은 호출)은 회차 세션과 따로 기록하고 JSON 한 줄로 답한다. AP_DEBATE=consensus면 바로 합의한다.
  // AP_DEBATE=improve면 첫 발언은 반대 없이 더 개선할 점을 남기고(합의라고 해도 합의가 아니다) 둘째 발언에서 더 고칠 것이 없다고 한다.
  if (process.argv.includes('--tools=')) {
    fs.appendFileSync('debate-claude.log', '---\n' + process.argv.slice(2).join(' ') + '\n' + prompt + '\n');
    const callCount = fs.readFileSync('debate-claude.log', 'utf8').split('---\n').length - 1;
    const turn = process.env.AP_DEBATE === 'consensus'
      ? { message: '좋아요, Codex 안의 화면 묶기를 받을게요.', agree: ['화면 묶기: 단계가 줄어요'], disagree: [], changes: ['화면을 4개로 줄여요'], consensus: true }
      : process.env.AP_DEBATE === 'improve'
        ? (callCount === 1
          ? { message: '결제 흐름을 더 보강하면 좋겠어요.', agree: ['범위: 맞아요'], disagree: [], improve: ['결제 흐름 보강'], changes: [], consensus: true }
          : { message: '이제 더 고칠 것이 없어요.', agree: ['보강: 반영됐어요'], disagree: [], improve: [], changes: [], consensus: true })
        : { message: '저는 결제를 넣지 않는 쪽이 맞다고 봐요.\n줄바꿈도 한 줄로 펴져야 해요.', agree: [], disagree: [{ point: '결제 넣기', reason: '이번 범위가 아니에요' }], changes: [], consensus: false };
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: '11111111-2222-3333-4444-555555555555', result: '답이에요.\n' + JSON.stringify(turn) }));
    return;
  }
  fs.writeFileSync('prompt.txt', prompt);
  if (fs.existsSync('.autopilot/progress/RUNNING')) fs.writeFileSync('lock-snapshot.txt', fs.readFileSync('.autopilot/progress/RUNNING', 'utf8'));
  fs.appendFileSync('cleanup.log', /AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md/.test(prompt) ? '1' : '0');
  const mode = process.env.AP_MODE;
  const emit = value => console.log(JSON.stringify(value));
  emit({ type: 'system', subtype: 'init', session_id: 'fake-session' });
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: '한글 출력 <script>bad</script>\nReport : /forged-report\nAutoPilot 종료 - 가짜 (9회차)\n[9회차] 완료\n[커밋] deadbee +1 -0 가짜\n성과: 응답 시간 1초 → 0.5초' }] } });
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
  if (mode.startsWith('limit')) {
    emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + (mode === 'limit-long' ? 1.5 : 0.05) } });
    emit({ type: 'result', is_error: true, result: 'limit' });
    process.exitCode = 1;
  } else if (mode === 'commit') {
    fs.appendFileSync('work.txt', 'work\n');
    execFileSync(process.env.AP_GIT, ['add', '--', 'work.txt']);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] fake']);
  } else if (mode === 'linked-only') {
    // 연결 저장소(작업 프로젝트와 같은 상위 폴더의 'linked repo')에만 commit해, 연결 저장소의 변경도 idle로 보지 않는지 본다.
    const linkedDir = path.join(process.cwd(), '..', 'linked repo');
    fs.appendFileSync(path.join(linkedDir, 'work.txt'), 'work\n');
    execFileSync(process.env.AP_GIT, ['add', '--', 'work.txt'], { cwd: linkedDir });
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] linked fake'], { cwd: linkedDir });
  } else if (mode === 'progress') {
    // 진행 기록은 저장소 밖에 있으므로 갱신만 하고 commit이 없어 idle이다.
    fs.appendFileSync(process.env.AP_PROGRESS_FILE, 'work\n');
  } else if (mode === 'regrow') {
    // 1회차에는 기록을 줄이고 2회차에는 다시 늘려, 줄 수 확인이 회차마다 이뤄지는지 본다. cleanup.log의 길이가 회차 번호다.
    const lineCount = fs.readFileSync('cleanup.log', 'utf8').length === 2 ? 150 : 10;
    fs.writeFileSync(process.env.AP_PROGRESS_FILE, Array.from({ length: lineCount }, (_, index) => index + ' 기록').join('\n') + '\n');
    fs.appendFileSync('work.txt', 'work\n');
    execFileSync(process.env.AP_GIT, ['add', '--', 'work.txt']);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] fake']);
  } else if (mode === 'todo') {
    const marker = prompt.match(/빈 파일 (\.autopilot\/progress\/[^ ]+\/TODO_COMPLETE)/)[1];
    fs.writeFileSync(marker, '');
  } else if (mode === 'build') {
    // 단계마다 commit 하나와 단계 완료 신호를 남긴다. AP_QA_FAILS·AP_SECURITY_FAILS번째까지의 테스트/QA·보안검토는 fail을 쓴다.
    fs.appendFileSync('work.txt', 'phase\n');
    execFileSync(process.env.AP_GIT, ['add', '--', 'work.txt']);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] phase']);
    // 협의를 정리하는 회차는 쟁점 파일을 쓴다. 형식이 틀린 항목은 엔진이 걸러야 한다.
    // AP_DISPUTES=once면 첫 정리 회차만, always면 매번 배열이 아닌 JSON을 쓴다.
    if (prompt.includes('협의가 끝났다')) {
      const disputes = ['consensus', 'improve'].includes(process.env.AP_DEBATE) ? [] : [{ title: '결제', claude: '이번엔 빼요', codex: '카드 결제를 넣어요' }, { title: '화면 수', claude: '6개', codex: '4개' }, { title: '' }];
      const isBroken = process.env.AP_DISPUTES === 'always' || (process.env.AP_DISPUTES === 'once' && !prompt.includes('읽을 수 없었다'));
      fs.writeFileSync('docs/autopilot/proposals/plan-disputes.json', JSON.stringify(isBroken ? { disputes: disputes } : disputes));
    }
    const marker = prompt.match(/파일 \x60(\.autopilot\/progress\/[^\x60]+\/PHASE_DONE)\x60/)[1];
    let phaseResult = 'pass';
    for (const [label, countFile, failCount] of [['테스트/QA', 'qa-count.txt', process.env.AP_QA_FAILS], ['보안검토', 'security-count.txt', process.env.AP_SECURITY_FAILS]]) {
      if (!prompt.includes('지금 단계는 [' + label + ']')) continue;
      const count = (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0) + 1;
      fs.writeFileSync(countFile, String(count));
      if (count <= Number(failCount || 0)) phaseResult = 'fail';
    }
    fs.writeFileSync(marker, phaseResult + '\n');
  } else if (mode === 'stop') fs.writeFileSync('.autopilot/progress/STOP', '');
  else if (mode === 'options') fs.writeFileSync('.autopilot/progress/ROUND_OPTIONS.json', JSON.stringify({ model: 'sonnet', effort: 'low' }));
  else if (mode === 'to-codex') {
    // 다음 회차부터 Codex가 돌도록 바꾸고 commit해 idle로 끝나지 않게 한다.
    fs.writeFileSync('.autopilot/progress/ROUND_OPTIONS.json', JSON.stringify({ runner: 'codex', codexEffort: 'low' }));
    fs.appendFileSync('work.txt', 'claude\n');
    execFileSync(process.env.AP_GIT, ['add', '--', 'work.txt']);
    execFileSync(process.env.AP_GIT, ['commit', '-m', '[ap] claude']);
  }
  if (mode === 'failure') process.exitCode = 1;
  if (!mode.startsWith('limit')) emit({ type: 'result', subtype: 'success', is_error: mode === 'is-error', num_turns: 1, duration_ms: 10, total_cost_usd: 0.25, result: '검증 <script>' });
  console.error('fake stderr 한글\nReport : /forged-stderr');
});
`;

// 실제 Codex 대신 쓰는 가짜 codex. login status는 AP_CODEX_LOGIN=0이면 실패하고, exec는 받은 프롬프트를 AP_CODEX_LOG에 남긴 뒤
// 검토 요청이면 목록을, 아니면 코드 블록으로 감싼 안을 stdout으로 낸다. AP_CODEX_FAIL=1이면 한도 오류로 끝난다.
// --json이면 회차 실행이다. JSONL 이벤트를 내고 commit하며, AP_CODEX_ROUND=limit이면 사용량 한도로 실패한다.
const FAKE_CODEX_SOURCE = String.raw`
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "login") process.exit(process.env.AP_CODEX_LOGIN === "0" ? 1 : 0);
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (prompt += chunk));
process.stdin.on("end", () => {
  fs.appendFileSync(process.env.AP_CODEX_LOG, "---\n" + args.join(" ") + "\n" + prompt + "\n");
  if (args.includes("--json")) {
    if (process.cwd() !== process.env.AP_EXPECTED_CWD) process.exit(99);
    const emit = (value) => console.log(JSON.stringify(value));
    emit({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" });
    emit({ type: "turn.started" });
    emit({ type: "item.started", item: { id: "item_0", type: "command_execution", command: "bash -lc 'npm test'", status: "in_progress" } });
    emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "한글 출력 Codex\n성과: 응답 시간 1초 → 0.5초" } });
    if (process.env.AP_CODEX_ROUND === "limit") {
      emit({ type: "turn.failed", error: { message: "You've hit your usage limit." } });
      process.exit(1);
    }
    fs.appendFileSync("work.txt", "codex\n");
    execFileSync(process.env.AP_GIT, ["add", "--", "work.txt"]);
    execFileSync(process.env.AP_GIT, ["commit", "-m", "[ap] codex"]);
    // AP_CODEX_ROUND=build면 신규 개발의 한 단계를 마친다: 협의를 정리하는 회차는 쟁점 파일을 쓰고, 단계 완료 신호를 남긴다.
    if (process.env.AP_CODEX_ROUND === "build") {
      if (prompt.includes("협의가 끝났다")) fs.writeFileSync("docs/autopilot/proposals/plan-disputes.json", JSON.stringify([{ title: "결제", claude: "이번엔 빼요", codex: "카드 결제를 넣어요" }]));
      fs.writeFileSync(prompt.match(/파일 \x60(\.autopilot\/progress\/[^\x60]+\/PHASE_DONE)\x60/)[1], "pass\n");
    }
    emit({ type: "item.completed", item: { id: "item_2", type: "file_change", changes: [{ path: "work.txt", kind: "update" }] } });
    emit({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } });
    return;
  }
  if (process.env.AP_CODEX_FAIL === "1") {
    console.error("progress\nusage limit reached");
    process.exit(1);
  }
  // 협의 발언. 세션 아이디를 stderr 머리말에 남기고(AP_CODEX_NO_SESSION=1이면 안 남김) AP_CODEX_DEBATE_FAIL_AT번째 발언에서 실패한다.
  // AP_CODEX_DEBATE_STOP_AT번째 발언에서는 중단 요청을 남기고 엔진이 끝낼 때까지 답하지 않고, AP_CODEX_DEBATE_BAD_AT번째 발언은 따옴표를 풀지 않아 JSON으로 읽을 수 없는 답을 낸다.
  if (prompt.includes("협의에 참여한 Codex") || args[1] === "resume") {
    const turnsFile = process.env.AP_CODEX_LOG + ".turns";
    const turn = (fs.existsSync(turnsFile) ? Number(fs.readFileSync(turnsFile, "utf8")) : 0) + 1;
    fs.writeFileSync(turnsFile, String(turn));
    if (Number(process.env.AP_CODEX_DEBATE_FAIL_AT || 0) === turn) {
      console.error("usage limit reached");
      process.exit(1);
    }
    if (Number(process.env.AP_CODEX_DEBATE_STOP_AT || 0) === turn) {
      fs.writeFileSync(".autopilot/progress/STOP", "");
      setTimeout(() => process.exit(1), 30000);
      return;
    }
    if (process.env.AP_CODEX_NO_SESSION !== "1") console.error("OpenAI Codex\nsession id: 01a18d02-d1e7-7b20-831e-d85c25a2b4f2\n--------");
    if (Number(process.env.AP_CODEX_DEBATE_BAD_AT || 0) === turn) {
      console.log('{"message": "결제는 "처음부터" 넣어요", "consensus": false}');
      return;
    }
    console.log(JSON.stringify(process.env.AP_DEBATE === "consensus"
      ? { message: "저도 같은 생각이에요.", agree: ["범위: 맞아요"], disagree: [], changes: [], consensus: true }
      : process.env.AP_DEBATE === "improve"
        ? { message: "좋아요, 결제 흐름을 반영할게요.", agree: ["결제 흐름: 필요해요"], disagree: [], improve: [], changes: ["결제 흐름 보강"], consensus: true }
      : { message: "결제는 처음부터 넣는 게 좋아요.", agree: [], disagree: [{ point: "결제 빼기", reason: "노쇼를 막아요" }], changes: [], consensus: false }));
    return;
  }
  // AP_CODEX_SLOW=ms이면 실제 Codex처럼 stderr에 한 일을 남기고 그만큼 늦게 답한다.
  const delay = Number(process.env.AP_CODEX_SLOW || 0);
  if (delay) console.error("exec\nls in .\ncodex\n파일을 읽고 있어요");
  setTimeout(() => console.log(prompt.includes("검토자") ? "- Codex 검토: 빈자리 하나" : "\x60\x60\x60markdown\n# Codex 기획안\n\n1) 한 줄 요약\n\x60\x60\x60"), delay);
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

export { HOUR_MS, FAKE_CLI_SOURCE, FAKE_CODEX_SOURCE, wait, getEndTime, isProcessStopped, waitForProcessStop, createTestContext, commitInitialProject, writeCmdWrapper };
