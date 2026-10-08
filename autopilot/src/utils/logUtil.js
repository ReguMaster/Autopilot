import fs from "node:fs";

const info = (message) => {
    console.log(message);
};

const error = (message) => {
    console.error(message);
};

// 콘솔과 로그 파일에 같은 내용을 남기는 기록 함수를 만든다.
const createFileLogger = (logFile) => {
    return (text) => {
        console.log(text);

        fs.appendFileSync(logFile, text + "\n", "utf8");
    };
};

export default { info, error, createFileLogger };
