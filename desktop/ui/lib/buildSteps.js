import { BUILD_PHASES, GATE_PHASES, ON_FAIL_CHOICES, PHASE_LABELS, PROVIDER_LABELS } from "./constants.js";
import { PROVIDER_LOGOS, getOtherProvider } from "./phaseAgents.js";

// 신규 개발 단계 카드와 시작 전 안내에 쓰는 문구. DOM에 의존하지 않아 tests/checkDesktopUi.js가 그대로 부른다.
const PHASE_DETAILS = { plan: "만들 것을 정리해요", design: "화면을 그려요", build: "코드를 짜고 커밋해요", qa: "확인하고 고쳐요", security: "약점을 찾아 고쳐요" };
const PHASE_DONE = "done";

const DESIGN_FORMAT_OPTIONS = [
    { value: "html", label: "HTML 와이어프레임", hint: "화면마다 정적 HTML 파일을 만들어요" },
    { value: "md", label: "문서(md)", hint: "글과 ASCII 와이어프레임으로 정리해요" },
    { value: "figma", label: "Figma", hint: "Figma MCP로 그려요. 외부 서비스 보내기가 필요해요" },
    { value: "image", label: "이미지(Codex)", hint: "codex exec로 시안 이미지를 만들어요. 외부 서비스 보내기가 필요해요" }
];

// 단계 설정은 문장으로 읽힌다(BuildReady). 선택 상자의 label은 문장 속에서 이어 읽히는 말이고, 목록에서는 hint가 그 뜻을 풀어 준다.
// 단계 문장의 메인: "기획은 [Codex가 메인]이고". Codex를 쓸 수 없으면(설치·로그인 안 됨) 그 이유를 알리고 고를 수 없게 한다.
const getMainOptions = (codex) => {
    const reason = codex && !codex.available ? codex.reason : "";

    return [
        { value: "claude", label: "Claude가 메인", icon: PROVIDER_LOGOS.claude, hint: "이 단계의 회차를 Claude가 돌려요" },
        { value: "codex", label: "Codex가 메인", icon: PROVIDER_LOGOS.codex, hint: reason || "이 단계의 회차를 Codex가 돌려요", disabled: Boolean(reason) }
    ];
};

// 기획 · 디자인의 보조: "[Claude와 협의해서] 진행하고". 보조는 메인의 반대쪽 AI이고, 나란히 비교면 두 안 중에서, 협의면 못 맞춘 쟁점만 골라요.
const getAssistOptions = (main, codex) => {
    const assistant = getOtherProvider(main);
    const name = PROVIDER_LABELS[assistant];
    const reason = assistant === "codex" && codex && !codex.available ? codex.reason : "";
    const icon = PROVIDER_LOGOS[assistant];

    return [
        { value: "none", label: "보조 없이", hint: `${PROVIDER_LABELS[main]} 혼자 안을 써요` },
        { value: "compare", label: `${name}가 따로 안을 내서`, icon: icon, hint: reason || "끝나면 두 안을 나란히 보고 하나를 골라요", disabled: Boolean(reason) },
        { value: "debate", label: `${name}와 협의해서`, icon: icon, hint: reason || "더 고칠 것이 없을 때까지 주고받고, 못 맞춘 쟁점만 골라요", disabled: Boolean(reason) }
    ];
};
// 기획 · 디자인이 끝났을 때: "끝나면 [멈추고 확인 받을게요]". 두 AI가 쓴 단계는 늘 멈추므로 이 선택은 잠긴다.
const GATE_OPTIONS = [
    { value: "stop", label: "멈추고 확인 받을게요", hint: "산출물을 직접 보고 승인해야 다음 단계로 가요" },
    { value: "go", label: "바로 다음 단계로 갈게요", hint: "확인 없이 이어서 진행해요" }
];
// 두 AI가 쓴 단계가 끝나고 멈춰서 하는 일
const BRAINSTORM_AFTER = { compare: "두 안 중에서 고를게요", debate: "못 맞춘 쟁점만 고를게요" };
const CROSS_REVIEW_OPTIONS = [
    { value: "on", label: "서로 검토도 해요", hint: "상대가 쓴 안을 읽고 검토를 남겨요" },
    { value: "off", label: "검토는 건너뛰어요", hint: "두 안만 받아서 나란히 보여 줘요" }
];

// models는 Codex가 알려준 [{ id, label }]이다. 저장된 모델이 목록에 없어도(목록을 못 읽었거나 내려간 모델) 고른 값은 그대로 보인다.
const getCodexModelOptions = (models, current) => {
    const extra = current && !models.some((model) => model.id === current) ? [{ value: current, label: current }] : [];

    return [{ value: "", label: "기본 모델", hint: "Codex 설정" }, ...models.map((model) => ({ value: model.id, label: model.label })), ...extra];
};

// Codex 설정을 따를 때 실제로 쓰이는 값. codex는 메인이 알려 준 { models, defaults }이고, 모르면 빈 값이다.
// Effort는 Codex 설정이 먼저이고, 없으면 쓰일 모델(고른 모델이나 설정의 모델)의 기본 Effort다.
const getCodexDefaults = (codex, codexModel = "") => {
    const models = codex?.models ?? [];
    const defaults = codex?.defaults ?? { model: "", effort: "" };
    const findModel = (id) => models.find((model) => model.id === id);

    return {
        modelLabel: defaults.model ? findModel(defaults.model)?.label || defaults.model : "",
        effort: defaults.effort || findModel(codexModel || defaults.model)?.defaultEffort || ""
    };
};

// 그 단계의 보조 방식(none: 보조 없이, compare: 나란히 비교, debate: 협의). 협의는 나란히 비교의 한 갈래라 brainstorm과 debate에 함께 든다.
const getBrainstormMode = ({ brainstorm, debate }, phase) => {
    if (!brainstorm.includes(phase)) {
        return "none";
    }

    return debate.includes(phase) ? "debate" : "compare";
};
const ON_FAIL_SUBJECTS = { qa: "실패하면", security: "심각하면" };
// 단계 설정 문장의 첫머리
const ON_FAIL_WHEN = { qa: "테스트/QA에서 실패하면", security: "보안검토에서 심각한 문제가 남으면" };

// 허용 항목. 위험도가 낮은 것부터 늘어놓고, desc는 허용하면 무엇을 하는지, risk는 위험한 정도와 이유(riskNote), keeps는 허용해도 지키는 선이다(엔진 guideText의 ALLOWED_LINES와 같은 뜻).
const ALLOW_RISKS = { low: "낮음", mid: "보통", high: "높음" };
const ALLOW_OPTIONS = [
    {
        key: "large",
        label: "큰 구조 만들기",
        desc: "폴더 구조와 프레임워크를 처음부터 정해요",
        risk: "low",
        riskNote: "새로 만드는 부분에만 적용돼요",
        keeps: "이미 있는 코드를 지우거나 갈아엎지는 않아요"
    },
    {
        key: "deps",
        label: "새 라이브러리 추가",
        desc: "필요한 패키지를 새로 설치해요",
        risk: "mid",
        riskNote: "의존성이 늘고 패키지 보안과 라이선스를 따져 봐야 해요",
        keeps: "기존 라이브러리는 지우거나 바꾸지 않고, 고른 이유를 기획서와 커밋에 남겨요"
    },
    {
        key: "external-api",
        label: "외부 API 호출 코드",
        desc: "결제, 지도처럼 바깥 서버를 부르는 코드를 짜요",
        risk: "mid",
        riskNote: "실제로 호출하면 비용이나 개인정보 문제가 생길 수 있어요",
        keeps: "키와 토큰은 코드에 넣지 않고 환경 변수 자리만 만들어요. telemetry도 넣지 않아요"
    },
    {
        key: "send",
        label: "외부 서비스로 코드 보내기",
        desc: "Codex, Figma, 이미지 생성 도구에 프로젝트 내용을 보내요",
        risk: "high",
        riskNote: "프로젝트 내용이 이 PC 밖으로 나가요",
        keeps: "인증정보, .env, 사용자 데이터는 보내지 않아요"
    }
];
// 풀 수 없는 규칙. 어떤 허용을 켜도 그대로 지킨다.
const ALLOW_FIXED_RULES = ["비밀값", "운영 환경", "Git 보호", "파일 삭제"];

// 고른 허용 중 가장 높은 위험도(low·mid·high). 고른 것이 없으면 빈 문자열이다.
const getAllowRisk = (allow) => {
    const levels = Object.keys(ALLOW_RISKS);
    const picked = ALLOW_OPTIONS.filter((option) => allow.includes(option.key)).map((option) => levels.indexOf(option.risk));

    return picked.length ? levels[Math.max(...picked)] : "";
};

// 지금 설정이 이 허용에 기대고 있다면 그 사실을 알린다. 보내기를 끄면 Codex 브레인스토밍은 Claude만으로, Figma·이미지 시안은 HTML로 바뀐다.
const getAllowUsage = (key, { brainstorm, designFormat }) => {
    if (key !== "send") {
        return [];
    }

    return [
        ...(brainstorm.length ? ["Codex와 함께 쓰는 단계가 있어요. 끄면 Claude만 써요."] : []),
        ...(["figma", "image"].includes(designFormat) ? ["Figma·이미지 시안에 필요해요. 끄면 HTML로 만들어요."] : [])
    ];
};

// 다음 실행이 시작할 단계. 확인을 기다리던 단계를 승인 없이 시작하면 그 단계를 다시 한다(엔진의 getStartPhase). 모두 마쳤으면 done이다.
const getBuildStartPhase = (buildPhase) => {
    return buildPhase?.awaiting || buildPhase?.phase || BUILD_PHASES[0];
};

// 시작 전 단계 카드의 칸: 지난 단계는 done, 확인을 기다리는 단계는 hold, 이어서 할 단계는 next, 나머지는 waiting이다.
const getReadySteps = (buildPhase) => {
    const startPhase = getBuildStartPhase(buildPhase);
    const startIndex = startPhase === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(startPhase);

    return BUILD_PHASES.map((phase, index) => {
        if (index < startIndex) {
            return { phase: phase, state: "done", detail: "마쳤어요" };
        }

        if (index === startIndex && buildPhase?.awaiting) {
            return { phase: phase, state: "hold", detail: "확인을 기다려요" };
        }

        if (index === startIndex && startIndex > 0) {
            return { phase: phase, state: "next", detail: "여기부터 이어서 해요" };
        }

        return { phase: phase, state: "waiting", detail: PHASE_DETAILS[phase] };
    });
};

// 시작 전 제목과 안내. endLabel은 문장 속 종료 시각(formatEndTimeShort)이다.
const getBuildGreeting = ({ buildPhase, endLabel, gates }) => {
    const startPhase = getBuildStartPhase(buildPhase);

    if (startPhase === PHASE_DONE) {
        return { title: "모든 단계를 마쳤어요", lead: "유지 보수로 바꾸면 만든 것을 이어서 다듬을 수 있어요. 처음부터 다시 만들려면 설정에서 진행 기록을 초기화해 주세요." };
    }

    const label = PHASE_LABELS[startPhase];
    const startIndex = BUILD_PHASES.indexOf(startPhase);
    const gateLabels = GATE_PHASES.filter((phase) => gates.includes(phase) && BUILD_PHASES.indexOf(phase) >= startIndex).map((phase) => PHASE_LABELS[phase]);
    const gateText = gateLabels.length ? ` ${gateLabels.join("·")} 단계가 끝나면 멈추고 확인을 기다려요.` : "";

    if (buildPhase?.awaiting) {
        return { title: `${label} 확인을 기다리고 있어요`, lead: `산출물을 확인하고 고칠 점을 적어 주시면 ${label}을 다시 해요. ${endLabel}까지 이어 갈게요.${gateText}` };
    }

    if (startIndex === 0) {
        return { title: "무엇을 만들어 볼까요?", lead: `적어 주신 내용으로 기획부터 시작해서 ${endLabel}까지 이어 갈게요.${gateText}` };
    }

    return { title: "이어서 만들어 볼까요?", lead: `${label} 단계부터 이어서 할게요. ${endLabel}까지 해 둘게요.${gateText}` };
};

// 신규 개발의 주 버튼 글자: 다음에 할 단계 이름. 확인을 기다리던 단계는 다시 하고, 모두 마쳤으면 시작할 수 없다.
const getBuildActionLabel = (buildPhase) => {
    const startPhase = getBuildStartPhase(buildPhase);

    if (startPhase === PHASE_DONE) {
        return "모두 마쳤어요";
    }

    return buildPhase?.awaiting ? `${PHASE_LABELS[startPhase]} 다시 하기` : `${PHASE_LABELS[startPhase]} 시작`;
};

// 기다리는 테스트/QA·보안검토 칸의 설명(예: 개발로 최대 3번). 다섯 칸이 한 줄에 들어가도록 짧게 쓴다.
const getOnFailLabel = (phase, value) => {
    const subject = ON_FAIL_SUBJECTS[phase];

    if (!subject || !ON_FAIL_CHOICES.includes(value)) {
        return "";
    }

    return value === "stop" ? `${subject} 멈춰요` : `개발로 최대 ${value.split(":")[1]}번`;
};

const getMaxRetries = (value) => {
    return value === "stop" ? 0 : Number(String(value).split(":")[1] || 0);
};

// 테스트/QA·보안검토가 실패하면 개발로 되돌리는 횟수. 화면은 횟수(0~MAX_ON_FAIL_RETRIES)로 정하고, 저장하는 값은 stop(0번)이거나 retry:N이다.
const MAX_ON_FAIL_RETRIES = Math.max(...ON_FAIL_CHOICES.map(getMaxRetries));
const toOnFailValue = (count) => {
    return count > 0 ? `retry:${count}` : "stop";
};

// 되돌아온 개발 칸의 설명. 테스트/QA와 보안검토가 되돌린 횟수를 따로 보여준다(예: 다시 개발 QA 1/3, 둘 다면 QA 1/3, 보안 1/3).
const getRetryText = (step, qaOnFail, securityOnFail) => {
    const parts = [step?.qaRetries ? `QA ${step.qaRetries}/${getMaxRetries(qaOnFail)}` : "", step?.securityRetries ? `보안 ${step.securityRetries}/${getMaxRetries(securityOnFail)}` : ""].filter(
        Boolean
    );

    return parts.length === 1 ? `다시 개발 ${parts[0]}` : parts.join(", ");
};

// 실행 중·마친 뒤의 단계 카드. 엔진의 [단계] 줄(step)이 있으면 그 단계가 지금이고, 오기 전에는 시작할 단계(buildPhase)가 지금이다.
// 마친 단계 중 확인받기로 둔 것은 "확인함", 테스트/QA·보안검토에서 돌아온 개발은 몇 번째로 다시 하는지 보여준다.
const getRunSteps = ({ step, buildPhase, gates, qaOnFail, securityOnFail, round }) => {
    const current = step?.phase || getBuildStartPhase(buildPhase);
    const currentIndex = current === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(current);
    const onFail = { qa: qaOnFail, security: securityOnFail };

    return BUILD_PHASES.map((phase, index) => {
        if (index < currentIndex || (index === currentIndex && step?.status === "done")) {
            return { phase: phase, state: "done", detail: gates.includes(phase) ? "확인함" : "마쳤어요" };
        }

        if (index === currentIndex && step?.status === "awaiting") {
            return { phase: phase, state: "hold", detail: "확인을 기다려요" };
        }

        if (index === currentIndex && step?.status === "failed") {
            return { phase: phase, state: "hold", detail: "문제가 남았어요" };
        }

        if (index === currentIndex) {
            const retryText = phase === "build" ? getRetryText(step, qaOnFail, securityOnFail) : "";

            return { phase: phase, state: "active", detail: retryText || (round ? `${round}회차` : "준비하고 있어요") };
        }

        return { phase: phase, state: "waiting", detail: getOnFailLabel(phase, onFail[phase]) || PHASE_DETAILS[phase] };
    });
};

// 실행 중 카드의 단계 문서: 지금까지 온 단계의 산출물. 지금 단계 것은 쓰는 중, 지난 단계 것은 확인받기로 뒀으면 확인함이다.
// 테스트/QA·보안검토가 개발로 되돌렸으면 그 기록(qa.md·security.md)은 이미 있으므로 고칠 항목으로 함께 보여준다.
const getPhaseDocs = ({ step, buildPhase, gates, designFormat }) => {
    const current = step?.phase || getBuildStartPhase(buildPhase);
    const currentIndex = current === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(current);
    const retries = { qa: step?.qaRetries || buildPhase?.qaRetries || 0, security: step?.securityRetries || buildPhase?.securityRetries || 0 };
    const docs = [
        { phase: "plan", path: "docs/autopilot/plan.md" },
        { phase: "design", path: designFormat === "md" ? "docs/autopilot/design.md" : "docs/autopilot/design/" },
        { phase: "qa", path: "docs/autopilot/qa.md" },
        { phase: "security", path: "docs/autopilot/security.md" }
    ];

    return docs
        .filter((doc) => BUILD_PHASES.indexOf(doc.phase) <= currentIndex || retries[doc.phase] > 0)
        .map((doc) => {
            const isWriting = doc.phase === current && step?.status !== "done";

            if (BUILD_PHASES.indexOf(doc.phase) > currentIndex) {
                return { ...doc, note: "고칠 항목" };
            }

            return { ...doc, note: isWriting ? "쓰는 중" : gates.includes(doc.phase) ? "확인함" : "마침" };
        });
};

// 확인을 기다리던 단계를 고칠 점과 함께 다시 할 때 엔진에 넘기는 작업. 처음 적은 만들 것도 함께 넘겨 기준을 잃지 않게 한다.
const getRevisionTasks = (feedback, tasks) => {
    const original = tasks.trim();

    return ["수정 요청:", feedback.trim(), ...(original ? ["", "처음 적은 만들 것:", original] : [])].join("\n");
};

// 레일 프로젝트 줄의 단계 눈금(다섯 칸). 마친 단계는 done, 지금 단계는 active·hold(확인 대기)·stop(종료 신호), 아직인 단계는 빈 문자열이다.
// 실행 중이면 step({ phase, status })이, 쉬는 중이면 단계 상태(buildPhase)가 기준이고 신규 개발을 한 적 없거나 알 수 없으면 null이다.
const getTabTicks = ({ status, mode, step, buildPhase }) => {
    const isRunning = status !== "idle";
    const phase = isRunning ? (mode === "build" ? step?.phase : "") : buildPhase?.awaiting || buildPhase?.phase;
    const index = phase === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(phase ?? "");

    if (index < 0 || (index === 0 && !isRunning && !buildPhase?.awaiting)) {
        return null;
    }

    const stepStates = { awaiting: "hold", done: "done", failed: "stop" };
    const runningState = status === "stopping" ? "stop" : (stepStates[step?.status] ?? "active");
    const nowState = isRunning ? runningState : buildPhase?.awaiting ? "hold" : "";

    return BUILD_PHASES.map((item, tick) => (tick < index ? "done" : tick === index ? nowState : ""));
};

export {
    PHASE_DETAILS,
    PHASE_DONE,
    DESIGN_FORMAT_OPTIONS,
    getMainOptions,
    getAssistOptions,
    BRAINSTORM_AFTER,
    GATE_OPTIONS,
    CROSS_REVIEW_OPTIONS,
    getCodexModelOptions,
    getCodexDefaults,
    getBrainstormMode,
    MAX_ON_FAIL_RETRIES,
    getMaxRetries,
    toOnFailValue,
    ON_FAIL_WHEN,
    ALLOW_OPTIONS,
    ALLOW_RISKS,
    ALLOW_FIXED_RULES,
    getAllowRisk,
    getAllowUsage,
    getBuildStartPhase,
    getReadySteps,
    getBuildGreeting,
    getBuildActionLabel,
    getOnFailLabel,
    getRunSteps,
    getTabTicks,
    getPhaseDocs,
    getRevisionTasks
};
