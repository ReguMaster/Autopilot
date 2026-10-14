// 허용 값은 엔진 config.js·autopilotRunner.cjs·autopilotIpc.cjs와 같아야 한다(tests/checkDesktopRunner.js가 대조한다).
const STATUS_OK = "OK";
const MODEL_FAMILIES = ["fable", "opus", "sonnet", "haiku"];
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const POLICIES = ["auto", "todo"];
const DEFAULT_MODEL = "opus";
const DEFAULT_EFFORT_LEVEL = 2;
const DEFAULT_POLICY = "auto";

const POLICY_LABELS = { auto: "자율개선", todo: "지시개선" };

export { STATUS_OK, MODEL_FAMILIES, EFFORT_LEVELS, POLICIES, DEFAULT_MODEL, DEFAULT_EFFORT_LEVEL, DEFAULT_POLICY, POLICY_LABELS };
