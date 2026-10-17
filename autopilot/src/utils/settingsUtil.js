import { DEFAULT_COMMIT_PREFIX, DEFAULT_END_TIME, DEFAULT_WORK_BRANCH, POLICY_ALIASES, POLICY_SELF } from "./config.js";
import dateUtil from "./dateUtil.js";
import util from "./util.js";

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

// 커밋 접두어와 작업 브랜치. 우선순위: 실행 인자 > 기본값
const getGitSettings = (commitPrefixArgument, workBranchArgument) => {
    if (commitPrefixArgument !== undefined && !util.isValidCommitPrefix(commitPrefixArgument)) {
        throw new Error("커밋 접두어는 앞뒤 공백·백틱·제어 문자가 없는 1~20자여야 합니다.");
    }

    if (workBranchArgument !== undefined && !util.isValidWorkBranch(workBranchArgument)) {
        throw new Error("작업 브랜치는 영문·숫자·._-과 / 조합의 git 브랜치 이름이어야 하고 main·master는 쓸 수 없습니다.");
    }

    return { commitPrefix: commitPrefixArgument ?? DEFAULT_COMMIT_PREFIX, workBranch: workBranchArgument ?? DEFAULT_WORK_BRANCH };
};

export default { getRunSettings, getGitSettings };
