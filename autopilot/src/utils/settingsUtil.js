import { DEFAULT_END_TIME, POLICY_ALIASES, POLICY_SELF, POLICY_TODO, TODO_FILE_NAME } from "./config.js";
import dateUtil from "./dateUtil.js";

const SOURCE_ARGUMENT = "실행 인자";
const SOURCE_DEFAULT = "기본값";
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const getMarkdownSection = (text, title) => {
    const sectionPattern = new RegExp(`^##[ \\t]+${title}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^##[ \\t]|$(?![\\s\\S]))`, "m");

    return text.match(sectionPattern)?.[1] || "";
};

// "오전/오후 N시 M분" 또는 "HH:mm"을 "HH:mm"으로 바꾼다. 해석하지 못하면 빈 문자열이다.
const parseEndTime = (sectionText) => {
    const koreanTimeMatch = sectionText.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
    const clockTimeMatch = sectionText.match(/(\d{1,2}):(\d{2})/);

    if (koreanTimeMatch) {
        const [, meridiem, hourText, minuteText] = koreanTimeMatch;
        let hour = Number(hourText);

        if (meridiem && (hour < 1 || hour > 12)) {
            throw new Error("오전/오후 시각은 1~12시여야 합니다.");
        }

        if (meridiem === "오후" && hour < 12) {
            hour += 12;
        }

        if (meridiem === "오전" && hour === 12) {
            hour = 0;
        }

        return `${dateUtil.padNumber(hour)}:${dateUtil.padNumber(Number(minuteText || 0))}`;
    }

    if (clockTimeMatch) {
        return `${dateUtil.padNumber(Number(clockTimeMatch[1]))}:${clockTimeMatch[2]}`;
    }

    return "";
};

const getEndTimeSetting = (text, endTimeArgument) => {
    let endTime = endTimeArgument;
    let endSource = endTime ? SOURCE_ARGUMENT : SOURCE_DEFAULT;

    if (!endTime) {
        endTime = parseEndTime(getMarkdownSection(text, "실행시간"));

        if (endTime) {
            endSource = TODO_FILE_NAME;
        }
    }

    endTime ||= DEFAULT_END_TIME;

    if (!END_TIME_PATTERN.test(endTime)) {
        throw new Error(`종료 시각 형식이 잘못되었습니다: '${endTime}' (예: ${DEFAULT_END_TIME})`);
    }

    return { endTime: endTime, endSource: endSource };
};

const normalizePolicyArgument = (policyArgument) => {
    const key = policyArgument.toLowerCase();

    if (!Object.hasOwn(POLICY_ALIASES, key)) {
        throw new Error("개선 정책 값이 잘못되었습니다 (auto | todo | 자율개선 | 지시개선).");
    }

    return POLICY_ALIASES[key];
};

// 정책 섹션의 첫 유효 줄이 정확히 정책 이름일 때만 인정한다.
const getPolicyFromText = (text) => {
    const firstPolicyLine =
        getMarkdownSection(text, "정책")
            .split(/\r?\n/)
            .find((line) => line.trim())
            ?.trim() || "";
    const value = firstPolicyLine.replace(/^[`"'*]+|[`"'*]+$/g, "");

    if ([POLICY_SELF, POLICY_TODO].includes(value)) {
        return { policy: value, policySource: TODO_FILE_NAME };
    }

    if (firstPolicyLine) {
        return { policy: "", policySource: `${SOURCE_DEFAULT} (정책 섹션 첫 줄을 해석하지 못함: '${firstPolicyLine}')` };
    }

    return { policy: "", policySource: SOURCE_DEFAULT };
};

const getPolicySetting = (text, policyArgument) => {
    if (policyArgument) {
        return { policy: normalizePolicyArgument(policyArgument), policySource: SOURCE_ARGUMENT };
    }

    const { policy, policySource } = getPolicyFromText(text);

    return { policy: policy || POLICY_SELF, policySource: policySource };
};

// 우선순위: 실행 인자 > TODO 섹션 > 기본값
const getRunSettings = (text, endTimeArgument = "", policyArgument = "", now = new Date()) => {
    const { endTime, endSource } = getEndTimeSetting(text, endTimeArgument);
    const { policy, policySource } = getPolicySetting(text, policyArgument);

    return { deadline: dateUtil.getDeadline(endTime, now), policy: policy, endSource: endSource, policySource: policySource };
};

export default { getMarkdownSection, getRunSettings };
