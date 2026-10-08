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

export default { sleep, formatError, formatCost, escapeHtml };
