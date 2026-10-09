import { DEFAULT_END_TIME, POLICY_ALIASES, POLICY_SELF } from "./config.js";
import dateUtil from "./dateUtil.js";

const SOURCE_ARGUMENT = "실행 인자";
const SOURCE_DEFAULT = "기본값";
const END_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const getEndTimeSetting = (endTimeArgument) => {
    const endTime = endTimeArgument || DEFAULT_END_TIME;

    if (!END_TIME_PATTERN.test(endTime)) {
        throw new Error(`종료 시각 형식이 잘못되었습니다: '${endTime}' (예: ${DEFAULT_END_TIME})`);
    }

    return { endTime: endTime, endSource: endTimeArgument ? SOURCE_ARGUMENT : SOURCE_DEFAULT };
};

const getPolicySetting = (policyArgument) => {
    if (!policyArgument) {
        return { policy: POLICY_SELF, policySource: SOURCE_DEFAULT };
    }

    const key = policyArgument.toLowerCase();

    if (!Object.hasOwn(POLICY_ALIASES, key)) {
        throw new Error("개선 정책 값이 잘못되었습니다 (auto | todo | 자율개선 | 지시개선).");
    }

    return { policy: POLICY_ALIASES[key], policySource: SOURCE_ARGUMENT };
};

// 우선순위: 실행 인자 > 기본값
const getRunSettings = (endTimeArgument = "", policyArgument = "", now = new Date()) => {
    const { endTime, endSource } = getEndTimeSetting(endTimeArgument);
    const { policy, policySource } = getPolicySetting(policyArgument);

    return { deadline: dateUtil.getDeadline(endTime, now), policy: policy, endSource: endSource, policySource: policySource };
};

export default { getRunSettings };
