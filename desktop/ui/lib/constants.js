// 허용 값은 엔진 config.js·autopilotRunner.cjs·autopilotIpc.cjs와 같아야 한다(tests/checkDesktopRunner.js가 대조한다).
const STATUS_OK = "OK";
const MODEL_FAMILIES = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const POLICIES = ["auto", "todo"];
const DEFAULT_MODEL = "opus";
const DEFAULT_EFFORT_LEVEL = 2;
const DEFAULT_POLICY = "auto";

const POLICY_LABELS = { auto: "자율개선", todo: "지시개선" };

const OPTIONS_LOCKED_TITLE = "종료 요청 후에는 모델·Effort를 바꿀 수 없어요";

// 상태별 가운데 버튼. 종료 요청 후에 누르면 메인 프로세스가 확인 모달을 띄우고 강제 종료한다.
const MAIN_ACTIONS = {
    idle: { action: "start", label: "시작", title: "" },
    running: { action: "stop", label: "종료 신호", title: "현재 회차를 마친 뒤 종료해요" },
    stopping: { action: "kill", label: "종료", title: "즉시 중단해요. commit 전 변경은 working tree에 남아요" }
};

export { STATUS_OK, MODEL_FAMILIES, EFFORT_LEVELS, POLICIES, DEFAULT_MODEL, DEFAULT_EFFORT_LEVEL, DEFAULT_POLICY, POLICY_LABELS, OPTIONS_LOCKED_TITLE, MAIN_ACTIONS };
