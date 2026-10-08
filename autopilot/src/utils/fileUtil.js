import fs from "node:fs";

// BOM이 있는 기존 문서도 읽는다.
const readTextFile = (file) => {
    if (!fs.existsSync(file)) {
        return "";
    }

    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
};

const removeFiles = (files) => {
    for (const file of files) {
        fs.rmSync(file, { force: true });
    }
};

export default { readTextFile, removeFiles };
