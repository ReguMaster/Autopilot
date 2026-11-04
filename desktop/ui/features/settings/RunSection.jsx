import { useEffect } from "react";
import { loadProviders } from "../../actions/runs.js";
import { settings } from "../../actions/settings.js";
import { SelectRow, SettingsGroup } from "../../components/SettingsGroup.jsx";
import { POLICY_LABELS } from "../../lib/constants.js";
import { PROVIDER_LOGOS } from "../../lib/phaseAgents.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { useScopedValue } from "./ScopeControls.jsx";
import { LOCKED_REASON, ScopedSelectRow, ScopedSwitchRow } from "./rows.jsx";

const MODE_OPTIONS = [
    { value: "maintain", label: "유지 보수", hint: "적어 둔 일을 하나씩 하고, 남는 시간에는 스스로 고칠 곳을 찾아요" },
    { value: "build", label: "신규 개발", hint: "기획부터 보안검토까지 단계마다 확인을 받으며 만들어요" }
];
const POLICY_OPTIONS = [
    { value: "auto", label: POLICY_LABELS.auto, hint: "작업을 마친 뒤에도 스스로 개선점을 찾아요" },
    { value: "todo", label: POLICY_LABELS.todo, hint: "적어 둔 작업만 처리하고 끝나요" }
];
const EXTEND_LIMIT_OPTIONS = [
    { value: 0, label: "제한 없음", hint: "한도를 기다린 시간을 모두 더해요" },
    { value: 60, label: "최대 1시간" },
    { value: 180, label: "최대 3시간" },
    { value: 360, label: "최대 6시간" },
    { value: 720, label: "최대 12시간" },
    { value: 1440, label: "최대 24시간" }
];
const SLEEP_BLOCK_OPTIONS = [
    { value: "always", label: "항상", hint: "실행하는 동안 PC가 잠들지 않아요" },
    { value: "plugged", label: "전원 연결 때만", hint: "배터리로 돌 때는 PC가 잠들 수 있어요" },
    { value: "never", label: "하지 않음", hint: "PC가 잠들면 회차가 멈춰요" }
];
const POST_RUN_OPTIONS = [
    { value: "none", label: "아무것도 안 함" },
    { value: "sleep", label: "PC 절전", hint: "끝나고 1분 안에 취소할 수 있어요" },
    { value: "shutdown", label: "PC 종료", hint: "끝나고 1분 안에 취소할 수 있어요" }
];

const getRunnerOptions = (codex) => {
    const reason = codex && !codex.available ? codex.reason : "";

    return [
        { value: "claude", label: "Claude", icon: PROVIDER_LOGOS.claude, hint: "회차를 Claude가 돌려요" },
        { value: "codex", label: "Codex", icon: PROVIDER_LOGOS.codex, hint: reason || "회차를 Codex가 돌려요", disabled: Boolean(reason) }
    ];
};

// 새 실행을 시작할 때 컴포저에 미리 채워 둘 작업 모드·실행 에이전트·개선 정책. 컴포저에서 고른 값은 그 프로젝트에만 기억된다.
const StartGroup = () => {
    const codex = useRunsStore((store) => store.providers?.codex);
    const mode = useScopedValue("mode").value;
    const runner = useScopedValue("runner").value;
    const policy = useScopedValue("policy").value;

    return (
        <SettingsGroup id="group-defaults" sectionId="defaults-group" title="시작할 때" note="새 실행을 시작할 때 입력창에 미리 채워 둬요. 입력창에서 고른 값은 그 프로젝트에만 기억돼요.">
            <ScopedSelectRow labelId="default-label-mode" settingKey="mode" title="작업 모드" value={mode} options={MODE_OPTIONS} onChange={(next) => settings.update({ mode: next })} />
            <ScopedSelectRow
                labelId="default-label-runner"
                settingKey="runner"
                title="유지 보수에서 일할 AI"
                note="신규 개발은 단계마다 메인 AI를 따로 정해요. 신규 개발 항목에서 바꿀 수 있어요."
                value={runner}
                options={getRunnerOptions(codex)}
                onChange={(next) => settings.update({ runner: next })}
            />
            <ScopedSelectRow
                labelId="default-label-policy"
                settingKey="policy"
                title="개선 정책"
                note="유지 보수에서 적어 둔 작업을 마친 뒤에 할 일이에요."
                value={policy}
                options={POLICY_OPTIONS}
                onChange={(next) => settings.update({ policy: next })}
            />
        </SettingsGroup>
    );
};

const LimitGroup = () => {
    const extendOnLimit = useScopedValue("extendOnLimit").value;
    const limit = useScopedValue("extendLimitMinutes").value;

    return (
        <SettingsGroup id="group-limit" title="사용량 한도">
            <ScopedSwitchRow
                id="extend-on-limit"
                settingKey="extendOnLimit"
                title="대기한 시간만큼 종료 시각 연장"
                note="한도에 걸려 리셋까지 기다리면 그 시간만큼 종료 시각을 늦춰요. 끄면 리셋이 종료 시각 뒤일 때 바로 끝나요."
                checked={Boolean(extendOnLimit)}
                onChange={(isOn) => settings.update({ extendOnLimit: isOn })}
            />
            <ScopedSelectRow
                labelId="extend-limit-label"
                noteId="extend-limit-note"
                settingKey="extendLimitMinutes"
                title="연장 상한"
                note="한 번의 실행에서 늘릴 수 있는 시간의 합이에요. 연장을 켰을 때만 적용돼요."
                value={limit}
                options={EXTEND_LIMIT_OPTIONS}
                disabledReason={LOCKED_REASON}
                onChange={(next) => settings.update({ extendLimitMinutes: next })}
            />
        </SettingsGroup>
    );
};

// PC 설정은 범위와 상관없이 이 PC 전체에 적용된다.
const PcGroup = () => {
    const { sleepBlock, postRunAction } = useAppStore((store) => store.settings);

    return (
        <SettingsGroup id="group-pc" title="실행하는 PC">
            <SelectRow
                labelId="sleep-block-label"
                noteId="sleep-block-note"
                title="실행 중 절전 방지"
                note="PC가 잠들면 회차가 멈춰요. 노트북은 배터리일 때만 풀 수 있어요."
                value={sleepBlock}
                options={SLEEP_BLOCK_OPTIONS}
                onChange={(next) => settings.setPreferences({ sleepBlock: next })}
            />
            <SelectRow
                labelId="post-run-label"
                noteId="post-run-note"
                title="실행이 끝난 뒤"
                note="스스로 끝나면 알려 주고 1분 뒤에 해요. 종료 신호·강제 종료 뒤에는 하지 않아요."
                value={postRunAction}
                options={POST_RUN_OPTIONS}
                onChange={settings.setPostRunAction}
            />
        </SettingsGroup>
    );
};

const RunSection = () => {
    useEffect(() => {
        loadProviders();
    }, []);

    return (
        <>
            <StartGroup />
            <LimitGroup />
            <PcGroup />
        </>
    );
};

export { RunSection };
