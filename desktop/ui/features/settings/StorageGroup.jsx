import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "../../../viewFormat.js";
import { settings } from "../../actions/settings.js";
import { Select } from "../../components/Select.jsx";
import { NavRow, SettingsGroup } from "../../components/SettingsGroup.jsx";
import { STATUS_OK } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";
import { useRunStore } from "../../stores/runStore.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ScopeNote, useScopedValue } from "./ScopeControls.jsx";

const RETENTION_OPTIONS = [7, 14, 30, 90, 180].map((days) => ({ value: days, label: `${days}일`, hint: days === 30 ? "기본" : undefined }));
const NO_PROJECT_NOTE = "프로젝트를 고르면 지난 로그와 리포트가 차지하는 용량이 보여요.";

// 설정 패널을 열 때, 보관 기간이나 프로젝트가 바뀔 때, 실행이 끝날 때 용량을 다시 읽는다. refresh는 지운 직후처럼 바로 다시 읽을 때 쓴다.
const useRunUsage = () => {
    const isPanelOpen = useUiStore((store) => store.panel === "settings");
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const status = useRunStore((store) => store.state.status);
    const { value: retentionDays } = useScopedValue("logRetentionDays");
    const [usage, setUsage] = useState(undefined);

    const refresh = useCallback(async () => {
        const result = await window.autopilot.getRunUsage();

        setUsage(result.status === STATUS_OK ? result.data.usage : null);
    }, []);

    useEffect(() => {
        if (isPanelOpen) {
            refresh();
        }
    }, [isPanelOpen, projectDir, status, retentionDays, refresh]);

    return { usage: usage, refresh: refresh };
};

const getUsageNote = (usage) => {
    if (usage === undefined) {
        return "용량을 읽는 중이에요.";
    }

    if (usage === null) {
        return NO_PROJECT_NOTE;
    }

    const total = `지난 로그·리포트 ${usage.runCount}개가 ${formatBytes(usage.bytes)}를 차지해요.`;

    return usage.staleCount
        ? `${total} 보관 기간(${usage.retentionDays}일)이 지난 ${usage.staleCount}개(${formatBytes(usage.staleBytes)})는 다음 실행을 시작할 때 지워져요.`
        : `${total} 보관 기간(${usage.retentionDays}일)이 지난 기록은 없어요.`;
};

// 지난 실행의 로그·리포트를 얼마나 오래 보관할지와 지금 차지하는 용량. 보관 기간은 프로젝트마다 정할 수 있다.
const StorageGroup = () => {
    const isIdle = useRunStore((store) => store.state.status === "idle");
    const { value: retentionDays } = useScopedValue("logRetentionDays");
    const { usage, refresh } = useRunUsage();

    const handlePrune = async () => {
        await settings.pruneStaleRuns();
        refresh();
    };

    return (
        <SettingsGroup id="group-storage" sectionId="storage-group" title="로그 보관">
            <div className="row version-row">
                <span className="row-body">
                    <b id="retention-label">보관 기간</b>
                    <small id="retention-note">이 기간이 지난 로그·리포트는 실행을 시작할 때 지워져요.</small>
                    <ScopeNote settingKey="logRetentionDays" disabled={!isIdle} />
                </span>
                <Select
                    value={retentionDays}
                    options={RETENTION_OPTIONS}
                    disabled={!isIdle}
                    disabledReason="실행 중에는 바꿀 수 없어요"
                    labelId="retention-label"
                    onChange={(next) => settings.update({ logRetentionDays: next })}
                />
            </div>
            <p id="storage-usage" className="row-note storage-usage">
                {getUsageNote(usage)}
            </p>
            <NavRow id="prune-runs" danger disabled={!usage?.staleCount} onClick={handlePrune}>
                보관 기간이 지난 기록 지금 지우기
            </NavRow>
        </SettingsGroup>
    );
};

export { StorageGroup };
