import { BUILD_PHASES, GATE_PHASES, ON_FAIL_CHOICES, PHASE_LABELS } from "./constants.js";

// 신규 개발 단계 카드와 시작 전 안내에 쓰는 문구. DOM에 의존하지 않아 tests/checkDesktopUi.js가 그대로 부른다.
const PHASE_DETAILS = { plan: "만들 것을 정리해요", design: "화면을 그려요", build: "코드를 짜고 커밋해요", qa: "확인하고 고쳐요", security: "약점을 찾아 고쳐요" };
const PHASE_DONE = "done";

const DESIGN_FORMAT_OPTIONS = [
    { value: "html", label: "HTML 와이어프레임", hint: "화면마다 정적 HTML 파일을 만들어요" },
    { value: "md", label: "문서(md)", hint: "글과 ASCII 와이어프레임으로 정리해요" },
    { value: "figma", label: "Figma", hint: "Figma MCP로 그려요. 외부 서비스 보내기가 필요해요" },
    { value: "image", label: "이미지(Codex)", hint: "codex exec로 시안 이미지를 만들어요. 외부 서비스 보내기가 필요해요" }
];

// 테스트/QA·보안검토가 실패하면 개발로 되돌리는 횟수. 칸이 좁아 선택 상자에는 짧은 이름만 쓰고 뜻은 칸의 설명이 맡는다.
const ON_FAIL_OPTIONS = [
    ...ON_FAIL_CHOICES.filter((value) => value !== "stop").map((value) => ({ value: value, label: `${value.split(":")[1]}번까지` })),
    { value: "stop", label: "되돌리지 않기", hint: "결과만 남기고 멈춰요" }
];
const ON_FAIL_CAPTIONS = { qa: "실패하면 개발로 되돌려요", security: "심각하면 개발로 되돌려요" };
const ON_FAIL_SUBJECTS = { qa: "실패하면", security: "심각하면" };

const ALLOW_OPTIONS = [
    { key: "deps", label: "새 라이브러리 추가", desc: "패키지를 새로 설치해요. 고른 이유는 기획서와 커밋에 남겨요" },
    { key: "large", label: "큰 구조 만들기", desc: "폴더 구조와 프레임워크를 처음부터 정해요" },
    { key: "external-api", label: "외부 API 호출 코드", desc: "결제, 지도처럼 바깥 서버를 부르는 코드" },
    { key: "send", label: "외부 서비스로 코드 보내기", desc: "Codex, Figma, 이미지 생성 도구에 프로젝트 내용을 보내요" }
];

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

export {
    PHASE_DETAILS,
    PHASE_DONE,
    DESIGN_FORMAT_OPTIONS,
    ON_FAIL_OPTIONS,
    ON_FAIL_CAPTIONS,
    ALLOW_OPTIONS,
    getBuildStartPhase,
    getReadySteps,
    getBuildGreeting,
    getBuildActionLabel,
    getOnFailLabel,
    getRunSteps,
    getPhaseDocs,
    getRevisionTasks
};
