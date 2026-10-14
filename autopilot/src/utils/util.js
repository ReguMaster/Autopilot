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

export default { sleep, formatError, formatCost, escapeHtml, isValidModel };
