import fs from "node:fs";

const info = (message) => {
    console.log(message);
};

const error = (message) => {
    console.error(message);
};

// 콘솔과 로그 파일에 같은 내용을 남기는 기록 함수를 만든다.
// 데스크톱 앱이 줄 맨 앞의 형식으로 로그를 해석하므로 줄바꿈 뒤는 들여써서, Claude 출력이나 오류 메시지가 헤더·회차·종료 줄을 흉내 내지 못하게 한다.
// 그래서 호출 한 번은 제어 줄 한 줄이어야 한다.
const createFileLogger = (logFile) => {
    return (text) => {
        const safeText = String(text).replace(/\r\n|\r|\n/g, "\n    ");

        console.log(safeText);

        fs.appendFileSync(logFile, safeText + "\n", "utf8");
    };
};

export default { info, error, createFileLogger };
