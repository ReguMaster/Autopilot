const STATUS_OK = "OK";
const STATUS_FAILED = "FAILED";

const ERROR_CODE_AUTOPILOT_FAILED = "AUTOPILOT_FAILED";
const ERROR_CODE_AUTOPILOT_ERROR = "AUTOPILOT_ERROR";

const SECOND_MS = 1000;
const MINUTE_MS = 60000;
const WAIT_POLL_MS = 250;
const REPORT_REFRESH_MS = 30000;

const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_FAILED = 1;
const EXIT_CODE_INTERRUPTED = 130;

const POLICY_SELF = "자율개선";
const POLICY_TODO = "지시개선";
const POLICY_ALIASES = {
    auto: POLICY_SELF,
    self: POLICY_SELF,
    [POLICY_SELF]: POLICY_SELF,
    todo: POLICY_TODO,
    directed: POLICY_TODO,
    [POLICY_TODO]: POLICY_TODO
};

// 작업 모드. 유지 보수는 기존 회차 실행이고, 신규 개발은 기획→디자인→개발→테스트/QA→보안검토 단계를 차례로 밟는다.
const MODE_MAINTAIN = "maintain";
const MODE_BUILD = "build";
const MODES = [MODE_MAINTAIN, MODE_BUILD];
const BUILD_PHASES = ["plan", "design", "build", "qa", "security"];
const PHASE_DONE = "done";
const PHASE_LABELS = { plan: "기획", design: "디자인", build: "개발", qa: "테스트/QA", security: "보안검토" };
// 끝나면 멈추고 사용자 확인을 받을 수 있는 단계
const GATE_PHASES = ["plan", "design"];
// 이번 실행에서 하지 않기로 정할 수 있는 단계(--skip). 기획과 개발은 뼈대라 건너뛸 수 없다.
const SKIPPABLE_PHASES = ["design", "qa", "security"];
// 신규 개발에서 실행마다 켜는 정책 완화. deps 새 라이브러리(패키지), large 큰 구조 만들기, external-api 외부 API 호출 코드, send 외부 서비스로 코드 보내기
const ALLOW_KEYS = ["deps", "large", "external-api", "send"];
const DESIGN_FORMATS = ["md", "html", "figma", "image"];
const DEFAULT_DESIGN_FORMAT = "html";
// 테스트/QA·보안검토가 fail이면 개발로 되돌리는 횟수(stop은 되돌리지 않고 멈춤). 단계마다 따로 센다.
const ON_FAIL_STOP = "stop";
const MAX_FAIL_RETRIES = 5;
const DEFAULT_QA_ON_FAIL = "retry:3";
const DEFAULT_SECURITY_ON_FAIL = "retry:3";
// 보안검토의 독립 검토(--security-review). on은 검토하지 못하면 메인의 판정대로 진행하고, strict는 검토하지 못한 보안검토를 통과시키지 않는다.
const SECURITY_REVIEW_ON = "on";
const SECURITY_REVIEW_STRICT = "strict";
const SECURITY_REVIEW_MODES = [SECURITY_REVIEW_ON, SECURITY_REVIEW_STRICT];
// 여러 AI 브레인스토밍. 이 단계에서는 그 단계의 메인 AI와 상대 AI(보조)가 각자 안을 내고 사용자가 고른다.
// 메인은 단계마다 정하고(--main) 보조는 늘 메인의 반대쪽 AI다. 제공자는 providerUtil에 더한다.
const BRAINSTORM_PHASES = ["plan", "design"];
const PROVIDER_CLAUDE = "claude";
const PROVIDER_CODEX = "codex";
const AI_PROVIDERS = [PROVIDER_CLAUDE, PROVIDER_CODEX];
const PROVIDER_LABELS = { claude: "Claude", codex: "Codex" };
// Codex에 넘기는 model(Codex가 쓰는 이름, 예: gpt-6.1-sol)과 reasoning effort. Codex 설정(~/.codex/config.toml)을 따르지 않고 늘 값을 지정해 넘긴다.
const CODEX_MODEL_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,62}$/;
const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_CODEX_MODEL = "gpt-6.1-sol";
const DEFAULT_CODEX_EFFORT = "high";
// 회차를 실행하는 에이전트(--runner). 유지 보수는 실행 중 set으로 다음 회차부터 바꿀 수 있다. 신규 개발은 단계마다 --main이 정하고 --runner는 --main에 없는 단계의 기본값이다.
const RUNNERS = AI_PROVIDERS;
const DEFAULT_RUNNER = PROVIDER_CLAUDE;
const PROPOSALS_DIR = "docs/autopilot/proposals";
const PROVIDER_TIMEOUT_MINUTES = 30;
// 브레인스토밍 방식. compare는 두 안을 나란히 보여 주고 사용자가 고르고, debate는 두 AI가 주고받아 합의안과 못 맞춘 쟁점을 남긴다.
const BRAINSTORM_COMPARE = "compare";
const BRAINSTORM_DEBATE = "debate";
const BRAINSTORM_MODES = [BRAINSTORM_COMPARE, BRAINSTORM_DEBATE];
// 협의에서 주고받는 최대 횟수(--debate-turns). 한 번은 메인이 말하고 보조가 답하는 것이다. 둘 다 반대·개선점이 없으면 상한 전에 끝낸다.
const DEBATE_DEFAULT_TURNS = 8;
const DEBATE_TURNS_LIMIT = 20;
const DEBATE_TURN_MINUTES = 10;

const DEFAULT_END_TIME = "07:00";
const DEFAULT_MODEL = "opus";
const FALLBACK_MODEL = "sonnet";
// 없어도 세션이 도는 claude 옵션. 설치된 Claude Code가 모르면 빼고 실행한다(autopilotUtil.getClaudeArgs).
const OPTIONAL_CLAUDE_FLAGS = ["--effort", "--fallback-model", "--autocompact"];
const MODEL_CHOICES = ["fable", "opus", "sonnet", "haiku"];
const MODEL_ID_PATTERN = /^claude-[a-z0-9][a-z0-9.-]{0,62}$/;
const DEFAULT_EFFORT = "high";
const DEFAULT_COMMIT_PREFIX = "[ap]";
const DEFAULT_WORK_BRANCH = "ai/autopilot";
// 작업 프로젝트에 더할 수 있는 연결 저장소 수(작업 프로젝트를 합쳐 3개).
const MAX_LINKED_REPOS = 2;
const MAX_EXTEND_MINUTES = 7 * 24 * 60;
// 종료 시각에 날짜를 붙여 정할 수 있는 최대 기간(일). 회차 상한은 하루마다 maxRounds씩 늘어난다.
const MAX_RUN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_RETENTION_DAYS = 3650;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

const WORK_DIR_NAME = ".autopilot";
const APP_DATA_DIR_NAME = "AutoPilot";
const PROJECTS_DATA_DIR_NAME = "projects";
const PROGRESS_FILE_NAME = "AUTOPILOT_PROGRESS.md";
const PROGRESS_DIR_NAME = "progress";
const STOP_FILE_NAME = "STOP";
const ROUND_OPTIONS_FILE_NAME = "ROUND_OPTIONS.json";
const LOCK_FILE_NAME = "RUNNING";
const TODO_COMPLETE_FILE_NAME = "TODO_COMPLETE";
const PHASE_FILE_NAME = "PHASE.json";
const PHASE_DONE_FILE_NAME = "PHASE_DONE";
const PROGRESS_MAX_LINES = 100;
const PROGRESS_TARGET_LINES = 60;

const MAX_STREAM_LINE_LENGTH = 1000000;
const MAX_STDERR_LENGTH = 1000000;

const ROUND_OUTCOME_COMPLETE = "완료";
const ROUND_OUTCOME_IDLE = "commit 없음";
const ROUND_OUTCOME_INTERRUPTED = "중단됨";
const ROUND_OUTCOME_RATE_LIMITED = "사용량 한도";
const ROUND_OUTCOME_TIMED_OUT = "시한 초과";

const STOP_REASON_REQUESTED = "중단 요청";

const AUTOPILOT_DEFAULTS = {
    minMinutes: 20,
    maxRounds: 60,
    maxRoundMinutes: 120,
    retryWaitMinutes: [5, 15, 30],
    maxIdleRounds: 2,
    maxTasks: 2,
    resetGraceMs: MINUTE_MS,
    logRetentionDays: 30,
    providerHeartbeatMs: MINUTE_MS
};

export {
    STATUS_OK,
    STATUS_FAILED,
    ERROR_CODE_AUTOPILOT_FAILED,
    ERROR_CODE_AUTOPILOT_ERROR,
    SECOND_MS,
    MINUTE_MS,
    WAIT_POLL_MS,
    REPORT_REFRESH_MS,
    EXIT_CODE_SUCCESS,
    EXIT_CODE_FAILED,
    EXIT_CODE_INTERRUPTED,
    POLICY_SELF,
    POLICY_TODO,
    POLICY_ALIASES,
    MODE_MAINTAIN,
    MODE_BUILD,
    MODES,
    BUILD_PHASES,
    PHASE_DONE,
    PHASE_LABELS,
    GATE_PHASES,
    SKIPPABLE_PHASES,
    ALLOW_KEYS,
    DESIGN_FORMATS,
    DEFAULT_DESIGN_FORMAT,
    ON_FAIL_STOP,
    MAX_FAIL_RETRIES,
    DEFAULT_QA_ON_FAIL,
    DEFAULT_SECURITY_ON_FAIL,
    SECURITY_REVIEW_ON,
    SECURITY_REVIEW_STRICT,
    SECURITY_REVIEW_MODES,
    BRAINSTORM_PHASES,
    PROVIDER_CLAUDE,
    PROVIDER_CODEX,
    AI_PROVIDERS,
    PROVIDER_LABELS,
    CODEX_MODEL_PATTERN,
    CODEX_EFFORT_LEVELS,
    DEFAULT_CODEX_MODEL,
    DEFAULT_CODEX_EFFORT,
    RUNNERS,
    DEFAULT_RUNNER,
    PROPOSALS_DIR,
    PROVIDER_TIMEOUT_MINUTES,
    BRAINSTORM_COMPARE,
    BRAINSTORM_DEBATE,
    BRAINSTORM_MODES,
    DEBATE_DEFAULT_TURNS,
    DEBATE_TURNS_LIMIT,
    DEBATE_TURN_MINUTES,
    DEFAULT_END_TIME,
    DEFAULT_MODEL,
    FALLBACK_MODEL,
    OPTIONAL_CLAUDE_FLAGS,
    MODEL_CHOICES,
    MODEL_ID_PATTERN,
    DEFAULT_EFFORT,
    DEFAULT_COMMIT_PREFIX,
    DEFAULT_WORK_BRANCH,
    MAX_LINKED_REPOS,
    MAX_EXTEND_MINUTES,
    MAX_RUN_DAYS,
    DAY_MS,
    MAX_LOG_RETENTION_DAYS,
    EFFORT_LEVELS,
    WORK_DIR_NAME,
    APP_DATA_DIR_NAME,
    PROJECTS_DATA_DIR_NAME,
    PROGRESS_FILE_NAME,
    PROGRESS_DIR_NAME,
    STOP_FILE_NAME,
    ROUND_OPTIONS_FILE_NAME,
    LOCK_FILE_NAME,
    TODO_COMPLETE_FILE_NAME,
    PHASE_FILE_NAME,
    PHASE_DONE_FILE_NAME,
    PROGRESS_MAX_LINES,
    PROGRESS_TARGET_LINES,
    MAX_STREAM_LINE_LENGTH,
    MAX_STDERR_LENGTH,
    ROUND_OUTCOME_COMPLETE,
    ROUND_OUTCOME_IDLE,
    ROUND_OUTCOME_INTERRUPTED,
    ROUND_OUTCOME_RATE_LIMITED,
    ROUND_OUTCOME_TIMED_OUT,
    STOP_REASON_REQUESTED,
    AUTOPILOT_DEFAULTS
};
