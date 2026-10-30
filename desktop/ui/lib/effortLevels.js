import { formatEffort } from "../../viewFormat.js";
import { CODEX_EFFORT_LEVELS, EFFORT_LEVELS } from "./constants.js";

// 노력(Claude)·추론(Codex)의 다섯 단계 설명. 이름표만 AI마다 조금 다르다(Claude는 가운데가 기본값이고, Codex는 기본이 Codex 설정에 따로 있어 가운데를 기본값이라고 부르지 않는다).
const LEVEL_INFO = [
    { tags: { claude: "가장 빠르게", codex: "가장 빠르게" }, desc: "생각을 거의 줄이고 바로 해요. 이름 바꾸기처럼 간단한 수정에 알맞아요." },
    { tags: { claude: "가볍게", codex: "가볍게" }, desc: "빠르게 하면서 기본 확인은 해요. 작은 기능이나 문서를 고칠 때 알맞아요." },
    { tags: { claude: "기본값", codex: "깊게" }, desc: "대부분의 작업에 알맞은 균형이에요. 고치기 전에 충분히 읽고 생각해요." },
    { tags: { claude: "더 깊게", codex: "더 깊게" }, desc: "한참 더 생각해요. 어려운 버그를 찾거나 구조를 바꿀 때 써요." },
    { tags: { claude: "가장 깊게", codex: "가장 깊게" }, desc: "가능한 만큼 깊이 생각해요. 가장 오래 걸리고 사용량도 가장 많이 써요." }
];

// 한 AI의 단계 값(low~max)과 화면에 보일 이름(Low~Max)
const getLevelValues = (provider) => (provider === "codex" ? CODEX_EFFORT_LEVELS : EFFORT_LEVELS);
const getLevelNames = (provider) => getLevelValues(provider).map((level) => formatEffort(level, provider));

export { LEVEL_INFO, getLevelValues, getLevelNames };
