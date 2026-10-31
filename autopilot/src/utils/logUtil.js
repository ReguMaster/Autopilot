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
// 파일에 쓰지 못해도(디스크 가득 참, 동기화 프로그램의 잠금, 폴더 삭제) 예외를 던지지 않는다. 세션 출력 처리 중에 던지면 엔진만 죽고 세션은 시한 없이 남는다.
const createFileLogger = (logFile) => {
    let hasWriteError = false;

    return (text) => {
        const safeText = String(text).replace(/\r\n|\r|\n/g, "\n    ");

        console.log(safeText);

        try {
            fs.appendFileSync(logFile, safeText + "\n", "utf8");

            hasWriteError = false;
        } catch (writeError) {
            if (!hasWriteError) {
                error(`[로그] 로그 파일에 쓰지 못해 다시 쓸 수 있을 때까지 콘솔에만 남깁니다: ${writeError.message}`);
            }

            hasWriteError = true;
        }
    };
};

export default { info, error, createFileLogger };
