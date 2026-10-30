import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STATUS_FAILED, PROGRESS_MAX_LINES } from "../../autopilot/src/utils/config.js";
import { runAutopilot } from "../../autopilot/src/services/autopilotService.js";
import settingsUtil from "../../autopilot/src/utils/settingsUtil.js";
import cliUtil from "../../autopilot/src/utils/cliUtil.js";
import progressUtil from "../../autopilot/src/utils/progressUtil.js";
import streamUtil from "../../autopilot/src/utils/streamUtil.js";
import autopilotUtil from "../../autopilot/src/utils/autopilotUtil.js";
import gitUtil from "../../autopilot/src/utils/gitUtil.js";
import processUtil from "../../autopilot/src/utils/processUtil.js";
import phaseUtil from "../../autopilot/src/utils/phaseUtil.js";
import { getAutopilotGuide, getAutopilotPolicy } from "../../autopilot/src/utils/guideText.js";
import promptUtil from "../../autopilot/src/utils/promptUtil.js";

const BOM = String.fromCodePoint(0xfeff);

const checkInvalidProject = async (context, errorMessages) => {
    for (const projectDir of [path.join(context.testDir, "missing"), undefined]) {
        const invalidRunResult = await runAutopilot({ projectDir: projectDir });

        assert.equal(invalidRunResult.status, STATUS_FAILED);
        assert.equal(invalidRunResult.error.code, "AUTOPILOT_ERROR");
        assert.equal(invalidRunResult.data, undefined);
    }

    assert(errorMessages.some((message) => message.includes("프로젝트 폴더를 찾지 못했습니다")));

    // 없는 프로젝트에는 작업 폴더를 만들지 않는다.
    assert(!fs.existsSync(path.join(context.testDir, "missing")));
};

const checkRunSettings = () => {
    const { getRunSettings } = settingsUtil;
    const now = new Date(2026, 9, 8, 12, 0, 0);
    const runSettings = getRunSettings("16:30", "지시개선", now);

    assert.equal(runSettings.deadline.getHours(), 16);
    assert.equal(runSettings.deadline.getMinutes(), 30);
    assert.equal(runSettings.policy, "지시개선");
    assert.equal(runSettings.endSource, "실행 인자");
    assert.equal(getRunSettings("07:00", "", now).deadline.getDate(), 9);
    assert.equal(getRunSettings("23:00", "AUTO", now).policy, "자율개선");

    const defaultSettings = getRunSettings("", "", now);

    assert.equal(defaultSettings.deadline.getHours(), 7);
    assert.equal(defaultSettings.policy, "자율개선");
    assert.equal(defaultSettings.endSource, "기본값");
    assert.equal(defaultSettings.policySource, "기본값");

    for (const invalidEndTime of ["24:00", "12:60", "1:00", "nope", "오후 4시"]) {
        assert.throws(() => getRunSettings(invalidEndTime));
    }

    // 날짜를 붙이면 그 날짜의 시각이고, 지난 시각·없는 날짜·7일 넘게 뒤·형식 오류는 거부한다.
    const datedSettings = getRunSettings("2026-10-12 07:00", "", now);

    assert.equal(datedSettings.deadline.getDate(), 12);
    assert.equal(datedSettings.deadline.getHours(), 7);
    assert.equal(getRunSettings("2026-10-15 12:00", "", now).deadline.getDate(), 15);

    for (const invalidEndTime of ["2026-10-08 11:00", "2026-02-30 07:00", "2026-10-15 12:01", "2026-10-9 07:00", "2026-10-09T07:00"]) {
        assert.throws(() => getRunSettings(invalidEndTime));
    }

    assert.throws(() => getRunSettings("", "not-todo"));
    assert.throws(() => getRunSettings("", "constructor"));

    // 커밋 접두어와 작업 브랜치: 기본값이 있고, 지침과 git 이름으로 쓸 수 없는 값은 거부한다.
    const { getGitSettings } = settingsUtil;

    assert.deepEqual(getGitSettings(), { commitPrefix: "[ap]", workBranch: "ai/autopilot" });
    assert.deepEqual(getGitSettings("chore(ai):", "bot/work-1.2"), { commitPrefix: "chore(ai):", workBranch: "bot/work-1.2" });

    for (const invalidPrefix of ["", " x", "x ", "a`b", "x".repeat(21), "--x", "a\nb", "a\u0000b"]) {
        assert.throws(() => getGitSettings(invalidPrefix), /커밋 접두어/, JSON.stringify(invalidPrefix));
    }

    for (const invalidBranch of ["", "main", "Master", "HEAD", "a..b", "/a", "a/", "a//b", "-a", "a b", "x.lock", "a/b.lock", "a.", ".a", "a/.b", "a".repeat(101), "한글", "a;rm", "a@{1}"]) {
        assert.throws(() => getGitSettings(undefined, invalidBranch), /작업 브랜치/, invalidBranch);
    }

    for (const validBranch of ["ai/autopilot", "bot", "feature/x-1.2", "a_b", "A1/b2/c3"]) {
        assert.equal(getGitSettings(undefined, validBranch).workBranch, validBranch);
    }
};

const checkCommandArgs = () => {
    const { parseRunArgs, parseProjectArgs, parseSetArgs } = cliUtil;
    const project = ["--project", "C:\\work\\demo project"];

    assert.deepEqual(parseRunArgs([...project, "--end-time", "07:00", "--policy", "todo", "--tasks-file", "t.md", "--model", "sonnet", "--effort", "max", "--no-open"]), {
        projectDir: "C:\\work\\demo project",
        endTime: "07:00",
        policy: "todo",
        tasksFile: "t.md",
        model: "sonnet",
        effort: "max",
        open: false
    });
    assert.equal(parseRunArgs([...project, "--model", "claude-opus-4-8"]).model, "claude-opus-4-8");
    assert.equal(parseRunArgs(project).open, undefined);
    assert.equal(parseRunArgs(project).extendOnLimit, undefined);
    assert.equal(parseRunArgs(project).maxExtendMinutes, undefined);
    assert.equal(parseRunArgs(project).logRetentionDays, undefined);
    assert.equal(parseRunArgs([...project, "--log-retention-days", "7"]).logRetentionDays, 7);

    for (const invalidDays of ["0", "-1", "abc", "1.5", "7일", "3651"]) {
        assert.throws(() => parseRunArgs([...project, "--log-retention-days", invalidDays]), /log-retention-days/, invalidDays);
    }

    assert.throws(() => parseRunArgs([...project, "--log-retention-days"]));
    assert.deepEqual(parseRunArgs([...project, "--commit-prefix", "chore(ai):", "--branch", "bot/work"]), { projectDir: "C:\\work\\demo project", commitPrefix: "chore(ai):", workBranch: "bot/work" });
    assert.throws(() => parseRunArgs([...project, "--branch", "main"]), /작업 브랜치/);
    assert.throws(() => parseRunArgs([...project, "--commit-prefix", "a`b"]), /커밋 접두어/);
    assert.throws(() => parseRunArgs([...project, "--branch"]));
    assert.equal(parseRunArgs([...project, "--extend-on-limit", "--max-extend-minutes", "90"]).maxExtendMinutes, 90);

    // --link-project는 여러 번 쓸 수 있지만 연결 저장소는 2개(작업 프로젝트를 합쳐 3개)까지다.
    assert.deepEqual(parseRunArgs([...project, "--link-project", "C:\work\api", "--link-project", "C:\work\web"]).linkedProjectDirs, ["C:\work\api", "C:\work\web"]);
    assert.throws(() => parseRunArgs([...project, "--link-project", "a", "--link-project", "b", "--link-project", "c"]), /2개까지/);
    assert.throws(() => parseRunArgs([...project, "--link-project"]));

    for (const invalidMinutes of ["0", "-5", "abc", "1.5", "90분", "10081", "1e3"]) {
        assert.throws(() => parseRunArgs([...project, "--max-extend-minutes", invalidMinutes]), /max-extend-minutes/, invalidMinutes);
    }

    assert.throws(() => parseRunArgs([...project, "--max-extend-minutes"]));
    assert.deepEqual(parseRunArgs([...project, "--extend-on-limit", "--no-open"]), { projectDir: "C:\\work\\demo project", open: false, extendOnLimit: true });

    // 프로젝트가 없거나 위치 인자·알 수 없는 인자·잘못된 값은 거부한다. 이전 형식(HH:mm todo 위치 인자)은 더 받지 않는다.
    assert.throws(() => parseRunArgs([]), /--project/);
    assert.throws(() => parseRunArgs(["23:00", "todo", ...project]), /알 수 없는 인자/);
    assert.throws(() => parseRunArgs([...project, "--unknown"]), /알 수 없는 인자/);
    assert.throws(() => parseRunArgs([...project, "--effort", "high & echo bad"]));
    assert.throws(() => parseRunArgs([...project, "--model", "gpt"]), /model/);
    assert.throws(() => parseRunArgs([...project, "--model", "claude-opus & echo bad"]), /model/);
    assert.throws(() => parseRunArgs([...project, "--model", "claude-"]), /model/);
    assert.throws(() => parseRunArgs([...project, "--model"]));
    assert.throws(() => parseRunArgs(["--project", "--no-open"]));

    assert.deepEqual(parseProjectArgs(project), { projectDir: "C:\\work\\demo project" });
    assert.throws(() => parseProjectArgs([]), /--project/);
    assert.throws(() => parseProjectArgs([...project, "extra"]), /알 수 없는 인자/);
    assert.throws(() => parseProjectArgs([...project, "--model", "opus"]), /알 수 없는 인자/);

    assert.deepEqual(parseSetArgs([...project, "--model", "haiku", "--effort", "low"]), { projectDir: "C:\\work\\demo project", model: "haiku", effort: "low" });
    assert.equal(parseSetArgs([...project, "--model", "claude-sonnet-4-6"]).model, "claude-sonnet-4-6");
    assert.deepEqual(parseSetArgs([...project, "--effort", "xhigh"]), { projectDir: "C:\\work\\demo project", effort: "xhigh" });

    for (const invalidArgs of [[], project, [...project, "--no-open"], [...project, "23:00"], [...project, "--model", "gpt"], [...project, "--effort", "extreme"], [...project, "--model"]]) {
        assert.throws(() => parseSetArgs(invalidArgs), undefined, `set ${invalidArgs.join(" ")}`);
    }

    // 신규 개발 인자: 목록은 쉼표로 고르고, 테스트/QA·보안검토 실패 처리는 되돌릴 횟수(stop은 0)로 바꾼다. 유지 보수 모드에는 줄 수 없다.
    assert.deepEqual(
        parseRunArgs([...project, "--mode", "build", "--gate", "plan,design", "--allow", "deps,send", "--design-format", "figma", "--qa-on-fail", "retry:2", "--security-on-fail", "retry:4"]),
        {
            projectDir: "C:\\work\\demo project",
            mode: "build",
            gates: ["plan", "design"],
            allow: ["deps", "send"],
            designFormat: "figma",
            maxQaRetries: 2,
            maxSecurityRetries: 4
        }
    );
    assert.equal(parseRunArgs([...project, "--mode", "build", "--qa-on-fail", "stop"]).maxQaRetries, 0);
    assert.equal(parseRunArgs([...project, "--mode", "build", "--security-on-fail", "stop"]).maxSecurityRetries, 0);
    assert.equal(parseRunArgs([...project, "--mode", "maintain"]).mode, "maintain");

    for (const invalidArgs of [
        ["--mode", "fast"],
        ["--gate", "plan"],
        ["--mode", "maintain", "--allow", "deps"],
        ["--mode", "build", "--gate", "build"],
        ["--mode", "build", "--gate", "plan,plan"],
        ["--mode", "build", "--allow", "deps,"],
        ["--mode", "build", "--design-format", "pdf"],
        ["--mode", "build", "--qa-on-fail", "retry:0"],
        ["--mode", "build", "--qa-on-fail", "retry:6"],
        ["--mode", "build", "--qa-on-fail", "again"],
        ["--security-on-fail", "retry:1"],
        ["--mode", "maintain", "--security-on-fail", "stop"],
        ["--mode", "build", "--security-on-fail", "retry:6"],
        ["--mode", "build", "--security-on-fail"]
    ]) {
        assert.throws(() => parseRunArgs([...project, ...invalidArgs]), undefined, invalidArgs.join(" "));
    }

    assert.deepEqual(parseProjectArgs(project), { projectDir: "C:\\work\\demo project" });
};

// 단계 전환: 확인받기로 둔 단계에서 멈추고, 테스트/QA·보안검토 실패는 단계마다 정한 횟수까지 개발로 되돌린다.
const checkPhaseRules = (context) => {
    const { getPhaseTransition, getStartPhase, readPhase, isPhaseState } = phaseUtil;
    const plan = { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0 };
    const limits = { qa: 3, security: 2 };

    assert.deepEqual(getPhaseTransition(plan, "pass", [], limits), { state: { ...plan, phase: "design" }, event: "next" });
    assert.deepEqual(getPhaseTransition(plan, "", ["plan"], limits), { state: { ...plan, phase: "design", awaiting: "plan" }, event: "await" });
    assert.equal(getPhaseTransition({ ...plan, phase: "build" }, "fail", ["plan", "design"], limits).event, "next");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 1 }, "fail", [], limits), { state: { ...plan, phase: "build", qaRetries: 2 }, event: "retry" });
    assert.equal(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 3 }, "fail", [], limits).event, "failed");
    assert.equal(getPhaseTransition({ ...plan, phase: "qa" }, "fail", [], { qa: 0, security: 3 }).event, "failed");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 2 }, "pass", [], limits), { state: { ...plan, phase: "security", qaRetries: 2 }, event: "next" });

    // 보안검토는 테스트/QA와 따로 센다. 테스트/QA를 다 써도 보안검토는 자기 횟수만큼 되돌린다.
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "security", qaRetries: 3 }, "fail", [], limits), { state: { ...plan, phase: "build", qaRetries: 3, securityRetries: 1 }, event: "retry" });
    assert.equal(getPhaseTransition({ ...plan, phase: "security", securityRetries: 2 }, "fail", [], limits).event, "failed");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "security", securityRetries: 1 }, "pass", [], limits), { state: { ...plan, phase: "done", securityRetries: 1 }, event: "done" });

    // 승인 없이 다시 시작하면 확인을 기다리던 단계를 다시 한다.
    assert.deepEqual(getStartPhase({ ...plan, phase: "design", awaiting: "plan" }), { state: plan, isRevision: true });
    assert.deepEqual(getStartPhase(plan), { state: plan, isRevision: false });

    assert.equal(phaseUtil.parseOnFail("retry:5"), 5);
    assert.equal(phaseUtil.parseOnFail("retry:05"), 5);
    assert.equal(phaseUtil.parseOnFail("stop"), 0);
    assert.equal(phaseUtil.parseOnFail("Retry:1"), null);
    assert(!isPhaseState({ ...plan, awaiting: "qa" }));
    assert(!isPhaseState({ ...plan, qaRetries: -1 }));
    assert(!isPhaseState({ ...plan, securityRetries: 1.5 }));
    assert.deepEqual(readPhase(path.join(path.sep, "missing", "PHASE.json")), plan);

    // 보안검토가 생기기 전에 쓴 PHASE.json(securityRetries 없음)도 그대로 이어받는다.
    const oldPhaseFile = path.join(context.testDir, "old-phase", "PHASE.json");

    fs.mkdirSync(path.dirname(oldPhaseFile), { recursive: true });
    fs.writeFileSync(oldPhaseFile, JSON.stringify({ phase: "qa", awaiting: null, qaRetries: 2 }));
    assert.deepEqual(readPhase(oldPhaseFile), { phase: "qa", awaiting: null, qaRetries: 2, securityRetries: 0 });
    fs.writeFileSync(oldPhaseFile, "null");
    assert.deepEqual(readPhase(oldPhaseFile), plan);

    // 신규 개발의 허용 체크만 정책에 덧붙는다. 보내기를 켜지 않았으면 외부 도구 금지를 덧붙인다.
    assert.equal(getAutopilotPolicy("ai/autopilot"), getAutopilotPolicy("ai/autopilot", null));
    assert.doesNotMatch(getAutopilotPolicy("ai/autopilot"), /신규 개발에서 이번 실행에 허용한 것/);
    assert.match(getAutopilotPolicy("ai/autopilot", ["deps"]), /새 dependency 추가를 허용한다[\s\S]*외부 도구\(Codex, MCP 서버/);
    assert.doesNotMatch(getAutopilotPolicy("ai/autopilot", ["send"]), /외부 도구\(Codex, MCP 서버/);
    assert.match(getAutopilotPolicy("ai/autopilot", []), /완화한 정책이 없다/);

    // 단계마다 같은 틀과 그 단계의 산출물이 <PHASE>로 들어가고, 신규 개발에는 유지 보수용 작업 수 · 작업 탐색 · 개선 정책이 없다.
    const buildState = {
        mode: "build",
        phase: "plan",
        qaRetries: 0,
        securityRetries: 0,
        isRevision: false,
        designFormat: "html",
        allow: [],
        tasks: "만들 것",
        policy: "자율개선",
        projectDir: context.testDir,
        repos: [],
        progressFile: "progress.md",
        deadline: new Date(2026, 10, 2, 7, 0),
        commitPrefix: "[ap]",
        workBranch: "ai/autopilot",
        phaseDoneRelPath: ".autopilot/progress/2026-10-30/PHASE_DONE"
    };
    const phaseArtifacts = { plan: "docs/autopilot/brief.md", design: "docs/autopilot/design.md", build: "CLAUDE.md", qa: "docs/autopilot/qa.md", security: "docs/autopilot/security.md" };

    for (const [phase, artifact] of Object.entries(phaseArtifacts)) {
        const prompt = promptUtil.getRoundPrompt({ ...buildState, phase: phase }, 1, 60, "", 2);
        const phaseBlock = /<PHASE>\n([\s\S]*?)\n<\/PHASE>/.exec(prompt)[1];

        for (const heading of ["단계:", "관점:", "읽을 것:", "산출물:", "회차당 작업:", "완료 기준:", "하지 않을 것:", "완료 신호:"]) {
            assert.match(phaseBlock, new RegExp(`^${heading}`, "m"), `${phase} ${heading}`);
        }

        assert(phaseBlock.includes(artifact), `${phase} ${artifact}`);
        assert(phaseBlock.includes("파일 `.autopilot/progress/2026-10-30/PHASE_DONE`"));
        assert.equal(phaseBlock.includes("`fail`"), ["qa", "security"].includes(phase), phase);
        assert.doesNotMatch(prompt, /작업은 최대|작업 탐색과 선택|개선 정책/, phase);
    }

    assert.match(promptUtil.getRoundPrompt({ ...buildState, phase: "build", securityRetries: 1 }, 1, 60, "", 2), /테스트\/QA · 보안검토가 되돌린 것이다/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...buildState, phase: "build" }, 1, 60, "", 2), /되돌린 것이다/);

    const maintainPrompt = promptUtil.getRoundPrompt({ ...buildState, mode: "maintain" }, 1, 60, "", 2);

    assert.match(maintainPrompt, /작업은 최대 2건/);
    assert(maintainPrompt.includes(getAutopilotGuide("[ap]")));
    assert(!maintainPrompt.includes("<PHASE>"));

    // 신규 개발 지침은 유지 보수용 절만 바꾸고 나머지 절은 글자 하나 다르지 않다.
    const getSections = (guide) => new Map(guide.split(/\n(?=## )/).map((section) => [section.split("\n")[0], section.trimEnd()]));
    const maintainSections = getSections(getAutopilotGuide("[ap]"));
    const buildSections = getSections(getAutopilotGuide("[ap]", "build"));

    assert.equal(getAutopilotGuide("[ap]"), getAutopilotGuide("[ap]", "maintain"));

    for (const heading of ["## 완전 무인 실행", "## 회차 실행", "## 작업 진행 기록", "## 진행 문장", "## 구현", "## 검증", "## Commit", "## 작업 중단", "## Token Limit"]) {
        assert.equal(buildSections.get(heading), maintainSections.get(heading), heading);
    }

    assert(buildSections.has("## 신규 개발 단계") && buildSections.has("## 단계 안에서 일 고르기") && !buildSections.has("## 개선 정책"));
    assert.match(buildSections.get("## 작업 시작"), /소유자가 적은 만들 것/);
};

const checkClaudeArgs = async () => {
    const { getClaudeArgs } = autopilotUtil;
    const getValue = (args, flag) => args[args.indexOf(flag) + 1];

    assert.equal(getValue(getClaudeArgs(), "--model"), "opus");
    assert.equal(getValue(getClaudeArgs(), "--effort"), "high");
    assert.equal(getValue(getClaudeArgs(), "--fallback-model"), "sonnet");
    assert.equal(getValue(getClaudeArgs({ model: "haiku", effort: "max" }), "--effort"), "max");

    // 연결 저장소는 --add-dir로 세션에 붙이고, 없으면 인자를 더하지 않는다.
    assert(!getClaudeArgs().includes("--add-dir"));
    assert.deepEqual(
        getClaudeArgs({ addDirs: ["/a", "/b"] }).filter((arg, index, args) => arg === "--add-dir" || args[index - 1] === "--add-dir"),
        ["--add-dir", "/a", "--add-dir", "/b"]
    );

    // 특정 버전의 모델 ID도 그대로 넘기고 fallback은 별칭으로 둔다.
    assert.equal(getValue(getClaudeArgs({ model: "claude-opus-4-8" }), "--model"), "claude-opus-4-8");
    assert.equal(getValue(getClaudeArgs({ model: "claude-opus-4-8" }), "--fallback-model"), "sonnet");

    // 같은 모델로는 fallback을 지정하지 않는다.
    assert(!getClaudeArgs({ model: "sonnet", effort: "low" }).includes("--fallback-model"));
    assert.equal(getValue(getClaudeArgs(), "--autocompact"), "150000");

    // 설치된 Claude Code가 모르는 선택 옵션은 값까지 함께 빼고, 필수 옵션은 그대로 둔다.
    const trimmed = getClaudeArgs({ unsupportedFlags: ["--autocompact", "--effort"] });

    assert(!trimmed.includes("--autocompact") && !trimmed.includes("150000") && !trimmed.includes("--effort") && !trimmed.includes("high"));
    assert.deepEqual(trimmed, ["--model", "opus", "--fallback-model", "sonnet", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", "-p"]);

    // --help에 나오지 않는 옵션만 골라낸다. 도움말을 읽지 못하면(없는 명령) 아무것도 빼지 않는다.
    assert.deepEqual(await processUtil.getUnsupportedFlags(process.execPath, ["--eval", "--no-such-flag-xyz"], process.env), ["--no-such-flag-xyz"]);
    assert.deepEqual(await processUtil.getUnsupportedFlags(path.join(process.cwd(), "no-such-command-xyz"), ["--effort"], process.env), []);
};

// 엔진은 Electron을 Node로 실행하므로 그 표시가 Claude 세션과 그 하위 프로세스로 새면 안 된다.
const checkRunEnv = () => {
    const env = autopilotUtil.getRunEnv({ env: { ELECTRON_RUN_AS_NODE: "1", AP_KEEP: "yes" } });

    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.AP_KEEP, "yes");
    assert(env.CLAUDE_CONFIG_DIR.endsWith(".claude"));
};

// 진행 기록은 프로젝트마다 앱 데이터 폴더의 고유한 경로를 쓰고, 작업 폴더는 프로젝트 git이 추적하지 않도록 만든다.
const checkProjectPaths = (context) => {
    const { getProjectDir, getWorkDir, getProgressFile, ensureWorkDir } = autopilotUtil;
    const dataDir = path.join(context.testDir, "appdata");
    const projectDir = path.join(context.testDir, "paths project 한글");
    const otherProjectDir = path.join(context.testDir, "other", "paths project 한글");

    fs.mkdirSync(projectDir);
    fs.mkdirSync(otherProjectDir, { recursive: true });
    fs.writeFileSync(path.join(context.testDir, "not-a-dir"), "");

    assert.equal(getProjectDir(projectDir), path.resolve(projectDir));
    assert.throws(() => getProjectDir(""), /프로젝트 폴더/);
    assert.throws(() => getProjectDir(path.join(context.testDir, "missing")), /프로젝트 폴더/);
    assert.throws(() => getProjectDir(path.join(context.testDir, "not-a-dir")), /프로젝트 폴더/);

    const progressFile = getProgressFile(projectDir, dataDir);

    assert.equal(progressFile, getProgressFile(projectDir, dataDir));
    assert.notEqual(progressFile, getProgressFile(otherProjectDir, dataDir));
    assert.match(path.relative(dataDir, progressFile), /^AutoPilot[\\/]projects[\\/]paths project 한글-[0-9a-f]{8}[\\/]AUTOPILOT_PROGRESS\.md$/);

    // 기본 위치는 %APPDATA%다.
    if (process.env.APPDATA) {
        assert(getProgressFile(projectDir).startsWith(path.join(process.env.APPDATA, "AutoPilot", "projects")));
    }
    assert(path.relative(projectDir, progressFile).startsWith(".."), "진행 기록은 프로젝트 밖에 있어야 한다");

    const workDir = getWorkDir(projectDir);

    assert.equal(workDir, path.join(projectDir, ".autopilot"));

    ensureWorkDir(workDir);

    assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "*\n");

    // 이미 있는 .gitignore는 덮어쓰지 않는다.
    fs.writeFileSync(path.join(workDir, ".gitignore"), "/progress/\n");

    ensureWorkDir(workDir);

    assert.equal(fs.readFileSync(path.join(workDir, ".gitignore"), "utf8"), "/progress/\n");
};

const checkProgressArchive = (context) => {
    const { archiveProgressRecord } = progressUtil;
    const archiveRoot = path.join(context.testDir, "archive");
    const archiveDir = path.join(archiveRoot, "progress");
    const progressFile = path.join(archiveRoot, "AUTOPILOT_PROGRESS.md");

    fs.mkdirSync(archiveDir, { recursive: true });

    assert.equal(
        archiveProgressRecord(progressFile, archiveDir, "test", () => {}),
        ""
    );

    // 상한 줄은 그대로 두고 그보다 한 줄 많을 때부터 보관한다.
    for (const lineCount of [PROGRESS_MAX_LINES, PROGRESS_MAX_LINES + 1]) {
        const content = BOM + Array.from({ length: lineCount }, (_, index) => `${index} 한글`).join("\r\n") + "\r\n";

        fs.writeFileSync(progressFile, content);

        const cleanupPrompt = archiveProgressRecord(progressFile, archiveDir, "test", () => {});

        assert.equal(Boolean(cleanupPrompt), lineCount > PROGRESS_MAX_LINES);
        assert.equal(fs.readFileSync(progressFile, "utf8"), content);

        if (lineCount > PROGRESS_MAX_LINES) {
            assert(cleanupPrompt.includes(`\`${progressFile}\``));
            assert.equal(fs.readFileSync(path.join(archiveDir, fs.readdirSync(archiveDir)[0]), "utf8"), content);
        }
    }

    assert.equal(
        archiveProgressRecord(progressFile, path.join(context.testDir, "missing"), "test", () => {}),
        ""
    );
};

const checkStreamEvent = () => {
    const { handleStreamEvent } = streamUtil;
    const sessionStats = {};

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 123 } }), sessionStats, () => {});

    assert.equal(sessionStats.resetAt, 123000);
    assert.equal(sessionStats.limitHit, undefined);

    handleStreamEvent(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }), sessionStats, () => {});

    assert.equal(sessionStats.limitHit, true);

    // JSON이지만 이벤트가 아닌 줄은 무시한다.
    for (const ignoredLine of ["null", "123", "not json"]) {
        handleStreamEvent(ignoredLine, sessionStats, () => {});
    }
};

// 커밋 로그 줄의 +/− 줄 수는 git shortstat에서 읽는다. 단수형이나 빠진 항목은 0이다.
const checkCommitLineCounts = () => {
    const cases = [
        [" 2 files changed, 5 insertions(+), 1 deletion(-)", { insertions: 5, deletions: 1 }],
        [" 1 file changed, 1 insertion(+)", { insertions: 1, deletions: 0 }],
        [" 1 file changed, 12 deletions(-)", { insertions: 0, deletions: 12 }],
        ["", { insertions: 0, deletions: 0 }]
    ];

    for (const [stat, expected] of cases) {
        assert.deepEqual(gitUtil.getLineCounts(stat), expected, stat);
    }
};

// 진행 기록이 없으면 초기 내용을 만들고, 이미 있으면 건드리지 않는다.
const checkProgressEnsure = (context) => {
    const { ensureProgressRecord, PROGRESS_TEMPLATE } = progressUtil;
    const progressFile = path.join(context.testDir, "ensure", "deep", "AUTOPILOT_PROGRESS.md");

    ensureProgressRecord(progressFile);

    assert.equal(fs.readFileSync(progressFile, "utf8"), PROGRESS_TEMPLATE);

    fs.writeFileSync(progressFile, "이어갈 기록\n");

    ensureProgressRecord(progressFile);

    assert.equal(fs.readFileSync(progressFile, "utf8"), "이어갈 기록\n");
};

// 진행 기록은 원본을 보관하고 초기 상태로 되돌린다. 이미 초기 상태면 건드리지 않고, 보관에 실패하면 원본을 유지한다.
const checkProgressReset = (context) => {
    const { resetProgressRecord, PROGRESS_TEMPLATE } = progressUtil;
    const resetRoot = path.join(context.testDir, "reset root");
    const progressDir = path.join(resetRoot, "progress", "2026-10-10");
    const blockedDir = path.join(resetRoot, "blocked");
    const progressFile = path.join(resetRoot, "AUTOPILOT_PROGRESS.md");
    const original = `${PROGRESS_TEMPLATE}\n## 다음 작업\n- 한글 작업\n`;
    const logs = [];
    const writeLog = (message) => logs.push(message);
    const readRecord = () => fs.readFileSync(progressFile, "utf8");

    fs.mkdirSync(resetRoot, { recursive: true });

    // 기록이 없거나 이미 초기 상태면 보관본도 폴더도 만들지 않는다.
    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });

    fs.writeFileSync(progressFile, PROGRESS_TEMPLATE);

    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });
    assert(!fs.existsSync(progressDir));

    fs.writeFileSync(progressFile, BOM + original);

    const resetResult = resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog);
    const archiveFile = path.join(progressDir, path.basename(resetResult.archivePath));

    assert.equal(resetResult.isDone, true);
    assert.match(resetResult.archivePath, /^\.autopilot\/progress\/2026-10-10\/AUTOPILOT_PROGRESS_[0-9a-f-]{36}\.md$/);
    assert.equal(fs.readFileSync(archiveFile, "utf8"), BOM + original);
    assert(readRecord().startsWith(PROGRESS_TEMPLATE));
    assert(readRecord().includes(resetResult.archivePath));
    assert(!readRecord().includes("한글 작업"));

    // 초기화한 기록을 다시 초기화하지 않으므로 보관본이 쌓이지 않는다.
    assert.deepEqual(resetProgressRecord(progressFile, progressDir, "2026-10-10", writeLog), { isDone: true, archivePath: "" });
    assert.equal(fs.readdirSync(progressDir).length, 1);

    // 보관할 수 없으면(날짜 폴더를 만들 수 없음) 원본을 유지한다.
    fs.writeFileSync(progressFile, original);
    fs.writeFileSync(blockedDir, "");

    assert.equal(resetProgressRecord(progressFile, path.join(blockedDir, "2026-10-10"), "2026-10-10", writeLog).isDone, false);
    assert.equal(readRecord(), original);
    assert.match(logs.at(-1), /초기화 실패, 기존 문서 유지/);
};

// 보관 기간이 지난 날짜 폴더의 로그·리포트만 지운다.
const checkRunFilePrune = (context) => {
    const { pruneRunFiles } = progressUtil;
    const progressRoot = path.join(context.testDir, "prune", "progress");
    const outsideDir = path.join(context.testDir, "prune", "outside");
    const seed = (...parts) => {
        const file = path.join(progressRoot, ...parts);

        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");

        return file;
    };
    const logs = [];

    // 기준일 2026-10-10, 보관 30일이면 2026-09-10부터 남기고 그 전 폴더는 정리 대상이다.
    seed("2026-09-09", "autopilot_120000_aaaa1111.log");
    seed("2026-09-09", "report_120000_aaaa1111.html");
    seed("2026-09-09", "AUTOPILOT_PROGRESS_aaaa1111.md");
    seed("2026-09-09", "TODO_COMPLETE");
    seed("2026-08-01", "autopilot_000000_cccc3333.log");
    seed("2026-09-10", "autopilot_120000_bbbb2222.log");
    seed("notes", "autopilot_120000_dddd4444.log");
    seed("STOP");

    // 링크로 이어진 폴더는 따라가지 않는다.
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "autopilot_000000_eeee5555.log"), "");
    fs.symlinkSync(outsideDir, path.join(progressRoot, "2020-01-01"), "junction");

    assert.equal(
        pruneRunFiles(progressRoot, "2026-10-10", 0, (message) => logs.push(message)),
        0
    );
    assert.equal(
        pruneRunFiles(progressRoot, "2026-10-10", 30, (message) => logs.push(message)),
        3
    );

    assert(!fs.existsSync(path.join(progressRoot, "2026-08-01")));
    assert.deepEqual(fs.readdirSync(path.join(progressRoot, "2026-09-09")).sort(), ["AUTOPILOT_PROGRESS_aaaa1111.md", "TODO_COMPLETE"]);
    assert(fs.existsSync(path.join(progressRoot, "2026-09-10", "autopilot_120000_bbbb2222.log")));
    assert(fs.existsSync(path.join(progressRoot, "notes", "autopilot_120000_dddd4444.log")));
    assert(fs.existsSync(path.join(progressRoot, "STOP")));
    assert(fs.existsSync(path.join(outsideDir, "autopilot_000000_eeee5555.log")));
    assert.deepEqual(logs, ["[정리] 보관 기간 30일이 지난 로그·리포트 3개를 삭제했습니다."]);

    // 폴더가 없어도 오류 없이 넘어간다.
    assert.equal(
        pruneRunFiles(path.join(context.testDir, "missing"), "2026-10-10", 30, (message) => logs.push(message)),
        0
    );
    assert.equal(logs.length, 1);
};

// 실행 중인 프로세스는 자기 실행 파일 이름으로 확인되고, 다른 이름(pid 재사용)이나 없는 pid는 같은 프로세스가 아니다. Linux에서 ps의 comm이 MainThread로 보여도 같아야 한다.
const checkProcessIdentity = () => {
    const ownName = path.basename(process.execPath);

    assert.equal(processUtil.isSameProcess(process.pid, ownName), true);
    assert.equal(processUtil.isSameProcess(process.pid, ""), true);
    assert.equal(processUtil.isSameProcess(process.pid, "definitely-another-program"), false);
    assert.equal(processUtil.isSameProcess(2 ** 22 + 12345, ownName), false);
};

export {
    checkProcessIdentity,
    checkInvalidProject,
    checkRunFilePrune,
    checkProgressEnsure,
    checkProgressReset,
    checkRunSettings,
    checkCommandArgs,
    checkClaudeArgs,
    checkRunEnv,
    checkProjectPaths,
    checkProgressArchive,
    checkStreamEvent,
    checkCommitLineCounts,
    checkPhaseRules
};
