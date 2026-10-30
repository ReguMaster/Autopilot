import { useShallow } from "zustand/react/shallow";
import { formatEndTimeShort } from "../../../viewFormat.js";
import { Select } from "../../components/Select.jsx";
import { DESIGN_FORMAT_OPTIONS, QA_ON_FAIL_OPTIONS, getBuildGreeting, getReadySteps } from "../../lib/buildSteps.js";
import { useClock } from "../../stores/clock.js";
import { composer, useComposerStore } from "../../stores/composerStore.js";
import { useRunsStore } from "../../stores/runsStore.js";
import { StepCard } from "../steps/StepCard.jsx";

const GateCheck = ({ phase }) => {
    const isOn = useComposerStore((store) => store.gates.includes(phase));

    return (
        <label className="step-check">
            <input type="checkbox" data-gate={phase} checked={isOn} onChange={() => composer.toggleGate(phase)} />
            끝나면 멈추고 확인받기
        </label>
    );
};

// 외부 도구가 필요한 산출물인데 보내기를 허용하지 않았으면 엔진이 HTML로 만든다는 것을 미리 알린다.
const DesignFormat = () => {
    const { designFormat, canSend } = useComposerStore(useShallow((store) => ({ designFormat: store.designFormat, canSend: store.allow.includes("send") })));

    return (
        <>
            <Select value={designFormat} options={DESIGN_FORMAT_OPTIONS} onChange={composer.setDesignFormat} ariaLabel="디자인 산출물" />
            {["figma", "image"].includes(designFormat) && !canSend ? <p className="step-note">보내기를 허용하지 않으면 HTML로 만들어요</p> : null}
        </>
    );
};

const QaOnFail = () => {
    const qaOnFail = useComposerStore((store) => store.qaOnFail);

    return <Select value={qaOnFail} options={QA_ON_FAIL_OPTIONS} onChange={composer.setQaOnFail} ariaLabel="테스트/QA 실패 처리" />;
};

const SETTINGS = {
    plan: <GateCheck phase="plan" />,
    design: (
        <>
            <GateCheck phase="design" />
            <DesignFormat />
        </>
    ),
    build: <p className="step-none">따로 정할 것이 없어요</p>,
    qa: <QaOnFail />
};

// 신규 개발의 시작 전: 단계 카드(칸마다 그 단계의 설정)와 이어서 할 단계를 알리는 안내. 마친 단계의 설정은 펼치지 않는다.
const BuildReady = () => {
    const buildPhase = useRunsStore((store) => store.buildPhase);
    const { endTime, gates } = useComposerStore(useShallow((store) => ({ endTime: store.endTime, gates: store.gates })));
    const endLabel = useClock((now) => formatEndTimeShort(endTime, now));
    const greeting = getBuildGreeting({ buildPhase: buildPhase, endLabel: endLabel, gates: gates });
    const cells = getReadySteps(buildPhase);
    const settings = Object.fromEntries(cells.filter((cell) => cell.state !== "done").map((cell) => [cell.phase, SETTINGS[cell.phase]]));

    return (
        <>
            <StepCard id="build-steps" cells={cells} settings={settings} />
            <div className="build-lead">
                <h1 id="greet-title">{greeting.title}</h1>
                <p id="greet-lead" className="lead">
                    {greeting.lead}
                </p>
            </div>
        </>
    );
};

export { BuildReady };
