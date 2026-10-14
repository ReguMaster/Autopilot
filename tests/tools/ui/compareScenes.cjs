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

app.disableHardwareAcceleration();

const diffImages = (fileA, fileB) => {
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

    return count === 0 ? { same: true } : { same: false, text: `${count}px 다름, 영역 (${minX},${minY})-(${maxX},${maxY})` };
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
                ? diffImages(fileA, fileB)
                : (() => {
                      const a = fs.readFileSync(fileA, "utf8");
                      const b = fs.readFileSync(fileB, "utf8");

                      return a === b ? { same: true } : { same: false, text: firstDifference(a, b) };
                  })();

            if (!result.same) {
                failures++;
                console.log(`[DIFF] ${sceneName}/${file}  ${result.text}`);
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
