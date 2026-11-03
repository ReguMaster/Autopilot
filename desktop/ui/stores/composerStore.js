import { create } from "zustand";
import { getEndTimeAfter, getModelFamily, shiftEndTime } from "../../viewFormat.js";
import { getAssistant } from "../lib/phaseAgents.js";
import {
    ALLOW_KEYS,
    BRAINSTORM_PHASES,
    DEFAULT_ALLOW,
    DEFAULT_DEBATE_TURNS,
    DEFAULT_DESIGN_FORMAT,
    DEFAULT_EFFORT_LEVEL,
    DEFAULT_GATES,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_POLICY,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_RUNNER,
    CODEX_RUNNER,
    DEFAULT_CODEX_EFFORT,
    DEFAULT_CODEX_MODEL,
    DEFAULT_SECURITY_ON_FAIL,
    DEFAULT_SECURITY_REVIEW,
    EFFORT_LEVELS,
    GATE_PHASES,
    SKIPPABLE_PHASES,
    STATUS_OK
} from "../lib/constants.js";
import { getRunState } from "./runStore.js";
import { ui } from "./uiStore.js";

// 시작 전에 고르는 값(실행 에이전트·모델·노력·추론·정책·종료 시각·작업·한도 연장·작업 모드와 신규 개발 설정). 실행 중에는 엔진에 전달된 값을 따라간다.
// model은 계열이고, modelId는 알약에 보여줄 값(계열 별칭이거나 엔진이 쓰는 모델 ID)이다. endTime은 HH:mm이거나 yyyy-MM-dd HH:mm(날짜 지정)이다.
// Claude(model·effort)와 Codex(codexModel·codexEffort)의 모델·노력(추론)은 늘 둘 다 갖고, 누가 일하는지와 무관하다.
// 유지 보수는 runner가 회차를 돌리는 AI이고, 신규 개발은 mains(단계마다 메인 AI, 비면 Claude)가 정한다.
const useComposerStore = create(() => ({
    runner: DEFAULT_RUNNER,
    model: DEFAULT_MODEL,
    modelId: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT_LEVEL,
    policy: DEFAULT_POLICY,
    endTime: "",
    tasks: "",
    extendOnLimit: false,
    mode: DEFAULT_MODE,
    gates: DEFAULT_GATES,
    skip: [],
    allow: DEFAULT_ALLOW,
    designFormat: DEFAULT_DESIGN_FORMAT,
    qaOnFail: DEFAULT_QA_ON_FAIL,
    securityOnFail: DEFAULT_SECURITY_ON_FAIL,
    securityReview: DEFAULT_SECURITY_REVIEW,
    mains: {},
    brainstorm: [],
    crossReview: false,
    debate: [],
    debateTurns: DEFAULT_DEBATE_TURNS,
    codexModel: DEFAULT_CODEX_MODEL,
    codexEffort: DEFAULT_CODEX_EFFORT
}));

// 체크를 바꾼 목록. 순서는 고를 수 있는 값의 순서로 맞춰 저장 값이 흔들리지 않게 한다.
const toggleChoice = (current, choices, value) => {
    return choices.filter((choice) => (choice === value ? !current.includes(choice) : current.includes(choice)));
};

// 보내기를 허용하지 않으면 Codex가 보조인 단계(메인이 Claude)는 보조를 쓸 수 없다. 그 단계를 빼고, 협의·교차검토를 남은 단계에 맞춘다.
// 보안검토의 독립 검토도 검토자가 Codex(보안검토의 메인이 Claude)면 같다.
const dropBlockedAssistants = ({ allow, mains, brainstorm, debate, crossReview, securityReview }) => {
    const isSendAllowed = allow.includes("send");
    const next = isSendAllowed ? brainstorm : brainstorm.filter((phase) => getAssistant(mains, phase) === "claude");
    const nextDebate = debate.filter((phase) => next.includes(phase));

    return {
        brainstorm: next,
        debate: nextDebate,
        crossReview: next.some((phase) => !nextDebate.includes(phase)) ? crossReview : false,
        securityReview: isSendAllowed || getAssistant(mains, "security") === "claude" ? securityReview : DEFAULT_SECURITY_REVIEW
    };
};

let isApplying = false;
let isApplyQueued = false;

const getSelectedOptions = () => {
    const { model, effort, runner, codexModel, codexEffort } = useComposerStore.getState();

    return { model: model, effort: EFFORT_LEVELS[effort], runner: runner, codexModel: codexModel, codexEffort: codexEffort };
};

// 엔진에 전달된 값으로 맞춘다. 옛 상태처럼 실행 에이전트 값이 없으면 지금 고른 값을 그대로 둔다.
// 연결한 실행의 옛 로그 `기본값`은 빈 값으로 읽히는데, 엔진은 빈 Codex 값을 받지 않아 그대로 두면 다음 set이 실패한다.
const setSelectedOptions = ({ model, effort, runner, codexModel, codexEffort }) => {
    useComposerStore.setState((current) => ({
        model: getModelFamily(model) || current.model,
        modelId: model,
        effort: Math.max(0, EFFORT_LEVELS.indexOf(effort)),
        runner: runner ?? current.runner,
        codexModel: codexModel || current.codexModel,
        codexEffort: codexEffort || current.codexEffort
    }));
};

// 실행 중에는 엔진에 전달된 값을 기준으로 선택을 맞춘다. 전달 중인 값은 덮어쓰지 않는다.
const syncFromRun = (state) => {
    if (state && state.status !== "idle" && !isApplying && state.requested.model) {
        setSelectedOptions(state.requested);
    }
};

// 변경은 즉시 전달한다. 전달 중에 또 바뀌면 마지막 선택만 한 번 더 보낸다.
const applyRoundOptions = async () => {
    if (isApplying) {
        isApplyQueued = true;

        return;
    }

    isApplying = true;

    do {
        isApplyQueued = false;

        const result = await window.autopilot.setOptions(getSelectedOptions());

        ui.showFailure(result);

        if (result.status !== STATUS_OK) {
            isApplyQueued = false;
        }
    } while (isApplyQueued);

    isApplying = false;
    syncFromRun(getRunState());
};

// 실행 중이면 고른 값을 엔진에 바로 전달한다(다음 회차부터 적용).
const handleOptionChange = () => {
    if (getRunState()?.status === "running") {
        applyRoundOptions();
    }
};

const COMPOSER_KEYS = [
    "tasks",
    "endTime",
    "policy",
    "extendOnLimit",
    "model",
    "effort",
    "runner",
    "mode",
    "gates",
    "skip",
    "allow",
    "designFormat",
    "qaOnFail",
    "securityOnFail",
    "securityReview",
    "mains",
    "brainstorm",
    "crossReview",
    "debate",
    "debateTurns",
    "codexModel",
    "codexEffort"
];

// 시작·예약 저장 때 엔진에 넘길 작업 모드와 신규 개발 설정
const getModeOptions = () => {
    const { mode, gates, skip, allow, designFormat, qaOnFail, securityOnFail, securityReview, mains, brainstorm, crossReview, debate, debateTurns, codexModel, codexEffort } =
        useComposerStore.getState();

    return {
        mode: mode,
        gates: gates,
        skip: skip,
        allow: allow,
        designFormat: designFormat,
        qaOnFail: qaOnFail,
        securityOnFail: securityOnFail,
        securityReview: securityReview,
        mains: mains,
        brainstorm: brainstorm,
        crossReview: crossReview,
        debate: debate,
        debateTurns: debateTurns,
        codexModel: codexModel,
        codexEffort: codexEffort
    };
};

// 저장된 설정으로 컴포저의 값을 채운다. keys를 주면 그 키만 바꿔, 설정 패널에서 한 값을 바꿨다고 쓰던 작업 문구까지 되돌리지 않는다.
const loadSettings = (settings, keys = COMPOSER_KEYS) => {
    const patch = {};

    for (const key of keys.filter((candidate) => COMPOSER_KEYS.includes(candidate))) {
        if (key === "model") {
            patch.model = settings.model;
            patch.modelId = settings.model;
        } else if (key === "effort") {
            patch.effort = Math.max(0, EFFORT_LEVELS.indexOf(settings.effort));
        } else {
            patch[key] = settings[key];
        }
    }

    useComposerStore.setState(patch);
};

const composer = {
    // 모델·노력은 AI마다 따로 정한다. 누가 일하는지(유지 보수의 runner, 신규 개발의 mains)는 바꾸지 않는다.
    chooseModel: (family) => {
        useComposerStore.setState({ model: family, modelId: family });
        handleOptionChange();
    },
    chooseCodexModel: (codexModel) => {
        useComposerStore.setState({ codexModel: codexModel });
        handleOptionChange();
    },
    // 유지 보수에서 회차를 돌릴 AI. 실행 중이면 다음 회차부터 바뀐다.
    setRunner: (runner) => {
        useComposerStore.setState({ runner: runner });
        handleOptionChange();
    },
    chooseEffort: (level) => {
        useComposerStore.setState({ effort: level });
        handleOptionChange();
    },
    chooseCodexEffort: (codexEffort) => {
        useComposerStore.setState({ codexEffort: codexEffort });
        handleOptionChange();
    },
    setPolicy: (policy) => useComposerStore.setState({ policy: policy }),
    setTasks: (tasks) => useComposerStore.setState({ tasks: tasks }),
    setExtendOnLimit: (isOn) => useComposerStore.setState({ extendOnLimit: isOn }),
    setEndTime: (endTime) => useComposerStore.setState({ endTime: endTime }),
    setMode: (mode) => useComposerStore.setState({ mode: mode }),
    // 하지 않기로 한 단계는 그 단계의 확인받기 · 보조 · 되돌림 설정을 쓰지 않으므로 화면이 숨긴다(엔진 인자에서도 빠진다). 다시 하기로 하면 설정이 그대로 돌아온다.
    toggleSkip: (phase) => useComposerStore.setState((current) => ({ skip: toggleChoice(current.skip, SKIPPABLE_PHASES, phase) })),
    toggleGate: (phase) => useComposerStore.setState((current) => ({ gates: toggleChoice(current.gates, GATE_PHASES, phase) })),
    // Codex는 프로젝트 내용을 외부로 보내므로 보내기를 끄면 브레인스토밍도 Claude만으로 돌린다.
    toggleAllow: (key) =>
        useComposerStore.setState((current) => {
            const allow = toggleChoice(current.allow, ALLOW_KEYS, key);

            return { allow: allow, ...dropBlockedAssistants({ ...current, allow: allow }) };
        }),
    // 단계의 메인 AI. Codex가 보조가 되는 단계(메인이 Claude)는 프로젝트 내용을 보내야 하므로 보내기도 함께 켠다(단계 문장이 그 사실을 알린다).
    setPhaseMain: (phase, provider) =>
        useComposerStore.setState((current) => {
            const mains = Object.fromEntries(Object.entries({ ...current.mains, [phase]: provider }).filter(([, value]) => value !== DEFAULT_RUNNER));
            const hasAssistant = current.brainstorm.includes(phase) || (phase === "security" && current.securityReview !== DEFAULT_SECURITY_REVIEW);
            const needsSend = hasAssistant && getAssistant(mains, phase) === CODEX_RUNNER && !current.allow.includes("send");

            return { mains: mains, allow: needsSend ? toggleChoice(current.allow, ALLOW_KEYS, "send") : current.allow };
        }),
    // 단계의 보조 방식(none: 보조 없이, compare: 나란히 비교, debate: 협의). 보조는 메인의 반대쪽 AI이고, Codex가 보조면 보내기도 함께 켠다.
    // 나란히 비교하는 단계가 하나도 없으면 교차검토도 끈다(협의는 이미 서로 검토한다).
    setBrainstormMode: (phase, brainstormMode) =>
        useComposerStore.setState((current) => {
            const isAssisted = brainstormMode !== "none";
            const brainstorm = BRAINSTORM_PHASES.filter((item) => (item === phase ? isAssisted : current.brainstorm.includes(item)));
            const debate = BRAINSTORM_PHASES.filter((item) => (item === phase ? brainstormMode === "debate" : current.debate.includes(item) && brainstorm.includes(item)));
            const hasCompare = brainstorm.some((item) => !debate.includes(item));
            const needsSend = isAssisted && getAssistant(current.mains, phase) === CODEX_RUNNER && !current.allow.includes("send");

            return {
                brainstorm: brainstorm,
                debate: debate,
                allow: needsSend ? toggleChoice(current.allow, ALLOW_KEYS, "send") : current.allow,
                crossReview: hasCompare ? current.crossReview : false
            };
        }),
    setCrossReview: (isOn) => useComposerStore.setState({ crossReview: isOn }),
    setDebateTurns: (debateTurns) => useComposerStore.setState({ debateTurns: debateTurns }),
    setCodexModel: (codexModel) => useComposerStore.setState({ codexModel: codexModel }),
    setCodexEffort: (codexEffort) => useComposerStore.setState({ codexEffort: codexEffort }),
    setDesignFormat: (designFormat) => useComposerStore.setState({ designFormat: designFormat }),
    setQaOnFail: (qaOnFail) => useComposerStore.setState({ qaOnFail: qaOnFail }),
    setSecurityOnFail: (securityOnFail) => useComposerStore.setState({ securityOnFail: securityOnFail }),
    // 독립 검토자는 보안검토 메인의 반대쪽 AI다. Codex가 검토하면 프로젝트 내용을 보내야 하므로 보내기도 함께 켠다.
    setSecurityReview: (securityReview) =>
        useComposerStore.setState((current) => {
            const needsSend = securityReview !== DEFAULT_SECURITY_REVIEW && getAssistant(current.mains, "security") === CODEX_RUNNER && !current.allow.includes("send");

            return { securityReview: securityReview, allow: needsSend ? toggleChoice(current.allow, ALLOW_KEYS, "send") : current.allow };
        }),
    getModeOptions: getModeOptions,
    stepEndTime: (unit, step) => useComposerStore.setState((current) => ({ endTime: shiftEndTime(current.endTime, step * unit, Date.now()) })),
    setEndTimeAfter: (minutes) => useComposerStore.setState({ endTime: getEndTimeAfter(Date.now(), minutes) }),
    // 모델 버전 고정이 바뀌면 알약은 다시 계열 기준으로 보여준다.
    showFamily: () => useComposerStore.setState((current) => ({ modelId: current.model })),
    loadSettings: loadSettings,
    syncFromRun: syncFromRun,
    getSelectedOptions: getSelectedOptions,
    setSelectedOptions: setSelectedOptions
};

export { useComposerStore, composer, COMPOSER_KEYS };
