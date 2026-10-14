// Electron으로 실행한다: electron tests/tools/ui/compareScenes.cjs -- --a <기준 폴더> --b <비교 폴더>
// 같은 이름의 PNG는 픽셀로, .dom.txt는 문자열로 비교한다. 다르면 종료 코드 1이다.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const readArgument = (name) => {
    const index = process.argv.indexOf(`--${name}`);

    return index >= 0 ? process.argv[index + 1] : "";
};

const DIR_A = readArgument("a");
const DIR_B = readArgument("b");
const IGNORED_PREFIXES = readArgument("ignore") ? readArgument("ignore").split(",") : [];
const TOLERANCE = 8;
const BLOCK_SIZE = 8;
const BLOCK_TOLERANCE = 24;

app.disableHardwareAcceleration();

const getBlockDelta = (bitmapA, bitmapB, { width, height }) => {
    let max = 0;

    for (let blockY = 0; blockY + BLOCK_SIZE <= height; blockY += BLOCK_SIZE) {
        for (let blockX = 0; blockX + BLOCK_SIZE <= width; blockX += BLOCK_SIZE) {
            for (let channel = 0; channel < 3; channel++) {
                let sumA = 0;
                let sumB = 0;

                for (let y = 0; y < BLOCK_SIZE; y++) {
                    for (let x = 0; x < BLOCK_SIZE; x++) {
                        const index = ((blockY + y) * width + blockX + x) * 4 + channel;

                        sumA += bitmapA[index];
                        sumB += bitmapB[index];
                    }
                }

                max = Math.max(max, Math.abs(sumA - sumB) / (BLOCK_SIZE * BLOCK_SIZE));
            }
        }
    }

    return max;
};

const diffImages = (fileA, fileB, isTolerant) => {
    const a = nativeImage.createFromBuffer(fs.readFileSync(fileA));
    const b = nativeImage.createFromBuffer(fs.readFileSync(fileB));
    const sizeA = a.getSize();
    const sizeB = b.getSize();

    if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) {
        return { same: false, text: `크기 다름 ${sizeA.width}×${sizeA.height} / ${sizeB.width}×${sizeB.height}` };
    }

    const bitmapA = a.toBitmap();
    const bitmapB = b.toBitmap();
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < bitmapA.length; index += 4) {
        const delta = Math.max(Math.abs(bitmapA[index] - bitmapB[index]), Math.abs(bitmapA[index + 1] - bitmapB[index + 1]), Math.abs(bitmapA[index + 2] - bitmapB[index + 2]));

        if (delta > TOLERANCE) {
            const pixel = index / 4;
            const x = pixel % sizeA.width;
            const y = Math.floor(pixel / sizeA.width);

            count++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (count === 0) {
        return { same: true };
    }

    // 글자 래스터 이력에 따라 서브픽셀 위치가 달라지는 샷(tolerant)은 8×8 블록 평균이 크게 다르지 않으면 같은 것으로 본다.
    if (isTolerant && getBlockDelta(bitmapA, bitmapB, sizeA) <= BLOCK_TOLERANCE) {
        return { same: true, note: `${count}px 다름(글자 서브픽셀, 블록 평균은 같음)` };
    }

    return { same: false, text: `${count}px 다름, 영역 (${minX},${minY})-(${maxX},${maxY})` };
};

const firstDifference = (a, b) => {
    let index = 0;

    while (index < a.length && a[index] === b[index]) {
        index++;
    }

    return `${index}번째 글자부터 다름\n      A: …${a.slice(Math.max(0, index - 40), index + 120)}\n      B: …${b.slice(Math.max(0, index - 40), index + 120)}`;
};

const main = () => {
    const sceneNames = fs.readdirSync(DIR_A).filter((name) => fs.statSync(path.join(DIR_A, name)).isDirectory() && fs.existsSync(path.join(DIR_B, name)));
    let failures = 0;
    let checked = 0;

    for (const sceneName of sceneNames) {
        const files = fs.readdirSync(path.join(DIR_A, sceneName));

        for (const file of files) {
            const fileA = path.join(DIR_A, sceneName, file);
            const fileB = path.join(DIR_B, sceneName, file);

            if (!fs.existsSync(fileB) || IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
                continue;
            }

            checked++;

            const result = file.endsWith(".png")
                ? diffImages(fileA, fileB, fs.existsSync(fileA.replace(/.png$/, ".tolerant")) || fs.existsSync(fileB.replace(/.png$/, ".tolerant")))
                : (() => {
                      const a = fs.readFileSync(fileA, "utf8");
                      const b = fs.readFileSync(fileB, "utf8");

                      return a === b ? { same: true } : { same: false, text: firstDifference(a, b) };
                  })();

            if (result.note) {
                console.log(`[AA] ${sceneName}/${file}  ${result.note}`);
            }

            if (!result.same) {
                failures++;
                console.log(`[DIFF] ${sceneName}/${file}  ${result.text}`);
            }
        }
    }

    // 장면이 note로 남긴 값(예: 기록한 IPC 호출)도 같아야 한다.
    const readReport = (dir) => (fs.existsSync(path.join(dir, "report.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) : {});
    const reportA = readReport(DIR_A);
    const reportB = readReport(DIR_B);

    for (const [sceneName, entryA] of Object.entries(reportA)) {
        for (const [key, value] of Object.entries(entryA)) {
            if (key.startsWith("perf")) {
                console.log(`[PERF] ${sceneName} ${key}
      A: ${JSON.stringify(value)}
      B: ${JSON.stringify(reportB[sceneName]?.[key])}`);

                continue;
            }

            if (!["console", "error"].includes(key) && reportB[sceneName] && JSON.stringify(value) !== JSON.stringify(reportB[sceneName][key])) {
                failures++;
                console.log(`[DIFF] ${sceneName} note ${key}\n      A: ${JSON.stringify(value)}\n      B: ${JSON.stringify(reportB[sceneName][key])}`);
            }
        }
    }

    for (const dir of [DIR_A, DIR_B]) {
        const reportFile = path.join(dir, "report.json");

        if (fs.existsSync(reportFile)) {
            const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

            for (const [sceneName, entry] of Object.entries(report)) {
                if (entry.error) {
                    failures++;
                    console.log(`[ERROR] ${path.basename(dir)}:${sceneName} ${entry.error}`);
                }

                if (dir === DIR_B && entry.console?.length) {
                    console.log(`[콘솔] ${sceneName}: ${entry.console.join(" | ")}`);
                }
            }
        }
    }

    console.log(`비교 ${checked}건, 차이 ${failures}건`);
    app.exit(failures === 0 ? 0 : 1);
};

app.whenReady().then(main);
