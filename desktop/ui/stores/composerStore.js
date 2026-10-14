import { create } from "zustand";
import { getEndTimeAfter, getModelFamily, shiftEndTime } from "../../viewFormat.js";
import { DEFAULT_EFFORT_LEVEL, DEFAULT_MODEL, DEFAULT_POLICY, EFFORT_LEVELS, STATUS_OK } from "../lib/constants.js";
import { getRunState } from "./runStore.js";
import { ui } from "./uiStore.js";

// 시작 전에 고르는 값(모델·Effort·정책·종료 시각·작업·한도 연장). 실행 중에는 엔진에 전달된 값을 따라간다.
// model은 계열이고, modelId는 알약에 보여줄 값(계열 별칭이거나 엔진이 쓰는 모델 ID)이다.
const useComposerStore = create(() => ({
    model: DEFAULT_MODEL,
    modelId: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT_LEVEL,
    policy: DEFAULT_POLICY,
    endTime: "",
    tasks: "",
    extendOnLimit: false
}));

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
    stepEndTime: (unit, step) => useComposerStore.setState((current) => ({ endTime: shiftEndTime(current.endTime, step * unit) })),
    setEndTimeAfter: (minutes) => useComposerStore.setState({ endTime: getEndTimeAfter(Date.now(), minutes) }),
    // 모델 버전 고정이 바뀌면 알약은 다시 계열 기준으로 보여준다.
    showFamily: () => useComposerStore.setState((current) => ({ modelId: current.model })),
    syncFromRun: syncFromRun,
    getSelectedOptions: getSelectedOptions,
    setSelectedOptions: setSelectedOptions
};

export { useComposerStore, composer };
