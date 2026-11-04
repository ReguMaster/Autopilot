import {
    BUILD_PHASES,
    DEFAULT_DEBATE_TURNS,
    DEFAULT_DESIGN_FORMAT,
    DEFAULT_GATES,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_RUNNER,
    DEFAULT_SECURITY_ON_FAIL,
    DEFAULT_SECURITY_REVIEW,
    GATE_PHASES,
    ON_FAIL_CHOICES,
    PHASE_LABELS,
    PROVIDER_LABELS,
    SKIPPABLE_PHASES
} from "./constants.js";
import { PROVIDER_LOGOS, getMain, getOtherProvider } from "./phaseAgents.js";

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
// 보안검토의 독립 검토: "점검이 끝나면 [Codex가 다시 확인해요]". 검토자는 메인의 반대쪽 AI이고, 켜면 심각 · 높음을 찾을 때 개발로 되돌린다.
// on은 검토하지 못하면 메인의 판정대로 가고, strict는 검토하지 못한 보안검토를 통과시키지 않고 멈춘다.
const getSecurityReviewOptions = (main, codex) => {
    const reviewer = getOtherProvider(main);
    const name = PROVIDER_LABELS[reviewer];
    const reason = reviewer === "codex" && codex && !codex.available ? codex.reason : "";
    const icon = PROVIDER_LOGOS[reviewer];

    return [
        { value: "off", label: `${PROVIDER_LABELS[main]}가 혼자 판정해요`, hint: "다른 AI의 확인 없이 메인이 pass · fail을 정해요" },
        {
            value: "on",
            label: `${name}가 다시 확인해요`,
            icon: icon,
            hint: reason || "코드를 따로 읽어 심각 · 높음을 찾으면 개발로 되돌려요. 확인하지 못하면 메인 판정대로 가요",
            disabled: Boolean(reason)
        },
        { value: "strict", label: `${name}가 다시 확인하고, 못 하면 멈춰요`, icon: icon, hint: reason || "확인하지 못한 보안검토는 통과시키지 않고 보안검토 실패로 끝내요", disabled: Boolean(reason) }
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

    return [...models.map((model) => ({ value: model.id, label: model.label })), ...extra];
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
const ALLOW_FIXED_NOTE = "비밀값 · 운영 환경 · Git 보호 · 파일 삭제는 어떤 허용을 켜도 그대로 지켜요.";

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

// 이번 실행에서 하지 않는 단계를 건너뛴 첫 단계(엔진의 phaseUtil.skipForward와 같다). 끝까지 건너뛰면 done이다.
const skipForward = (phase, skip = []) => {
    let current = phase;

    while (skip.includes(current)) {
        current = BUILD_PHASES[BUILD_PHASES.indexOf(current) + 1] ?? PHASE_DONE;
    }

    return current;
};

// 어떤 단계 다음에 할 단계(건너뛰는 단계는 넘긴다). 승인 화면이 "확인하고 <다음 단계> 시작"을 쓴다.
const getNextPhase = (phase, skip = []) => {
    return skipForward(BUILD_PHASES[BUILD_PHASES.indexOf(phase) + 1] ?? PHASE_DONE, skip);
};

// PHASE.json이 가리키는 단계의 순서. 모두 마쳤으면 단계 수다. 이 순서 앞의 단계는 이미 지나갔으므로 건너뛰기로 보이지 않는다.
const getPassedCount = (buildPhase) => {
    const phase = buildPhase?.phase || BUILD_PHASES[0];

    return phase === PHASE_DONE ? BUILD_PHASES.length : Math.max(0, BUILD_PHASES.indexOf(phase));
};

// 다음 실행이 시작할 단계. 확인을 기다리던 단계를 승인 없이 시작하면 그 단계를 다시 한다(엔진의 getStartPhase). 모두 마쳤으면 done이다.
// 남은 단계를 모두 건너뛰도록 골랐으면(isAllSkipped) 엔진이 시작하지 않으므로 done이 아니라 지금 단계에 머문다.
const getBuildStartPhase = (buildPhase, skip = []) => {
    if (buildPhase?.awaiting) {
        return buildPhase.awaiting;
    }

    const phase = buildPhase?.phase || BUILD_PHASES[0];
    const startPhase = skipForward(phase, skip);

    return startPhase === PHASE_DONE && phase !== PHASE_DONE ? phase : startPhase;
};

const isAllSkipped = (buildPhase, skip = []) => {
    const phase = buildPhase?.phase;

    return Boolean(phase) && !buildPhase.awaiting && phase !== PHASE_DONE && skipForward(phase, skip) === PHASE_DONE;
};

// 단계 문장의 앞머리 선택: 이 단계를 할지 건너뛸지. 기획과 개발은 건너뛸 수 없다.
const SKIP_OPTIONS = [
    { value: "run", label: "진행해요", hint: "이 단계를 하고 산출물을 남겨요" },
    { value: "skip", label: "건너뛰어요", hint: "이 단계를 하지 않고 다음 단계로 가요" }
];
// 건너뛰기로 하면 잃는 것. 보안검토처럼 놓치기 쉬운 단계는 사용자가 알고 고르게 한다.
const SKIP_NOTES = {
    design: "기획서의 화면 목록과 저장소에 이미 있는 스타일을 따라 개발해요.",
    qa: "개발이 끝나면 따로 확인하지 않고 마쳐요. qa.md가 남지 않아요.",
    security: "보안 점검 기록(security.md)이 남지 않아요. 배포 전에 직접 확인해 주세요."
};

// 기획서의 화면 목록(5절)이 `화면 없음`으로 시작하면 화면이 없는 프로젝트(CLI · 라이브러리 · 서버 등)다. 승인 화면이 디자인을 건너뛰자고 제안한다.
const hasNoScreens = (planText) => {
    const lines = String(planText ?? "").split(/\r?\n/);
    const start = lines.findIndex((line) => /^#{1,6}\s*(?:\*\*)?5\s*[).:]/.test(line) && /화면|명령|API/i.test(line));

    if (start < 0) {
        return false;
    }

    const next = lines.findIndex((line, index) => index > start && /^#{1,6}\s/.test(line));
    const body = lines.slice(start + 1, next < 0 ? undefined : next).filter((line) => line.trim());

    return body.slice(0, 3).some((line) => /화면\s*없음/.test(line));
};

// 시작 전 단계 카드의 칸: 지난 단계는 done, 확인을 기다리는 단계는 hold, 이어서 할 단계는 next, 나머지는 waiting이다.
const getReadySteps = (buildPhase, skip = []) => {
    const startPhase = getBuildStartPhase(buildPhase, skip);
    const startIndex = startPhase === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(startPhase);
    const passedCount = getPassedCount(buildPhase);

    return BUILD_PHASES.map((phase, index) => {
        if (skip.includes(phase) && index >= passedCount) {
            return { phase: phase, state: "skipped", detail: "건너뛰어요" };
        }

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
const getBuildGreeting = ({ buildPhase, endLabel, gates, skip = [] }) => {
    const startPhase = getBuildStartPhase(buildPhase, skip);

    if (startPhase === PHASE_DONE) {
        return { title: "모든 단계를 마쳤어요", lead: "유지 보수로 바꾸면 만든 것을 이어서 다듬을 수 있어요. 처음부터 다시 만들려면 설정에서 진행 기록을 초기화해 주세요." };
    }

    const label = PHASE_LABELS[startPhase];
    const startIndex = BUILD_PHASES.indexOf(startPhase);
    const gateLabels = GATE_PHASES.filter((phase) => gates.includes(phase) && !skip.includes(phase) && BUILD_PHASES.indexOf(phase) >= startIndex).map((phase) => PHASE_LABELS[phase]);
    const skipLabels = SKIPPABLE_PHASES.filter((phase) => skip.includes(phase) && BUILD_PHASES.indexOf(phase) >= startIndex).map((phase) => PHASE_LABELS[phase]);
    const gateText = `${gateLabels.length ? ` ${gateLabels.join("·")} 단계가 끝나면 멈추고 확인을 기다려요.` : ""}${skipLabels.length ? ` ${skipLabels.join("·")} 단계는 건너뛰어요.` : ""}`;

    if (buildPhase?.awaiting) {
        return { title: `${label} 확인을 기다리고 있어요`, lead: `산출물을 확인하고 고칠 점을 적어 주시면 ${label}을 다시 해요. ${endLabel}까지 이어 갈게요.${gateText}` };
    }

    if (startIndex === 0) {
        return { title: "무엇을 만들어 볼까요?", lead: `적어 주신 내용으로 기획부터 시작해서 ${endLabel}까지 이어 갈게요.${gateText}` };
    }

    return { title: "이어서 만들어 볼까요?", lead: `${label} 단계부터 이어서 할게요. ${endLabel}까지 해 둘게요.${gateText}` };
};

// 신규 개발의 주 버튼 글자: 다음에 할 단계 이름. 확인을 기다리던 단계는 다시 하고, 모두 마쳤으면 시작할 수 없다.
const getBuildActionLabel = (buildPhase, skip = []) => {
    const startPhase = getBuildStartPhase(buildPhase, skip);

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

// 시작 전 단계 줄이 접혔을 때 보이는 요약. 펼치면 보이는 설정 문장을 "·"로 이어 줄인 말이고, isChanged는 기본값과 다른 설정이 있는지다. config는 컴포저 스토어의 값이다.
const getAssistText = (main, mode) => {
    const name = PROVIDER_LABELS[getOtherProvider(main)];

    return { none: "보조 없이", compare: `${name}와 안 비교`, debate: `${name}와 협의` }[mode];
};

const getGateText = (phase, mode, gates) => {
    if (mode !== "none") {
        return `끝나면 ${BRAINSTORM_AFTER[mode]}`;
    }

    return `끝나면 ${GATE_OPTIONS.find((option) => option.value === (gates.includes(phase) ? "stop" : "go")).label}`;
};

const getOnFailText = (phase, value) => {
    const retries = getMaxRetries(value);

    return retries ? `${ON_FAIL_SUBJECTS[phase]} 개발로 최대 ${retries}번` : `${ON_FAIL_SUBJECTS[phase]} 멈춰요`;
};

const getReviewText = (main, mode) => {
    const name = PROVIDER_LABELS[getOtherProvider(main)];

    return { off: "독립 검토 없이", on: `${name}가 다시 확인`, strict: `${name}가 다시 확인, 못 하면 멈춰요` }[mode];
};

const getDesignFormatText = (designFormat, allow) => {
    const isBlocked = ["figma", "image"].includes(designFormat) && !allow.includes("send");
    const shown = isBlocked ? DEFAULT_DESIGN_FORMAT : designFormat;
    const label = DESIGN_FORMAT_OPTIONS.find((option) => option.value === shown).label;

    return isBlocked ? `${label}(보내기를 꺼서)` : label;
};

const getPhaseSummary = (phase, config) => {
    const { mains, skip, gates, allow, designFormat, qaOnFail, securityOnFail, securityReview } = config;
    const main = getMain(mains, phase);
    const mode = getBrainstormMode(config, phase);
    const mainText = `${PROVIDER_LABELS[main]} 메인`;
    const isMainChanged = main !== DEFAULT_RUNNER;
    const isGateChanged = gates.includes(phase) !== DEFAULT_GATES.includes(phase);

    if (skip.includes(phase)) {
        return { text: "건너뛰어요", isChanged: true };
    }

    if (phase === "plan") {
        return { text: [mainText, getAssistText(main, mode), getGateText(phase, mode, gates)].join(" · "), isChanged: isMainChanged || mode !== "none" || isGateChanged };
    }

    if (phase === "design") {
        return {
            text: [getDesignFormatText(designFormat, allow), mainText, getAssistText(main, mode), getGateText(phase, mode, gates)].join(" · "),
            isChanged: isMainChanged || mode !== "none" || isGateChanged || designFormat !== DEFAULT_DESIGN_FORMAT
        };
    }

    if (phase === "qa") {
        return { text: [mainText, getOnFailText(phase, qaOnFail)].join(" · "), isChanged: isMainChanged || qaOnFail !== DEFAULT_QA_ON_FAIL };
    }

    if (phase === "security") {
        return {
            text: [mainText, getOnFailText(phase, securityOnFail), getReviewText(main, securityReview)].join(" · "),
            isChanged: isMainChanged || securityOnFail !== DEFAULT_SECURITY_ON_FAIL || securityReview !== DEFAULT_SECURITY_REVIEW
        };
    }

    return { text: mainText, isChanged: isMainChanged };
};

// 보조를 쓰는 단계가 함께 쓰는 값(협의 횟수·교차검토)의 요약. modes는 설정을 보이고 있는 기획·디자인의 보조 방식이다.
const getAssistSummary = (modes, { debateTurns, crossReview }) => {
    const hasDebate = modes.includes("debate");
    const hasCompare = modes.includes("compare");
    const crossText = crossReview ? "서로 검토해요" : "검토는 건너뛰어요";
    const text = [hasDebate ? `협의 최대 ${debateTurns}번` : "", hasCompare ? crossText : ""].filter(Boolean).join(" · ");

    return { text: text, isChanged: (hasDebate && debateTurns !== DEFAULT_DEBATE_TURNS) || (hasCompare && crossReview) };
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
const getRunSteps = ({ step, buildPhase, gates, qaOnFail, securityOnFail, round, skip = [] }) => {
    const current = step?.phase || getBuildStartPhase(buildPhase, skip);
    const currentIndex = current === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(current);
    const onFail = { qa: qaOnFail, security: securityOnFail };

    return BUILD_PHASES.map((phase, index) => {
        if (skip.includes(phase) && index !== currentIndex) {
            return { phase: phase, state: "skipped", detail: "건너뛰었어요" };
        }

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
const getPhaseDocs = ({ step, buildPhase, gates, designFormat, skip = [] }) => {
    const current = step?.phase || getBuildStartPhase(buildPhase, skip);
    const currentIndex = current === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(current);
    const retries = { qa: step?.qaRetries || buildPhase?.qaRetries || 0, security: step?.securityRetries || buildPhase?.securityRetries || 0 };
    const docs = [
        { phase: "plan", path: "docs/autopilot/plan.md" },
        { phase: "design", path: designFormat === "md" ? "docs/autopilot/design.md" : "docs/autopilot/design/" },
        { phase: "qa", path: "docs/autopilot/qa.md" },
        { phase: "security", path: "docs/autopilot/security.md" }
    ];

    return docs
        .filter((doc) => !skip.includes(doc.phase))
        .filter((doc) => BUILD_PHASES.indexOf(doc.phase) <= currentIndex || retries[doc.phase] > 0)
        .map((doc) => {
            const isWriting = doc.phase === current && step?.status !== "done";

            if (BUILD_PHASES.indexOf(doc.phase) > currentIndex) {
                return { ...doc, note: "고칠 항목" };
            }

            if (isWriting) {
                return { ...doc, note: "쓰는 중" };
            }

            return { ...doc, note: gates.includes(doc.phase) ? "확인함" : "마침" };
        });
};

// 확인을 기다리던 단계를 고칠 점과 함께 다시 할 때 엔진에 넘기는 작업. 처음 적은 만들 것도 함께 넘겨 기준을 잃지 않게 한다.
const getRevisionTasks = (feedback, tasks) => {
    const original = tasks.trim();

    return ["수정 요청:", feedback.trim(), ...(original ? ["", "처음 적은 만들 것:", original] : [])].join("\n");
};

// 레일 프로젝트 줄의 단계 눈금(다섯 칸). 마친 단계는 done, 지금 단계는 active·hold(확인 대기)·stop(종료 신호), 아직인 단계는 빈 문자열이다.
// 실행 중이면 step({ phase, status })이, 쉬는 중이면 단계 상태(buildPhase)가 기준이고 신규 개발을 한 적 없거나 알 수 없으면 null이다.
const getTickPhase = ({ status, mode, step, buildPhase }) => {
    if (status === "idle") {
        return buildPhase?.awaiting || buildPhase?.phase;
    }

    return mode === "build" ? step?.phase : "";
};

const getNowTick = ({ status, step, buildPhase }) => {
    const stepStates = { awaiting: "hold", done: "done", failed: "stop" };

    if (status === "idle") {
        return buildPhase?.awaiting ? "hold" : "";
    }

    if (status === "stopping") {
        return "stop";
    }

    return stepStates[step?.status] ?? "active";
};

const getTabTicks = (tab) => {
    const phase = getTickPhase(tab);
    const index = phase === PHASE_DONE ? BUILD_PHASES.length : BUILD_PHASES.indexOf(phase ?? "");

    if (index < 0 || (index === 0 && tab.status === "idle" && !tab.buildPhase?.awaiting)) {
        return null;
    }

    const nowTick = getNowTick(tab);

    return BUILD_PHASES.map((item, tick) => {
        if (tick === index) {
            return nowTick;
        }

        return tick < index ? "done" : "";
    });
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
    getSecurityReviewOptions,
    getCodexModelOptions,
    getBrainstormMode,
    MAX_ON_FAIL_RETRIES,
    getMaxRetries,
    toOnFailValue,
    getPhaseSummary,
    getAssistSummary,
    ON_FAIL_WHEN,
    ALLOW_OPTIONS,
    ALLOW_RISKS,
    ALLOW_FIXED_NOTE,
    getAllowRisk,
    getAllowUsage,
    getBuildStartPhase,
    getNextPhase,
    isAllSkipped,
    SKIP_OPTIONS,
    SKIP_NOTES,
    hasNoScreens,
    getReadySteps,
    getBuildGreeting,
    getBuildActionLabel,
    getOnFailLabel,
    getRunSteps,
    getTabTicks,
    getPhaseDocs,
    getRevisionTasks
};
