// 허용 값은 엔진 config.js·autopilotRunner.cjs·autopilotIpc.cjs와 같아야 한다(tests/checkDesktopRunner.js가 대조한다).
const STATUS_OK = "OK";
const MODEL_FAMILIES = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const POLICIES = ["auto", "todo"];
const DEFAULT_MODEL = "opus";
const DEFAULT_EFFORT_LEVEL = 2;
const DEFAULT_POLICY = "auto";

const POLICY_LABELS = { auto: "자율개선", todo: "지시개선" };

// 작업 모드와 신규 개발. 엔진 config.js·engineArgs.cjs와 같다.
const MODES = ["maintain", "build"];
const DEFAULT_MODE = "maintain";
const BUILD_PHASES = ["plan", "design", "build", "qa", "security"];
const PHASE_LABELS = { plan: "기획", design: "디자인", build: "개발", qa: "테스트/QA", security: "보안검토" };
const GATE_PHASES = ["plan", "design"];
const DEFAULT_GATES = ["plan", "design"];
// 이번 실행에서 하지 않기로 정할 수 있는 단계. 기획과 개발은 건너뛸 수 없다.
const SKIPPABLE_PHASES = ["design", "qa", "security"];
const ALLOW_KEYS = ["deps", "large", "external-api", "send"];
const DEFAULT_ALLOW = ["deps", "large"];
const DESIGN_FORMATS = ["md", "html", "figma", "image"];
const DEFAULT_DESIGN_FORMAT = "html";
// 테스트/QA·보안검토가 fail이면 개발로 되돌리는 횟수. 두 단계가 같은 값을 쓴다.
const ON_FAIL_CHOICES = ["stop", "retry:1", "retry:2", "retry:3", "retry:4", "retry:5"];
const DEFAULT_QA_ON_FAIL = "retry:3";
const DEFAULT_SECURITY_ON_FAIL = "retry:3";
// 보안검토의 독립 검토(off · on · strict). 엔진 --security-review와 같은 값이고 off면 인자를 생략한다.
const DEFAULT_SECURITY_REVIEW = "off";
// 여러 AI 브레인스토밍. 회차를 돌리고 안을 내는 AI(엔진 config.js의 BRAINSTORM_PHASES·AI_PROVIDERS·PROVIDER_LABELS).
const BRAINSTORM_PHASES = ["plan", "design"];
const AI_PROVIDERS = ["claude", "codex"];
const PROVIDER_LABELS = { claude: "Claude", codex: "Codex" };
// Codex에 넘기는 model·reasoning effort의 기본값과 허용 단계(엔진 config.js의 DEFAULT_CODEX_*·CODEX_EFFORT_LEVELS). Codex 설정을 따르지 않고 늘 값을 지정한다.
const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_CODEX_MODEL = "gpt-6.1-sol";
const DEFAULT_CODEX_EFFORT = "high";
// 회차를 돌리는 에이전트(엔진 config.js의 RUNNERS·DEFAULT_RUNNER)
const DEFAULT_RUNNER = "claude";
const CODEX_RUNNER = "codex";
// 협의에서 주고받는 최대 횟수(엔진 config.js의 DEBATE_DEFAULT_TURNS·DEBATE_TURNS_LIMIT).
const DEFAULT_DEBATE_TURNS = 8;
const DEBATE_TURNS_LIMIT = 20;

// 왼쪽 레일 너비(px). settingsStore.cjs의 MIN·MAX·DEFAULT_RAIL_WIDTH와 같다.
const RAIL_WIDTH = { collapsed: 64, min: 200, max: 360, default: 224 };

const OPTIONS_LOCKED_TITLE = "종료 요청 후에는 모델·노력·추론을 바꿀 수 없어요";

// 상태별 가운데 버튼. 종료 요청 후에 누르면 메인 프로세스가 확인 모달을 띄우고 강제 종료한다.
const MAIN_ACTIONS = {
    idle: { action: "start", label: "시작", title: "" },
    running: { action: "stop", label: "종료 신호", title: "현재 회차를 마친 뒤 종료해요" },
    stopping: { action: "kill", label: "종료", title: "즉시 중단해요. commit 전 변경은 working tree에 남아요" }
};

export {
    STATUS_OK,
    MODEL_FAMILIES,
    EFFORT_LEVELS,
    POLICIES,
    DEFAULT_MODEL,
    DEFAULT_EFFORT_LEVEL,
    DEFAULT_POLICY,
    POLICY_LABELS,
    MODES,
    DEFAULT_MODE,
    BUILD_PHASES,
    PHASE_LABELS,
    GATE_PHASES,
    DEFAULT_GATES,
    SKIPPABLE_PHASES,
    ALLOW_KEYS,
    DEFAULT_ALLOW,
    DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT,
    ON_FAIL_CHOICES,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    DEFAULT_SECURITY_REVIEW,
    BRAINSTORM_PHASES,
    AI_PROVIDERS,
    PROVIDER_LABELS,
    CODEX_EFFORT_LEVELS,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_EFFORT,
    DEFAULT_RUNNER,
    CODEX_RUNNER,
    DEFAULT_DEBATE_TURNS,
    DEBATE_TURNS_LIMIT,
    RAIL_WIDTH,
    OPTIONS_LOCKED_TITLE,
    MAIN_ACTIONS
};
