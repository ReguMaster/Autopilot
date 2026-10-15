const fs = require("node:fs");
const path = require("node:path");

const BACKUP_SUFFIX = ".bak";
const CORRUPT_SUFFIX = ".corrupt";

const parseObject = (text) => {
    try {
        const value = JSON.parse(text.replace(/^\uFEFF/, ""));

        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

// state: ok(객체를 읽음) · missing(파일 없음) · corrupt(JSON이 깨졌거나 객체가 아님) · unreadable(권한·잠금 등으로 읽지 못함)
const readJsonFile = (file) => {
    let text = "";

    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        return { state: error.code === "ENOENT" ? "missing" : "unreadable", data: null };
    }

    const data = parseObject(text);

    return data ? { state: "ok", data: data } : { state: "corrupt", data: null };
};

// 임시 파일에 다 쓰고 디스크에 반영한 뒤 교체해 쓰는 도중 꺼져도 원본이 반쯤 쓰인 채 남지 않는다.
// 교체 전에 읽을 수 있는 원본만 .bak으로 보관해, 깨진 파일이 좋은 백업을 덮지 않게 한다.
const writeJsonFile = (file, data) => {
    const temp = `${file}.${process.pid}.tmp`;

    fs.mkdirSync(path.dirname(file), { recursive: true });

    try {
        const descriptor = fs.openSync(temp, "w");

        try {
            fs.writeFileSync(descriptor, JSON.stringify(data, null, 4), "utf8");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }

        if (readJsonFile(file).state === "ok") {
            fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`);
        }

        fs.renameSync(temp, file);
    } catch (error) {
        fs.rmSync(temp, { force: true });

        throw error;
    }
};

// 깨진 파일을 .corrupt로 옮겨 두고 직전 백업이 있으면 되살린다. 반환: none(손상 아님) · restored(백업으로 복구) · reset(백업도 없어 비움)
const recoverJsonFile = (file) => {
    if (readJsonFile(file).state !== "corrupt") {
        return "none";
    }

    try {
        fs.renameSync(file, `${file}${CORRUPT_SUFFIX}`);
    } catch {
        return "none";
    }

    if (readJsonFile(`${file}${BACKUP_SUFFIX}`).state !== "ok") {
        return "reset";
    }

    fs.copyFileSync(`${file}${BACKUP_SUFFIX}`, file);

    return "restored";
};

module.exports = { readJsonFile, writeJsonFile, recoverJsonFile, BACKUP_SUFFIX, CORRUPT_SUFFIX };
