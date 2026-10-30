import { create } from "zustand";
import { getEndTimeAfter, getModelFamily, shiftEndTime } from "../../viewFormat.js";
import {
    ALLOW_KEYS,
    BRAINSTORM_PHASES,
    DEFAULT_ALLOW,
    DEFAULT_DESIGN_FORMAT,
    DEFAULT_EFFORT_LEVEL,
    DEFAULT_GATES,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_POLICY,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    EFFORT_LEVELS,
    GATE_PHASES,
    STATUS_OK
} from "../lib/constants.js";
import { getRunState } from "./runStore.js";
import { ui } from "./uiStore.js";

// 시작 전에 고르는 값(모델·Effort·정책·종료 시각·작업·한도 연장·작업 모드와 신규 개발 설정). 실행 중에는 엔진에 전달된 값을 따라간다.
// model은 계열이고, modelId는 알약에 보여줄 값(계열 별칭이거나 엔진이 쓰는 모델 ID)이다. endTime은 HH:mm이거나 yyyy-MM-dd HH:mm(날짜 지정)이다.
const useComposerStore = create(() => ({
    model: DEFAULT_MODEL,
    modelId: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT_LEVEL,
    policy: DEFAULT_POLICY,
    endTime: "",
    tasks: "",
    extendOnLimit: false,
    mode: DEFAULT_MODE,
    gates: DEFAULT_GATES,
    allow: DEFAULT_ALLOW,
    designFormat: DEFAULT_DESIGN_FORMAT,
    qaOnFail: DEFAULT_QA_ON_FAIL,
    securityOnFail: DEFAULT_SECURITY_ON_FAIL,
    brainstorm: [],
    crossReview: false
}));

// 체크를 바꾼 목록. 순서는 고를 수 있는 값의 순서로 맞춰 저장 값이 흔들리지 않게 한다.
const toggleChoice = (current, choices, value) => {
    return choices.filter((choice) => (choice === value ? !current.includes(choice) : current.includes(choice)));
};

let isApplying = false;
let isApplyQueued = false;

const getSelectedOptions = () => {
    const { model, effort } = useComposerStore.getState();

    return { model: model, effort: EFFORT_LEVELS[effort] };
};

const setSelectedOptions = ({ model, effort }) => {
    useComposerStore.setState((current) => ({ model: getModelFamily(model) || current.model, modelId: model, effort: Math.max(0, EFFORT_LEVELS.indexOf(effort)) }));
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

const COMPOSER_KEYS = ["tasks", "endTime", "policy", "extendOnLimit", "model", "effort", "mode", "gates", "allow", "designFormat", "qaOnFail", "securityOnFail", "brainstorm", "crossReview"];

// 시작·예약 저장 때 엔진에 넘길 작업 모드와 신규 개발 설정
const getModeOptions = () => {
    const { mode, gates, allow, designFormat, qaOnFail, securityOnFail, brainstorm, crossReview } = useComposerStore.getState();

    return { mode: mode, gates: gates, allow: allow, designFormat: designFormat, qaOnFail: qaOnFail, securityOnFail: securityOnFail, brainstorm: brainstorm, crossReview: crossReview };
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
    chooseModel: (family) => {
        useComposerStore.setState({ model: family, modelId: family });
        handleOptionChange();
    },
    chooseEffort: (level) => {
        useComposerStore.setState({ effort: level });
        handleOptionChange();
    },
    setPolicy: (policy) => useComposerStore.setState({ policy: policy }),
    setTasks: (tasks) => useComposerStore.setState({ tasks: tasks }),
    setExtendOnLimit: (isOn) => useComposerStore.setState({ extendOnLimit: isOn }),
    setEndTime: (endTime) => useComposerStore.setState({ endTime: endTime }),
    setMode: (mode) => useComposerStore.setState({ mode: mode }),
    toggleGate: (phase) => useComposerStore.setState((current) => ({ gates: toggleChoice(current.gates, GATE_PHASES, phase) })),
    // Codex는 프로젝트 내용을 외부로 보내므로 보내기를 끄면 브레인스토밍도 Claude만으로 돌린다.
    toggleAllow: (key) =>
        useComposerStore.setState((current) => {
            const allow = toggleChoice(current.allow, ALLOW_KEYS, key);

            return allow.includes("send") ? { allow: allow } : { allow: allow, brainstorm: [], crossReview: false };
        }),
    // 단계에 Codex를 켜면 보내기도 함께 켠다(단계 칸이 그 사실을 알린다). 모두 끄면 교차검토도 끈다.
    toggleBrainstorm: (phase) =>
        useComposerStore.setState((current) => {
            const brainstorm = toggleChoice(current.brainstorm, BRAINSTORM_PHASES, phase);

            return {
                brainstorm: brainstorm,
                allow: brainstorm.length
                    ? toggleChoice(
                          current.allow.filter((key) => key !== "send"),
                          ALLOW_KEYS,
                          "send"
                      )
                    : current.allow,
                crossReview: brainstorm.length ? current.crossReview : false
            };
        }),
    setCrossReview: (isOn) => useComposerStore.setState({ crossReview: isOn }),
    setDesignFormat: (designFormat) => useComposerStore.setState({ designFormat: designFormat }),
    setQaOnFail: (qaOnFail) => useComposerStore.setState({ qaOnFail: qaOnFail }),
    setSecurityOnFail: (securityOnFail) => useComposerStore.setState({ securityOnFail: securityOnFail }),
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
