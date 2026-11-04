import { SelectRow, StepperRow, SwitchRow } from "../../components/SettingsGroup.jsx";
import { useRunStore } from "../../stores/runStore.js";
import { ScopeNote } from "./ScopeControls.jsx";

const LOCKED_REASON = "실행 중에는 바꿀 수 없어요";

const useIsIdle = () => useRunStore((store) => store.state.status === "idle");

// 전역 또는 이 프로젝트 범위에 저장하는 줄들. 실행 중에는 잠기고, 이 프로젝트 범위에서는 settingKey 값이 전역을 따르는지 덮어썼는지를 줄 아래에 보인다.
// 값끼리 기대는 줄은 settingKey로 대표 키 하나만 안내하고, 저장은 onChange가 settings.update로 한꺼번에 한다.
// detail은 설명 아래에 더 붙이는 줄이고, settingKey가 없으면 범위 안내를 붙이지 않는다(묶음 전체가 한 키일 때 묶음에서 한 번만 안내한다).
const ScopedExtra = ({ settingKey, detail, isIdle }) => (
    <>
        {detail}
        {settingKey ? <ScopeNote settingKey={settingKey} disabled={!isIdle} /> : null}
    </>
);

const ScopedSelectRow = ({ settingKey, detail = null, disabled = false, disabledReason = "", ...props }) => {
    const isIdle = useIsIdle();

    return (
        <SelectRow extra={<ScopedExtra settingKey={settingKey} detail={detail} isIdle={isIdle} />} disabled={!isIdle || disabled} disabledReason={isIdle ? disabledReason : LOCKED_REASON} {...props} />
    );
};

const ScopedSwitchRow = ({ settingKey, detail = null, disabled = false, ...props }) => {
    const isIdle = useIsIdle();

    return <SwitchRow extra={<ScopedExtra settingKey={settingKey} detail={detail} isIdle={isIdle} />} disabled={!isIdle || disabled} {...props} />;
};

const ScopedStepperRow = ({ settingKey, detail = null, disabled = false, ...props }) => {
    const isIdle = useIsIdle();

    return <StepperRow extra={<ScopedExtra settingKey={settingKey} detail={detail} isIdle={isIdle} />} disabled={!isIdle || disabled} {...props} />;
};

export { LOCKED_REASON, ScopedSelectRow, ScopedStepperRow, ScopedSwitchRow, useIsIdle };
