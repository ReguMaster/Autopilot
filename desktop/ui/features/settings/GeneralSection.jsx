import { settings } from "../../actions/settings.js";
import { changeSystemSettings } from "../../actions/run.js";
import { SelectRow, SettingsGroup, SwitchRow } from "../../components/SettingsGroup.jsx";
import { useAppStore } from "../../stores/appStore.js";

const THEME_OPTIONS = [
    { value: "system", label: "시스템 설정", hint: "운영체제의 밝게·어둡게를 따라가요" },
    { value: "light", label: "밝게" },
    { value: "dark", label: "어둡게" }
];
const CHECK_UPDATES_NOTE = "앱을 켤 때와 6시간마다 GitHub에서 새 버전이 있는지 확인해요. 끄면 이 확인을 위한 네트워크 요청을 하지 않아요.";
const KEEP_IN_TRAY_NOTE = "창을 닫아도 앱이 트레이에 남아 실행과 예약 시작이 이어져요. 끄면 실행 중이 아닐 때 창을 닫으면 앱이 종료돼요.";
const LAUNCH_AT_LOGIN_NOTE = "컴퓨터에 로그인하면 창 없이 트레이로 조용히 켜져요. 켜면 트레이 상주도 함께 켜져요.";
const LAUNCH_AT_LOGIN_UNSUPPORTED_NOTE = "설치한 앱에서만 켤 수 있어요. 개발 실행에서는 쓸 수 없어요.";

const NOTIFICATION_ROWS = [
    { key: "notifyFinish", title: "실행이 끝나면", note: "정상으로 끝나거나 종료 신호로 멈췄을 때 알려요." },
    { key: "notifyFailure", title: "실패하거나 중단되면", note: "연속 실패로 중단되는 등 오류로 끝났을 때 알려요." },
    { key: "notifyLimit", title: "사용량 한도로 기다리면", note: "한도에 걸려 리셋까지 기다리기 시작할 때 알려요." },
    { key: "notifySchedule", title: "예약이 시작되면", note: "예약이 실행을 시작했거나 시작하지 못했을 때 알려요." },
    { key: "notifyFocused", title: "창을 보고 있을 때도", note: "끄면 창이 가려져 있거나 트레이에 있을 때만 알려요." }
];

// 로그인 자동 실행을 켜면 트레이 상주는 반드시 켜져 있어야 하므로 끌 수 없게 잠근다. 개발 실행처럼 등록할 수 없는 환경은 켜는 쪽을 막는다.
const AppGroup = () => {
    const { keepInTray, launchAtLogin, checkUpdates, theme } = useAppStore((store) => store.settings);
    const canLaunchAtLogin = useAppStore((store) => store.canLaunchAtLogin);

    return (
        <SettingsGroup id="group-app" title="앱">
            <SelectRow
                labelId="theme-label"
                noteId="theme-note"
                title="화면 테마"
                note="어둡게는 밤에 눈이 덜 부셔요."
                value={theme || "system"}
                options={THEME_OPTIONS}
                onChange={(next) => settings.setPreferences({ theme: next })}
            />
            <SwitchRow
                id="keep-in-tray"
                noteId="keep-in-tray-note"
                title="닫아도 트레이에서 계속 켜 두기"
                note={KEEP_IN_TRAY_NOTE}
                checked={Boolean(keepInTray)}
                disabled={Boolean(launchAtLogin)}
                onChange={(isOn) => changeSystemSettings({ keepInTray: isOn })}
            />
            <SwitchRow
                id="launch-at-login"
                noteId="launch-at-login-note"
                title="로그인하면 자동으로 켜기"
                note={canLaunchAtLogin || launchAtLogin ? LAUNCH_AT_LOGIN_NOTE : LAUNCH_AT_LOGIN_UNSUPPORTED_NOTE}
                checked={Boolean(launchAtLogin)}
                disabled={!canLaunchAtLogin && !launchAtLogin}
                onChange={(isOn) => changeSystemSettings({ launchAtLogin: isOn })}
            />
            <SwitchRow
                id="check-updates"
                noteId="check-updates-note"
                title="새 버전 확인"
                note={CHECK_UPDATES_NOTE}
                checked={Boolean(checkUpdates)}
                onChange={(isOn) => settings.setPreferences({ checkUpdates: isOn })}
            />
        </SettingsGroup>
    );
};

const NotificationGroup = () => {
    const preferences = useAppStore((store) => store.settings);

    return (
        <SettingsGroup id="group-notify" sectionId="notify-group" title="알림">
            {NOTIFICATION_ROWS.map((row) => (
                <SwitchRow
                    key={row.key}
                    id={`notify-${row.key}`}
                    noteId={`notify-${row.key}-note`}
                    title={row.title}
                    note={row.note}
                    checked={Boolean(preferences[row.key])}
                    onChange={(isOn) => settings.setPreferences({ [row.key]: isOn })}
                />
            ))}
        </SettingsGroup>
    );
};

const GeneralSection = () => {
    const version = useAppStore((store) => store.version);

    return (
        <>
            <AppGroup />
            <NotificationGroup />
            <p className="settings-foot">
                <span>앱 버전</span>
                <span id="app-version" className="num">
                    {version ? `v${version}` : ""}
                </span>
            </p>
        </>
    );
};

export { GeneralSection };
