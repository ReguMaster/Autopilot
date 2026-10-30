import { BUILD_PHASES, DEFAULT_RUNNER } from "./constants.js";

// AI 제공자 로고(Symbols의 심볼). Claude는 브랜드 색 스파크, OpenAI(Codex)는 글자색 매듭이다.
const PROVIDER_LOGOS = { claude: "logo-claude", codex: "logo-openai" };

// 단계마다 그 단계의 회차를 돌리는 메인 AI와 그 반대쪽 보조 AI. 엔진 phaseUtil(getPhaseMains·getPhaseAgents)과 desktop/engineArgs.cjs와 같은 규칙이다.
// mains는 부분 맵({ plan: "codex" })이고, 없는 단계는 기본 실행 에이전트(Claude)다.
const getOtherProvider = (provider) => {
    return provider === "claude" ? "codex" : "claude";
};

const getMain = (mains, phase) => {
    return mains?.[phase] ?? DEFAULT_RUNNER;
};

const getAssistant = (mains, phase) => {
    return getOtherProvider(getMain(mains, phase));
};

// 어느 단계의 메인인지 한눈에 보이는 단계 이름 목록. 알약 팝오버가 "메인으로 맡은 단계"에 보인다.
const getMainPhases = (mains, provider, labels) => {
    return BUILD_PHASES.filter((phase) => getMain(mains, phase) === provider).map((phase) => labels[phase]);
};

export { PROVIDER_LOGOS, getOtherProvider, getMain, getAssistant, getMainPhases };
