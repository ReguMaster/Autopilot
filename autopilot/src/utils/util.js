import { MODEL_CHOICES, MODEL_ID_PATTERN } from "./config.js";

const HTML_ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
};

const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const formatError = (error) => {
    return error?.stack || String(error);
};

const formatCost = (cost) => {
    return Number(cost || 0).toFixed(2);
};

const escapeHtml = (value) => {
    return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
};

// 별칭(최신 버전)이거나 특정 버전의 모델 ID여야 한다.
const isValidModel = (model) => {
    return MODEL_CHOICES.includes(model) || MODEL_ID_PATTERN.test(model);
};

// 커밋 접두어는 지침에 `로 감싸 넣으므로 백틱·제어 문자와 앞뒤 공백이 없는 1~20자여야 한다.
const COMMIT_PREFIX_PATTERN = /^[^`\p{Cc}]{1,20}$/u;
// 작업 브랜치는 git 참조 이름으로 쓸 수 있는 영문·숫자·._-과 / 조합이어야 하고, 보호 브랜치는 쓸 수 없다(AI가 기본 브랜치에 직접 커밋하지 않게 한다).
const WORK_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_WORK_BRANCH_LENGTH = 100;
const PROTECTED_BRANCHES = ["main", "master", "head"];

const isValidCommitPrefix = (value) => {
    return typeof value === "string" && value === value.trim() && COMMIT_PREFIX_PATTERN.test(value) && !value.startsWith("--");
};

const isValidWorkBranch = (value) => {
    return (
        typeof value === "string" &&
        value.length <= MAX_WORK_BRANCH_LENGTH &&
        WORK_BRANCH_PATTERN.test(value) &&
        !value.includes("..") &&
        value.split("/").every((segment) => !segment.endsWith(".lock") && !segment.endsWith(".")) &&
        !PROTECTED_BRANCHES.includes(value.toLowerCase())
    );
};

export default { sleep, formatError, formatCost, escapeHtml, isValidModel, isValidCommitPrefix, isValidWorkBranch };
