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
import debateUtil from "../../autopilot/src/utils/debateUtil.js";
import promptUtil from "../../autopilot/src/utils/promptUtil.js";
import providerUtil from "../../autopilot/src/utils/providerUtil.js";
import util from "../../autopilot/src/utils/util.js";
import logUtil from "../../autopilot/src/utils/logUtil.js";

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

    // 실행 에이전트와 Codex의 model·effort도 실행 중에 바꾼다. default는 Codex 설정을 따르라는 빈 값이다.
    assert.deepEqual(parseSetArgs([...project, "--runner", "codex", "--codex-model", "gpt-6.1-sol", "--codex-effort", "default"]), {
        projectDir: "C:\\work\\demo project",
        runner: "codex",
        codexModel: "gpt-6.1-sol",
        codexEffort: ""
    });
    assert.deepEqual(parseSetArgs([...project, "--codex-model", "default"]), { projectDir: "C:\\work\\demo project", codexModel: "" });

    for (const invalidArgs of [
        [...project, "--runner", "gemini"],
        [...project, "--codex-model", "gpt 6"],
        [...project, "--codex-effort", "ultra"]
    ]) {
        assert.throws(() => parseSetArgs(invalidArgs), undefined, `set ${invalidArgs.join(" ")}`);
    }

    // Codex가 회차를 돌리면 유지 보수에서도 Codex의 model·effort를 받는다. 그 밖에는 브레인스토밍과 함께만 받는다.
    assert.deepEqual(parseRunArgs([...project, "--runner", "codex", "--codex-model", "gpt-6.1-sol", "--codex-effort", "high"]), {
        projectDir: "C:\\work\\demo project",
        runner: "codex",
        codexModel: "gpt-6.1-sol",
        codexEffort: "high"
    });
    assert.equal(parseRunArgs([...project, "--runner", "claude"]).runner, "claude");
    assert.throws(() => parseRunArgs([...project, "--runner", "claude", "--codex-model", "gpt-6.1-sol"]), /--runner codex/);
    assert.throws(() => parseRunArgs([...project, "--runner", "gemini"]), /--runner/);

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

// 여러 AI 브레인스토밍: 인자, 후보가 둘 이상이면 확인받기와 상관없이 멈추는 전환, 독립 · 교차검토 · 확정 지시와 다른 AI에게 보내는 프롬프트.
const checkBrainstormRules = (context) => {
    const { parseRunArgs, parseApproveArgs } = cliUtil;
    const project = ["--project", "C:\\work\\demo project"];
    const build = [...project, "--mode", "build"];

    assert.deepEqual(parseRunArgs([...build, "--brainstorm", "plan,design", "--cross-review"]), {
        projectDir: "C:\\work\\demo project",
        mode: "build",
        brainstorm: ["plan", "design"],
        crossReview: true
    });

    // 단계마다 메인 AI를 고른다. 없는 단계는 --runner(기본 claude)가 메인이다. Codex가 메인이면 Codex의 model·effort도 받는다.
    assert.deepEqual(parseRunArgs([...build, "--main", "plan=codex,design=claude,security=codex"]), {
        projectDir: "C:\\work\\demo project",
        mode: "build",
        mains: { plan: "codex", design: "claude", security: "codex" }
    });
    assert.deepEqual(parseRunArgs([...build, "--main", "build=codex", "--codex-model", "gpt-6.1-sol"]).mains, { build: "codex" });

    for (const mains of ["plan", "plan=gemini", "plan=codex,plan=claude", "deploy=codex", "plan=codex=x", "codex", "plan=codex,", "=codex"]) {
        assert.throws(() => parseRunArgs([...build, "--main", mains]), /--main/, mains);
    }

    assert.throws(() => parseRunArgs([...project, "--main", "plan=codex"]), /--mode build/);

    // Codex의 model·effort는 브레인스토밍과 함께만 받고, 비우면 인자를 넘기지 않아 Codex 설정을 따른다.
    assert.deepEqual(parseRunArgs([...build, "--brainstorm", "plan", "--codex-model", "gpt-6.1-sol", "--codex-effort", "xhigh"]), {
        projectDir: "C:\\work\\demo project",
        mode: "build",
        brainstorm: ["plan"],
        codexModel: "gpt-6.1-sol",
        codexEffort: "xhigh"
    });

    for (const invalidArgs of [
        [...project, "--brainstorm", "plan"],
        [...project, "--mode", "maintain", "--cross-review"],
        [...build, "--brainstorm", "build"],
        [...build, "--brainstorm", "plan", "--brainstorm-with", "codex"],
        [...build, "--cross-review"],
        [...build, "--main", "plan=claude", "--codex-model", "gpt-6.1-sol"],
        [...build, "--codex-model", "gpt-6.1-sol"],
        [...build, "--codex-effort", "high"],
        [...project, "--codex-effort", "high"],
        [...build, "--brainstorm", "plan", "--codex-model", "6x"],
        [...build, "--brainstorm", "plan", "--codex-model", "gpt 6"],
        [...build, "--brainstorm", "plan", "--codex-model", "gpt;rm"],
        [...build, "--brainstorm", "plan", "--codex-effort", "ultra"]
    ]) {
        assert.throws(() => parseRunArgs(invalidArgs), undefined, invalidArgs.join(" "));
    }

    const { getSettingArgs, getAskArgs, getResumeArgs, getRoundArgs } = providerUtil.PROVIDERS.codex;

    // Codex 회차는 JSONL로 받고 Claude 회차와 같은 권한으로 돈다. 연결 저장소는 --add-dir로 붙이고 프롬프트는 stdin(-)이다.
    assert.deepEqual(getRoundArgs(["-m", "gpt-6.1-sol"], ["/a b"]), [
        "exec",
        "--json",
        "--color",
        "never",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m",
        "gpt-6.1-sol",
        "--add-dir",
        "/a b",
        "-"
    ]);
    const sessionId = "01a18d02-d1e7-7b20-831e-d85c25a2b4f2";
    const settingArgs = getSettingArgs({ model: "gpt-6.1-sol", effort: "high" });

    assert.deepEqual(getSettingArgs({}), []);
    assert.deepEqual(settingArgs, ["-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high"]);
    assert.deepEqual(getSettingArgs({ effort: "low" }), ["-c", "model_reasoning_effort=low"]);
    assert.deepEqual(getAskArgs([]), ["exec", "-s", "read-only", "--color", "never", "-"]);
    assert.deepEqual(getAskArgs(settingArgs), ["exec", "-s", "read-only", "--color", "never", "-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high", "-"]);
    assert.deepEqual(getResumeArgs(sessionId, []), ["exec", "resume", sessionId, "-c", "sandbox_mode=read-only", "-"]);
    assert.deepEqual(getResumeArgs(sessionId, settingArgs).slice(-5), ["-m", "gpt-6.1-sol", "-c", "model_reasoning_effort=high", "-"]);

    // 진행 줄의 활동: 실행한 명령 수와 마지막으로 한 말. 읽을 것이 없으면 비운다.
    const codexStderr =
        "OpenAI Codex v0.164.0\n--------\nuser\n프롬프트\n\ncodex\n먼저 파일을 읽을게요.\n\nexec\npwsh -Command ls in C:\\work\n succeeded in 3ms:\n\nexec\nrg --files\n\ncodex\n" +
        "길".repeat(100) +
        "\n";

    assert.equal(providerUtil.getActivity("codex", codexStderr), `명령 2번 실행 · ${"길".repeat(80)}`);
    assert.equal(providerUtil.getActivity("codex", "exec\nls\n"), "명령 1번 실행");
    assert.equal(providerUtil.getActivity("codex", "OpenAI Codex\n--------\n"), "");

    assert.deepEqual(parseApproveArgs([...project, "--pick", "codex"]), { projectDir: "C:\\work\\demo project", pick: "codex" });
    assert.deepEqual(parseApproveArgs(project), { projectDir: "C:\\work\\demo project" });
    assert.throws(() => parseApproveArgs([...project, "--pick", "gpt"]), /--pick/);

    const { getPhaseTransition, getStartPhase, isPhaseState } = phaseUtil;
    const plan = { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null };
    const limits = { qa: 3, security: 3 };
    const proposals = { phase: "plan", candidates: ["claude", "codex"], picked: null };

    assert.deepEqual(getPhaseTransition(plan, "pass", [], limits, ["claude", "codex"]), { state: { ...plan, phase: "design", awaiting: "plan", proposals: proposals }, event: "await" });
    assert.deepEqual(getPhaseTransition(plan, "pass", [], limits, []), { state: { ...plan, phase: "design" }, event: "next" });
    assert.deepEqual(getStartPhase({ ...plan, phase: "design", awaiting: "plan", proposals: proposals }), { state: plan, isRevision: true });
    assert(isPhaseState({ ...plan, phase: "design", proposals: { ...proposals, picked: "codex" } }));
    assert(!isPhaseState({ ...plan, proposals: { ...proposals, picked: "gemini" } }));
    assert(!isPhaseState({ ...plan, proposals: { ...proposals, candidates: ["claude"] } }));
    assert(!isPhaseState({ ...plan, proposals: { ...proposals, phase: "build" } }));

    const runState = {
        mode: "build",
        phase: "plan",
        qaRetries: 0,
        securityRetries: 0,
        isRevision: false,
        designFormat: "html",
        allow: ["send"],
        tasks: "미용실 예약 웹앱",
        projectDir: context.testDir,
        repos: [],
        progressFile: "progress.md",
        deadline: new Date(2026, 10, 2, 7, 0),
        commitPrefix: "[ap]",
        workBranch: "ai/autopilot",
        phaseDoneRelPath: ".autopilot/progress/2026-10-30/PHASE_DONE",
        brainstorm: ["plan", "design"],
        mains: { plan: "claude" },
        phaseAgents: { phase: "plan", main: "claude", assistant: "codex" },
        crossReview: true,
        proposalReady: { codex: "docs/autopilot/proposals/plan-codex.md" },
        adoption: null
    };
    const roundPrompt = promptUtil.getRoundPrompt(runState, 1, 60, "", 2);

    assert.match(roundPrompt, /`docs\/autopilot\/proposals\/`를 열지 말고 독립적으로 쓴다/);
    assert.match(roundPrompt, /`docs\/autopilot\/proposals\/plan-review-claude\.md`에 그 안의 빈자리/);
    assert.match(roundPrompt, /`\[ap\] 기획: Codex 안 보관`/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...runState, crossReview: false }, 1, 60, "", 2), /plan-review-claude/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...runState, phase: "build" }, 1, 60, "", 2), /독립적으로 쓴다/);

    // 고른 안은 다음 실행의 첫 일로 확정한다. Claude 안을 골랐으면 남은 파일만 commit한다.
    const adoptionPrompt = promptUtil.getRoundPrompt(
        { ...runState, phase: "design", adoption: { phase: "plan", picked: "codex", main: "claude", file: "docs/autopilot/proposals/plan-codex.md" } },
        1,
        60,
        "",
        2
    );

    assert.match(
        adoptionPrompt,
        /사용자가 \[기획\]에서 Codex 안을 골랐다\. 지금 단계의 일을 하기 전에 먼저 지금 `docs\/autopilot\/plan\.md`\(Claude 안\)를 `docs\/autopilot\/proposals\/plan-claude\.md`로 옮기고/
    );
    assert.match(adoptionPrompt, /`\[ap\] 기획: Codex 안으로 확정`/);
    assert.match(
        promptUtil.getRoundPrompt({ ...runState, phase: "build", adoption: { phase: "design", picked: "codex", main: "claude", file: "docs/autopilot/proposals/design-codex.html" } }, 1, 60, "", 2),
        /design\/index\.html`로 옮기고/
    );
    assert.match(
        promptUtil.getRoundPrompt({ ...runState, phase: "design", adoption: { phase: "plan", picked: "claude", main: "claude", file: "" } }, 1, 60, "", 2),
        /Claude 안을 골랐다\. 지금 단계의 일을 하기 전에 아직 commit하지 않은/
    );

    // 다른 AI에게는 같은 단계의 틀을 읽기 전용 · 최종 답변으로 받는다.
    const proposalPrompt = promptUtil.getProposalPrompt(runState);

    assert.match(proposalPrompt, /10\) 위험과 가정/);
    assert.match(proposalPrompt, /파일을 만들거나 고치지 말고, 결과는 최종 답변으로만 낸다/);
    assert.match(proposalPrompt, /<TASKS>\n미용실 예약 웹앱\n<\/TASKS>/);

    // 다른 AI는 정책을 받지 않으므로 기획 안에는 이번 실행의 허용 범위를 직접 적는다.
    assert.match(proposalPrompt, /허용하지 않음: 새 라이브러리\(패키지\) 추가, 새 폴더 구조 · Framework 선택 같은 큰 구조, 외부 API 호출\./);
    assert.doesNotMatch(proposalPrompt, /허용함:/);
    assert.match(promptUtil.getProposalPrompt({ ...runState, allow: ["deps", "send"] }), /허용함: 새 라이브러리\(패키지\) 추가\. 허용하지 않음: 새 폴더 구조/);
    assert.doesNotMatch(promptUtil.getProposalPrompt({ ...runState, phase: "design" }), /허용 범위/);
    assert.match(promptUtil.getProposalPrompt({ ...runState, phase: "design" }), /HTML 문서 하나/);
    assert.match(
        promptUtil.getProposalPrompt({ ...runState, phase: "design", adoption: { phase: "plan", picked: "codex", main: "claude", file: "docs/autopilot/proposals/plan-codex.md" } }),
        /plan\.md` 대신 사용자가 고른 `docs\/autopilot\/proposals\/plan-codex\.md`/
    );
    // 검토도 새 세션이라 빈자리를 가릴 만들 것과 기획의 허용 범위를 직접 받는다.
    const reviewPrompt = promptUtil.getReviewPrompt(runState);

    assert.match(reviewPrompt, /`docs\/autopilot\/plan\.md`\(다른 AI가 쓴 안\)를 읽고 빈자리/);
    assert.match(reviewPrompt, /<TASKS>\n미용실 예약 웹앱\n<\/TASKS>/);
    assert.match(reviewPrompt, /허용하지 않음: 새 라이브러리/);
    assert.doesNotMatch(promptUtil.getReviewPrompt({ ...runState, phase: "design" }), /허용 범위/);

    // 메인이 Codex이고 보조가 Claude이면 같은 지시가 방향만 바뀐다. 검토 파일 이름은 메인 기준이고, 고른 안이 메인의 것이면 남은 파일만 commit한다.
    const codexMain = {
        ...runState,
        phaseAgents: { phase: "plan", main: "codex", assistant: "claude" },
        proposalReady: { claude: "docs/autopilot/proposals/plan-claude.md" }
    };
    const codexMainPrompt = promptUtil.getRoundPrompt(codexMain, 1, 60, "", 2, "codex");

    assert.match(codexMainPrompt, /`docs\/autopilot\/proposals\/plan-claude\.md`\(Claude 안\)를 읽고 `docs\/autopilot\/proposals\/plan-review-codex\.md`/);
    assert.match(codexMainPrompt, /`\[ap\] 기획: Claude 안 보관`/);
    assert.match(codexMainPrompt, /^작업 전에 프로젝트 루트의 `CLAUDE\.md`를 직접 읽어/, "Codex 회차는 CLAUDE.md를 직접 읽게 한다");
    assert.match(
        promptUtil.getRoundPrompt({ ...codexMain, phase: "design", adoption: { phase: "plan", picked: "claude", main: "codex", file: "docs/autopilot/proposals/plan-claude.md" } }, 1, 60, "", 2),
        /사용자가 \[기획\]에서 Claude 안을 골랐다\. 지금 단계의 일을 하기 전에 먼저 지금 `docs\/autopilot\/plan\.md`\(Codex 안\)를 `docs\/autopilot\/proposals\/plan-codex\.md`로 옮기고/
    );
    assert.match(
        promptUtil.getRoundPrompt({ ...codexMain, phase: "build", adoption: { phase: "design", picked: "claude", main: "codex", file: "docs/autopilot/proposals/design-claude.md" } }, 1, 60, "", 2),
        /Codex의 디자인 산출물[\s\S]*`docs\/autopilot\/proposals\/design-codex\/`로 옮기고/
    );
    assert.match(
        promptUtil.getRoundPrompt({ ...codexMain, phase: "design", adoption: { phase: "plan", picked: "codex", main: "codex", file: "" } }, 1, 60, "", 2),
        /Codex 안을 골랐다\. 지금 단계의 일을 하기 전에 아직 commit하지 않은/
    );
    assert.doesNotMatch(promptUtil.getProposalPrompt({ ...codexMain, phase: "design", adoption: { phase: "plan", picked: "codex", main: "codex", file: "" } }), /대신 사용자가 고른/);
    assert.match(
        promptUtil.getProposalPrompt({ ...codexMain, phase: "design", adoption: { phase: "plan", picked: "claude", main: "codex", file: "docs/autopilot/proposals/plan-claude.md" } }),
        /plan\.md` 대신 사용자가 고른 `docs\/autopilot\/proposals\/plan-claude\.md`/
    );

    // 보조 없이(blocked)면 브레인스토밍 지시가 없다.
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...runState, phaseAgents: { phase: "plan", main: "claude", assistant: null } }, 1, 60, "", 2), /독립적으로 쓴다/);
};

// 단계별 메인·보조: 메인은 --main(없으면 --runner)이 정하고 보조는 늘 반대쪽 AI다. Codex 보조는 보내기를 허용해야 하고, Claude 보조는 메인이 Codex일 때 허용과 상관없다.
const checkAgentRules = () => {
    const { getOtherProvider, getPhaseMains, getPhaseAgents } = phaseUtil;

    assert.equal(getOtherProvider("claude"), "codex");
    assert.equal(getOtherProvider("codex"), "claude");
    assert.deepEqual(getPhaseMains(), { plan: "claude", design: "claude", build: "claude", qa: "claude", security: "claude" });
    assert.deepEqual(getPhaseMains({ plan: "codex", security: "codex" }), { plan: "codex", design: "claude", build: "claude", qa: "claude", security: "codex" });
    assert.deepEqual(getPhaseMains({ design: "claude" }, "codex"), { plan: "codex", design: "claude", build: "codex", qa: "codex", security: "codex" }, "--main에 없는 단계는 --runner가 메인이다");

    const mains = getPhaseMains({ plan: "codex" });

    assert.deepEqual(getPhaseAgents({ phase: "plan", mains: mains, brainstorm: ["plan"], canSend: false }), { phase: "plan", main: "codex", assistant: "claude", isBlocked: false });
    assert.deepEqual(getPhaseAgents({ phase: "design", mains: mains, brainstorm: ["design"], canSend: false }), { phase: "design", main: "claude", assistant: null, isBlocked: true });
    assert.deepEqual(getPhaseAgents({ phase: "design", mains: mains, brainstorm: ["design"], canSend: true }), { phase: "design", main: "claude", assistant: "codex", isBlocked: false });
    assert.deepEqual(
        getPhaseAgents({ phase: "build", mains: mains, brainstorm: ["plan", "design"], canSend: true }),
        { phase: "build", main: "claude", assistant: null, isBlocked: false },
        "브레인스토밍하지 않는 단계는 보조가 없다"
    );
    assert.deepEqual(getPhaseAgents({ phase: "plan", mains: mains, brainstorm: [], canSend: true }).assistant, null);
};

// 협의: 단계별 방식 인자, 쟁점 고르기 인자, 발언 · 쟁점 해석과 상한, 협의 결과로 멈추는 전환, 협의 · 정리 · 확정 지시.
const checkDebateRules = (context) => {
    const { parseRunArgs, parseApproveArgs } = cliUtil;
    const project = ["--project", "C:\\work\\demo project"];
    const build = [...project, "--mode", "build"];

    assert.deepEqual(parseRunArgs([...build, "--brainstorm", "plan:debate,design"]), { projectDir: "C:\\work\\demo project", mode: "build", brainstorm: ["plan", "design"], debate: ["plan"] });
    assert.deepEqual(parseRunArgs([...build, "--brainstorm", "plan:compare"]).debate, undefined);
    assert.equal(parseRunArgs([...build, "--brainstorm", "plan:debate,design:compare", "--cross-review"]).crossReview, true);
    assert.equal(parseRunArgs([...build, "--brainstorm", "plan:debate", "--debate-turns", "12"]).debateTurns, 12);
    assert.equal(parseRunArgs([...build, "--brainstorm", "plan:debate"]).debateTurns, undefined);

    for (const turns of ["0", "21", "3.5", "x", "-1"]) {
        assert.throws(() => parseRunArgs([...build, "--brainstorm", "plan:debate", "--debate-turns", turns]), /--debate-turns/, turns);
    }

    assert.throws(() => parseRunArgs([...build, "--brainstorm", "plan:compare", "--debate-turns", "5"]), /협의/);
    assert.throws(() => parseRunArgs([...build, "--debate-turns", "5"]), /--brainstorm/);
    assert.throws(() => parseRunArgs([...project, "--debate-turns", "5"]), /--mode build/);

    for (const brainstorm of ["plan:argue", "plan:debate:x", "plan,plan:debate", "plan:", ":debate"]) {
        assert.throws(() => parseRunArgs([...build, "--brainstorm", brainstorm]), /--brainstorm/, brainstorm);
    }

    assert.throws(() => parseRunArgs([...build, "--brainstorm", "plan:debate,design:debate", "--cross-review"]), /--cross-review/);
    assert.deepEqual(parseApproveArgs([...project, "--resolve", "d1=claude,d2=codex"]).resolve, { d1: "claude", d2: "codex" });

    for (const resolve of ["d1=gpt", "d1=claude,d1=codex", "x1=claude", "d1=claude,", "d1"]) {
        assert.throws(() => parseApproveArgs([...project, "--resolve", resolve]), /--resolve/, resolve);
    }

    assert.throws(() => parseApproveArgs([...project, "--pick", "codex", "--resolve", "d1=claude"]), /함께 쓸 수 없습니다/);

    // 발언: 둘레의 글을 걷어 JSON 하나를 읽고, 한 줄로 펴서 길이를 묶는다. 반대가 남았으면 합의가 아니다.
    const turn = debateUtil.parseTurn(
        `앞말\n{"message": "첫 줄\\n둘째 줄", "agree": ["a", 3], "disagree": [{"point": "결제", "reason": "범위"}, {"reason": "점 없음"}], "changes": [], "consensus": true}\n뒷말`
    );

    assert.deepEqual(turn, { message: "첫 줄 둘째 줄", agree: ["a"], disagree: [{ point: "결제", reason: "범위" }], improve: [], changes: [], consensus: false });

    // 반대가 없어도 더 개선할 점이 남았으면 합의가 아니다.
    const improving = debateUtil.parseTurn(JSON.stringify({ message: "더 있어요", improve: ["화면 흐름", 3], consensus: true }));

    assert.deepEqual(improving.improve, ["화면 흐름"]);
    assert.equal(improving.consensus, false);
    assert.equal(debateUtil.parseTurn(JSON.stringify({ message: "가".repeat(400), consensus: true })).message.length, 300);
    assert.equal(debateUtil.parseTurn(JSON.stringify({ message: "네", consensus: true })).consensus, true);

    for (const text of ["", "합의해요", "{}", '{"message": 3}', "{깨진 json}"]) {
        assert.equal(debateUtil.parseTurn(text), null, text);
    }

    assert.deepEqual(
        debateUtil.parseDisputes(
            `\uFEFF${JSON.stringify([
                { title: "결제", claude: "빼요", codex: "넣어요" },
                { title: "빈 입장", claude: "", codex: "x" },
                { title: "화면", claude: "6개", codex: "4개", extra: 1 }
            ])}`
        ),
        [
            { id: "d1", title: "결제", claude: "빼요", codex: "넣어요" },
            { id: "d2", title: "화면", claude: "6개", codex: "4개" }
        ]
    );
    assert.deepEqual(debateUtil.parseDisputes("[]"), []);
    assert.equal(debateUtil.parseDisputes('{"title": "배열 아님"}'), null);
    assert.equal(debateUtil.parseDisputes("깨짐"), null);
    assert.equal(debateUtil.parseDisputes(""), null);
    assert.equal(debateUtil.parseDisputes('[{"Title": "키 다름", "Claude": "a", "Codex": "b"}]'), null);

    const disputes = [{ id: "d1", title: "결제", claude: "빼요", codex: "넣어요" }];
    const debate = { phase: "plan", disputes: disputes, resolved: null };

    assert(debateUtil.isDebateState(null));
    assert(debateUtil.isDebateState(debate));
    assert(debateUtil.isDebateState({ ...debate, resolved: { d1: "codex" } }));
    assert(debateUtil.isDebateState({ phase: "design", disputes: [], resolved: {} }));
    assert(!debateUtil.isDebateState({ ...debate, resolved: {} }));
    assert(!debateUtil.isDebateState({ ...debate, resolved: { d1: "gemini" } }));
    assert(!debateUtil.isDebateState({ ...debate, phase: "build" }));
    assert(!debateUtil.isDebateState({ ...debate, disputes: [{ ...disputes[0], id: "1" }] }));

    // 협의를 마친 단계는 확인받기 설정과 상관없이 멈추고, 돌려보내면 협의도 다시 한다. 협의가 생기기 전의 상태 파일은 debate가 null이다.
    const { getPhaseTransition, getStartPhase, readPhase } = phaseUtil;
    const plan = { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null };
    const oldPhaseFile = path.join(context.testDir, "old-phase.json");

    assert.deepEqual(getPhaseTransition(plan, "pass", [], { qa: 3, security: 3 }, [], debate), { state: { ...plan, phase: "design", awaiting: "plan", debate: debate }, event: "await" });
    assert.deepEqual(getStartPhase({ ...plan, phase: "design", awaiting: "plan", debate: debate }), { state: plan, isRevision: true });
    fs.writeFileSync(oldPhaseFile, JSON.stringify({ phase: "design", awaiting: "plan", qaRetries: 0, securityRetries: 0, proposals: null }));
    assert.equal(readPhase(oldPhaseFile).debate, null);
    assert.equal(readPhase(oldPhaseFile).awaiting, "plan");

    const runState = {
        mode: "build",
        phase: "plan",
        qaRetries: 0,
        securityRetries: 0,
        isRevision: false,
        designFormat: "html",
        allow: ["send"],
        tasks: "미용실 예약 웹앱",
        projectDir: context.testDir,
        repos: [],
        progressFile: "progress.md",
        deadline: new Date(2026, 10, 2, 7, 0),
        commitPrefix: "[ap]",
        workBranch: "ai/autopilot",
        phaseDoneRelPath: ".autopilot/progress/2026-10-30/PHASE_DONE",
        brainstorm: ["plan"],
        mains: { plan: "claude" },
        phaseAgents: { phase: "plan", main: "claude", assistant: "codex" },
        crossReview: false,
        debate: ["plan"],
        debateTurns: 3,
        debateStage: null,
        proposalReady: { codex: "docs/autopilot/proposals/plan-codex.md" },
        adoption: null
    };
    const roundPrompt = promptUtil.getRoundPrompt(runState, 1, 60, "", 2);
    const synthesisPrompt = promptUtil.getRoundPrompt({ ...runState, debateStage: "synthesis" }, 2, 60, "", 2);

    assert.match(roundPrompt, /네 산출물을 마치면 앱이 두 AI의 협의를 진행한다/);
    assert.doesNotMatch(roundPrompt, /Codex 안 보관|plan-review-claude/);
    assert.match(synthesisPrompt, /\[기획\] 협의가 끝났다[\s\S]*plan-debate\.md[\s\S]*plan-disputes\.json[\s\S]*\[ap\] 기획: 협의 결과/);
    assert.doesNotMatch(synthesisPrompt, /열지 말고 독립적으로|읽을 수 없었다/);
    assert.match(promptUtil.getRoundPrompt({ ...runState, debateStage: "synthesis", isDisputesRetry: true }, 2, 60, "", 2), /plan-disputes\.json`를 JSON 배열로 읽을 수 없었다/);

    const claudeOpening = promptUtil.getDebateOpeningPrompt(runState, "claude", { docs: { claude: "# 내 안", codex: "x".repeat(70000) } });

    assert.match(claudeOpening, /너는 \[기획\] 협의에 참여한 Claude다[\s\S]*근거 없이 상대 주장을 받아들이거나 양보하지 않는다[\s\S]*"consensus": false/);
    assert.match(claudeOpening, /<CLAUDE_안>\n# 내 안\n<\/CLAUDE_안>/);
    assert.match(claudeOpening, /…\(이하 생략\)\n<\/CODEX_안>/);

    const lastTurn = { provider: "claude", message: "결제는 빼요", agree: [], disagree: [{ point: "결제", reason: "범위" }], improve: [], changes: [], consensus: false };
    const codexOpening = promptUtil.getDebateOpeningPrompt(runState, "codex", { lastTurn: lastTurn, transcript: [{ ...lastTurn, provider: "codex", message: "넣어요" }] });

    assert.match(codexOpening, /읽기만 할 수 있다[\s\S]*지금까지 주고받은 말:\nCodex: \{"message":"넣어요"[\s\S]*Claude의 발언: \{"message":"결제는 빼요"/);

    // 협의하는 두 AI도 정책을 받지 않으므로 기획 협의의 첫 호출에 허용 범위를 적는다.
    assert.match(claudeOpening, /허용하지 않음: 새 라이브러리\(패키지\) 추가[\s\S]*<TASKS>/);
    assert.match(codexOpening, /허용하지 않음: 새 라이브러리\(패키지\) 추가[\s\S]*<TASKS>[\s\S]*지금까지 주고받은 말/, "Codex의 협의도 안을 낸 세션과 다른 새 세션이라 만들 것을 직접 받는다");
    assert.doesNotMatch(promptUtil.getDebateOpeningPrompt({ ...runState, phase: "design" }, "codex", {}), /허용 범위/);
    assert.match(promptUtil.getDebateReplyPrompt(runState, lastTurn, 3), /^Claude의 답: [\s\S]*3\/3번째 주고받기다\. 이번이 마지막 주고받기다/);
    assert.doesNotMatch(promptUtil.getDebateReplyPrompt(runState, lastTurn, 2), /마지막/);
    assert.match(promptUtil.getDebateReplyPrompt({ ...runState, debateTurns: 8 }, lastTurn, 5), /5\/8번째 주고받기다\./);
    assert.match(claudeOpening, /최대 3번 주고받으며[\s\S]*"improve": \["더 개선할 점"\]/);
    assert.match(claudeOpening, /먼저 Codex 안을 네 안과 비교해 의견을 말한다/, "먼저 말하는 메인은 상대 안과 비교한다");

    // 메인이 Codex이면 Codex가 먼저 말하고(저장소를 읽어 두 안을 본다) Claude는 두 안을 본문으로 받아 그 발언에 답한다.
    const codexMainDebate = { ...runState, phaseAgents: { phase: "plan", main: "codex", assistant: "claude" }, proposalReady: { claude: "docs/autopilot/proposals/plan-claude.md" } };
    const codexFirst = promptUtil.getDebateOpeningPrompt(codexMainDebate, "codex", {});

    assert.match(
        codexFirst,
        /너는 \[기획\] 협의에 참여한 Codex다\. 같은 만들 것으로 Codex는 `docs\/autopilot\/plan\.md`를, Claude는 `docs\/autopilot\/proposals\/plan-claude\.md`를 따로 썼다[\s\S]*읽기만 할 수 있다[\s\S]*두 안을 읽고 먼저 Claude 안을 네 안과 비교해 의견을 말한다/
    );
    assert.doesNotMatch(codexFirst, /의 발언:/);

    const codexTurn = { ...lastTurn, provider: "codex", message: "결제는 넣어요" };
    const claudeSecond = promptUtil.getDebateOpeningPrompt(codexMainDebate, "claude", { docs: { codex: "# 코덱스 안", claude: "# 클로드 안" }, lastTurn: codexTurn });

    assert.match(claudeSecond, /아래 Codex의 발언에 답한다[\s\S]*<CLAUDE_안>\n# 클로드 안[\s\S]*<CODEX_안>\n# 코덱스 안[\s\S]*Codex의 발언: \{"message":"결제는 넣어요"/);
    assert.match(promptUtil.getDebateReplyPrompt(codexMainDebate, codexTurn, 2), /^Codex의 답: /);
    assert.match(
        promptUtil.getRoundPrompt({ ...codexMainDebate, debateStage: "synthesis" }, 2, 60, "", 2, "codex"),
        /두 안\(`docs\/autopilot\/plan\.md`, `docs\/autopilot\/proposals\/plan-claude\.md`\)/
    );

    // 승인한 협의 결과는 다음 실행의 첫 일로 확정한다. 쟁점이 없었으면 남은 파일만 commit한다.
    const adoption = { phase: "plan", choices: [{ title: "결제", side: "codex", position: "넣어요" }] };

    assert.match(
        promptUtil.getRoundPrompt({ ...runState, phase: "design", adoption: adoption }, 1, 60, "", 2),
        /못 맞춘 쟁점을 정했다[\s\S]*1\) 결제 → Codex 쪽: 넣어요[\s\S]*`\[ap\] 기획: 쟁점 확정`/
    );
    assert.match(promptUtil.getRoundPrompt({ ...runState, phase: "design", adoption: { ...adoption, choices: [] } }, 1, 60, "", 2), /협의의 합의안을 확인했다[\s\S]*`\[ap\] 기획: 합의안 확정`/);

    // 디자인 안은 메인이 쟁점을 plan.md에 확정하기 전에 받으므로 고른 입장을 직접 받는다.
    assert.match(promptUtil.getProposalPrompt({ ...runState, phase: "design", adoption: adoption }), /쟁점으로 표시한 부분은 사용자가 아래 입장으로 정했다[\s\S]*1\) 결제 → Codex 쪽: 넣어요/);
    assert.doesNotMatch(promptUtil.getProposalPrompt({ ...runState, phase: "design", adoption: { ...adoption, choices: [] } }), /쟁점|사용자가 고른/);
};

// 단계 전환: 확인받기로 둔 단계에서 멈추고, 테스트/QA·보안검토 실패는 단계마다 정한 횟수까지 개발로 되돌린다.
const checkPhaseRules = (context) => {
    const { getPhaseTransition, getStartPhase, readPhase, isPhaseState } = phaseUtil;
    const plan = { phase: "plan", awaiting: null, qaRetries: 0, securityRetries: 0, proposals: null, debate: null, receivedProposal: null };
    const limits = { qa: 3, security: 2 };

    assert.deepEqual(getPhaseTransition(plan, "pass", [], limits), { state: { ...plan, phase: "design" }, event: "next" });
    assert.deepEqual(getPhaseTransition(plan, "", ["plan"], limits), { state: { ...plan, phase: "design", awaiting: "plan" }, event: "await" });
    assert.equal(getPhaseTransition({ ...plan, phase: "build" }, "fail", ["plan", "design"], limits).event, "next");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 1 }, "fail", [], limits), { state: { ...plan, phase: "build", qaRetries: 2 }, event: "retry" });
    assert.equal(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 3 }, "fail", [], limits).event, "failed");
    assert.equal(getPhaseTransition({ ...plan, phase: "qa" }, "fail", [], { qa: 0, security: 3 }).event, "failed");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "qa", qaRetries: 2 }, "pass", [], limits), { state: { ...plan, phase: "security", qaRetries: 2 }, event: "next" });

    // 첫 줄의 `fail`을 꾸미거나 이유를 붙여도, 한국어로 `실패`라고 써도 실패다.
    ["`fail`", "**FAIL**", "fail: 2건 실패", "fail - 로그인 오류", "실패", "**실패** 2건"].forEach((result) => {
        assert.equal(getPhaseTransition({ ...plan, phase: "qa" }, result, [], limits).event, "retry", result);
        assert.equal(getPhaseTransition({ ...plan, phase: "security" }, result, [], limits).event, "retry", result);
    });
    ["pass", "`pass`", "pass (실패 0건)", "0 failures", "통과 (fail 0건)"].forEach((result) => {
        assert.equal(getPhaseTransition({ ...plan, phase: "qa" }, result, [], limits).event, "next", result);
    });

    // 보안검토는 테스트/QA와 따로 센다. 테스트/QA를 다 써도 보안검토는 자기 횟수만큼 되돌린다.
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "security", qaRetries: 3 }, "fail", [], limits), { state: { ...plan, phase: "build", qaRetries: 3, securityRetries: 1 }, event: "retry" });
    assert.equal(getPhaseTransition({ ...plan, phase: "security", securityRetries: 2 }, "fail", [], limits).event, "failed");
    assert.deepEqual(getPhaseTransition({ ...plan, phase: "security", securityRetries: 1 }, "pass", [], limits), { state: { ...plan, phase: "done", securityRetries: 1 }, event: "done" });

    // 승인 없이 다시 시작하면 확인을 기다리던 단계를 다시 한다. 받아 둔 다른 AI의 안도 다시 받는다.
    assert.deepEqual(getStartPhase({ ...plan, phase: "design", awaiting: "plan", receivedProposal: "plan" }), { state: plan, isRevision: true });
    assert.deepEqual(getStartPhase(plan), { state: plan, isRevision: false });

    assert.equal(phaseUtil.parseOnFail("retry:5"), 5);
    assert.equal(phaseUtil.parseOnFail("retry:05"), 5);
    assert.equal(phaseUtil.parseOnFail("stop"), 0);
    assert.equal(phaseUtil.parseOnFail("Retry:1"), null);
    assert(!isPhaseState({ ...plan, awaiting: "qa" }));
    assert(!isPhaseState({ ...plan, qaRetries: -1 }));
    assert(!isPhaseState({ ...plan, securityRetries: 1.5 }));
    assert(isPhaseState({ ...plan, receivedProposal: "design" }));
    assert(!isPhaseState({ ...plan, receivedProposal: "build" }));
    assert.deepEqual(readPhase(path.join(path.sep, "missing", "PHASE.json")), plan);

    // 보안검토가 생기기 전에 쓴 PHASE.json(securityRetries 없음)도 그대로 이어받는다.
    const oldPhaseFile = path.join(context.testDir, "old-phase", "PHASE.json");

    fs.mkdirSync(path.dirname(oldPhaseFile), { recursive: true });
    fs.writeFileSync(oldPhaseFile, JSON.stringify({ phase: "qa", awaiting: null, qaRetries: 2 }));
    assert.deepEqual(readPhase(oldPhaseFile), { phase: "qa", awaiting: null, qaRetries: 2, securityRetries: 0, proposals: null, debate: null, receivedProposal: null });
    fs.writeFileSync(oldPhaseFile, "null");
    assert.deepEqual(readPhase(oldPhaseFile), plan);

    // 신규 개발의 허용 체크만 정책에 덧붙는다. 보내기를 켜지 않았으면 외부 도구 금지를 덧붙인다.
    assert.equal(getAutopilotPolicy("ai/autopilot"), getAutopilotPolicy("ai/autopilot", null));
    assert.doesNotMatch(getAutopilotPolicy("ai/autopilot"), /신규 개발에서 이번 실행에 허용한 것/);
    assert.match(getAutopilotPolicy("ai/autopilot", ["deps"]), /새 라이브러리\(패키지\) 추가를 허용한다[\s\S]*외부 도구\(Codex, MCP 서버/);
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

    // 디자인은 화면을 몇 개씩 나누지 않고 공통 규칙부터 정해 한 회차에 모든 화면을 목표로 한다(회차마다 다시 읽는 비용과 뒤늦은 규칙으로 화면을 고치는 일을 줄인다).
    assert.match(promptUtil.getRoundPrompt({ ...buildState, phase: "design" }, 1, 60, "", 2), /공통 규칙\(색 · 글자 · 간격 · 컴포넌트\)을 먼저 정하고[^\n]*한 회차에 모든 화면/);
    assert.match(promptUtil.getRoundPrompt({ ...buildState, phase: "build", securityRetries: 1 }, 1, 60, "", 2), /테스트\/QA · 보안검토가 되돌린 것이다/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...buildState, phase: "build" }, 1, 60, "", 2), /되돌린 것이다/);

    // 되돌린 뒤 다시 하는 테스트/QA · 보안검토는 앞선 실패 항목부터 본다. 보안검토는 자기가 되돌렸을 때만 앞선 결과가 있다.
    assert.match(promptUtil.getRoundPrompt({ ...buildState, phase: "qa", securityRetries: 1 }, 1, 60, "", 2), /`qa\.md`의 실패 항목과 그 수정이 닿은 기능을 먼저/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...buildState, phase: "qa" }, 1, 60, "", 2), /다시 하는 것이다/);
    assert.match(promptUtil.getRoundPrompt({ ...buildState, phase: "security", securityRetries: 1 }, 1, 60, "", 2), /`남김`으로 둔 심각 · 높음 항목이 고쳐졌는지 먼저/);
    assert.doesNotMatch(promptUtil.getRoundPrompt({ ...buildState, phase: "security", qaRetries: 2 }, 1, 60, "", 2), /다시 하는 것이다/);

    const maintainPrompt = promptUtil.getRoundPrompt({ ...buildState, mode: "maintain" }, 1, 60, "", 2);

    assert.match(maintainPrompt, /작업은 최대 2건/);
    assert(maintainPrompt.includes(getAutopilotGuide("[ap]")));
    assert(!maintainPrompt.includes("<PHASE>"));

    // Codex 회차에는 CLAUDE.md가 자동으로 로드되지 않으므로 직접 읽게 한다. 나머지 프롬프트는 같다.
    const codexPrompt = promptUtil.getRoundPrompt({ ...buildState, mode: "maintain" }, 1, 60, "", 2, "codex");

    assert.match(codexPrompt, /^작업 전에 프로젝트 루트의 `CLAUDE\.md`를 직접 읽어/);
    assert.equal(codexPrompt.slice(codexPrompt.indexOf("중요사항!")), maintainPrompt.slice(maintainPrompt.indexOf("중요사항!")));

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

    // 백그라운드 작업 알림으로 같은 세션이 이어지면 result가 한 번 더 온다. 턴은 더하고 비용은 누적값을 그대로 쓴다.
    handleStreamEvent(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 90, duration_ms: 1000, total_cost_usd: 4.3, result: "첫 결과" }), sessionStats, () => {});
    handleStreamEvent(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 7, duration_ms: 100, total_cost_usd: 4.5, result: "이어진 결과" }), sessionStats, () => {});

    assert.equal(sessionStats.turns, 97);
    assert.equal(sessionStats.cost, 4.5);
    assert.equal(sessionStats.summary, "이어진 결과");

    // 사용량 한도로 끝난 세션은 subtype이 success여도 is_error라 실패로 쓴다.
    const resultLines = [];

    handleStreamEvent(
        JSON.stringify({ type: "result", subtype: "success", is_error: true, num_turns: 33, duration_ms: 1000, total_cost_usd: 2.85, result: "You've hit your 5-hour limit" }),
        {},
        (line) => resultLines.push(line)
    );

    assert.match(resultLines[0], /\[결과\] 실패 · 33턴/);

    // JSON이지만 이벤트가 아닌 줄은 무시한다.
    for (const ignoredLine of ["null", "123", "not json"]) {
        handleStreamEvent(ignoredLine, sessionStats, () => {});
    }

    // Codex 회차의 JSONL은 Claude와 같은 로그 형식으로 바꾼다. 셸로 감싼 명령은 안쪽 명령만, 파일 변경은 Write·Edit·Delete로 쓴다.
    const { handleCodexEvent, getCodexCommand } = streamUtil;
    const codexStats = { limitHit: false, isError: false };
    const codexLines = [];
    const writeCodexLog = (line) => codexLines.push(line.replace(/^\d{2}:\d{2}:\d{2}/, "T"));

    assert.equal(getCodexCommand("bash -lc 'npm test'"), "npm test");
    assert.equal(getCodexCommand('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "git status"'), "git status");
    assert.equal(getCodexCommand("git status"), "git status");

    for (const event of [
        { type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" },
        { type: "turn.started" },
        { type: "item.started", item: { id: "item_0", type: "command_execution", command: "bash -lc 'npm test'", status: "in_progress" } },
        { type: "item.completed", item: { id: "item_0", type: "command_execution", command: "bash -lc 'npm test'", exit_code: 0 } },
        { type: "item.completed", item: { id: "item_1", type: "reasoning", text: "생각" } },
        {
            type: "item.completed",
            item: {
                id: "item_2",
                type: "file_change",
                changes: [
                    { path: "src/a.js", kind: "update" },
                    { path: "src/b.js", kind: "add" }
                ]
            }
        },
        { type: "item.completed", item: { id: "item_3", type: "agent_message", text: "테스트를 고쳤어요." } },
        { type: "error", message: "Reconnecting... 1/5" },
        { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } },
        { type: "unknown.event" }
    ]) {
        handleCodexEvent(JSON.stringify(event), codexStats, writeCodexLog);
    }

    assert.deepEqual(codexLines, [
        "T [세션] 0199a213-81c0-7800-8aa1-bbab2a035a53 (codex resume 으로 전체 기록 확인)",
        "T   > Bash npm test",
        "T   > Edit src/a.js",
        "T   > Write src/b.js",
        "T 테스트를 고쳤어요.",
        "T [오류] Reconnecting... 1/5",
        "T [결과] 완료 · 입력 10 · 출력 2 토큰"
    ]);
    assert.deepEqual(codexStats, { limitHit: false, isError: false, session: "0199a213-81c0-7800-8aa1-bbab2a035a53", summary: "테스트를 고쳤어요." });

    // turn.failed만 회차 실패이고, 한도 문구면 한도 도달로 표시한다(리셋 시각이 없어 실패 재시도로 처리된다).
    handleCodexEvent(JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit." } }), codexStats, writeCodexLog);

    assert.equal(codexStats.isError, true);
    assert.equal(codexStats.limitHit, true);
    assert.equal(codexStats.resetAt, undefined);
    assert.deepEqual(codexLines.slice(-2), ["T [결과] 실패 · You've hit your usage limit.", "T [사용량 한도] Codex You've hit your usage limit."]);
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

// 시한은 벽시계 기준이다. 절전으로 타이머 시계가 멈춰도 깨어나 시한이 지났으면 곧바로 걸린다(Date.now를 앞당겨 흉내 낸다).
const checkDeadlineTimer = async () => {
    const realNow = Date.now;
    const fired = [];

    util.setDeadlineTimer(realNow() + 30, () => fired.push("soon"));
    util.setDeadlineTimer(realNow() + 3600000, () => fired.push("slept"));
    util.setDeadlineTimer(realNow(), () => fired.push("cleared"))();

    await util.sleep(300);
    assert.deepEqual(fired, ["soon"]);

    try {
        Date.now = () => realNow() + 3600000;
        await util.sleep(600);
    } finally {
        Date.now = realNow;
    }

    assert.deepEqual(fired, ["soon", "slept"]);
};

// 로그 파일을 쓰지 못해도 기록 함수는 예외를 던지지 않고 실패가 이어지는 동안 한 번만 알리며, 다시 쓸 수 있게 되면 이어서 쓴다.
const checkFileLogger = (context, errorMessages) => {
    const logDir = path.join(context.testDir, "missing-log-dir");
    const logFile = path.join(logDir, "autopilot.log");
    const writeLog = logUtil.createFileLogger(logFile);
    const errorCount = errorMessages.length;

    writeLog("첫 줄");
    writeLog("둘째 줄");

    assert.equal(errorMessages.length, errorCount + 1);
    assert.match(errorMessages.at(-1), /^\[로그\] 로그 파일에 쓰지 못해/);

    fs.mkdirSync(logDir);
    writeLog("셋째 줄");

    assert.equal(fs.readFileSync(logFile, "utf8"), "셋째 줄\n");
};

export {
    checkFileLogger,
    checkDeadlineTimer,
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
    checkPhaseRules,
    checkAgentRules,
    checkBrainstormRules,
    checkDebateRules
};
