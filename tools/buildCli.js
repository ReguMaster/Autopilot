import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inject } from "postject";
import { build as buildBundle } from "esbuild";

const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const DEFAULT_TODO_CONTENT = "## Tasks\n\n## 실행시간\n07:00\n\n## 정책\n자율개선\n";

const getBuildPaths = () => {
    const projectDir = path.resolve(import.meta.dirname, "..");
    const kitSourceDir = path.join(projectDir, "autopilot");
    const platformName = `${process.platform}-${process.arch}`;
    const outputDir = path.join(projectDir, "dist", `cli-${platformName}`, "autopilot");
    const buildDir = path.join(projectDir, "dist", `sea-${platformName}`);

    return {
        projectDir: projectDir,
        kitSourceDir: kitSourceDir,
        outputDir: outputDir,
        buildDir: buildDir,
        bundleFile: path.join(buildDir, "autopilot.cjs"),
        blobFile: path.join(buildDir, "sea.blob"),
        configFile: path.join(buildDir, "sea.json"),
        executableFile: path.join(outputDir, process.platform === "win32" ? "autopilot.exe" : "autopilot"),
        archiveFile: path.join(projectDir, "dist", `autopilot-${platformName}.tar.gz`)
    };
};

// ESM 소스를 SEA가 읽을 수 있는 CJS 한 파일로 묶는다.
const bundleSource = async (paths) => {
    await buildBundle({
        entryPoints: [path.join(paths.kitSourceDir, "core", "autopilot_loop.js")],
        outfile: paths.bundleFile,
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        logLevel: "error"
    });
};

const createSeaBlob = (paths) => {
    const seaConfig = { main: paths.bundleFile, output: paths.blobFile, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, execArgvExtension: "none" };

    fs.writeFileSync(paths.configFile, JSON.stringify(seaConfig));

    execFileSync(process.execPath, ["--experimental-sea-config", paths.configFile], { stdio: "inherit" });
};

// 현재 Node 실행 파일에 blob을 삽입해 단일 실행 파일을 만든다.
const injectExecutable = async (paths) => {
    const isMac = process.platform === "darwin";

    fs.copyFileSync(process.execPath, paths.executableFile);
    fs.chmodSync(paths.executableFile, 0o755);

    if (isMac) {
        execFileSync("codesign", ["--remove-signature", paths.executableFile]);
    }

    await inject(paths.executableFile, "NODE_SEA_BLOB", fs.readFileSync(paths.blobFile), {
        sentinelFuse: SEA_FUSE,
        ...(isMac ? { machoSegmentName: "NODE_SEA" } : {})
    });

    if (isMac) {
        execFileSync("codesign", ["--sign", "-", paths.executableFile]);
    }
};

const copyKitFiles = (paths) => {
    fs.copyFileSync(path.join(paths.kitSourceDir, ".gitignore"), path.join(paths.outputDir, ".gitignore"));
    fs.copyFileSync(path.join(paths.projectDir, "README.md"), path.join(paths.outputDir, "README.md"));
    fs.writeFileSync(path.join(paths.outputDir, "AUTOPILOT_TODO.md"), DEFAULT_TODO_CONTENT);
};

const verifyExecutable = (paths) => {
    execFileSync(paths.executableFile, ["--help"], { stdio: "inherit" });
    execFileSync(process.execPath, [path.join(paths.projectDir, "tests", "checkAutopilot.js"), paths.executableFile], { stdio: "inherit", cwd: paths.projectDir });
};

// tar로 묶어 실행 권한과 .gitignore를 보존한다. GNU tar는 드라이브 문자(E:)를 원격 호스트로 읽으므로 상대 경로를 쓴다.
const createArchive = (paths) => {
    const distDir = path.dirname(paths.archiveFile);
    const cliDirName = path.relative(distDir, path.dirname(paths.outputDir));

    execFileSync("tar", ["-czf", path.basename(paths.archiveFile), "-C", cliDirName, "autopilot"], { stdio: "inherit", cwd: distDir });
};

const buildCli = async () => {
    const paths = getBuildPaths();

    fs.rmSync(paths.outputDir, { recursive: true, force: true });
    fs.mkdirSync(paths.outputDir, { recursive: true });
    fs.mkdirSync(paths.buildDir, { recursive: true });

    await bundleSource(paths);

    createSeaBlob(paths);

    await injectExecutable(paths);

    copyKitFiles(paths);
    verifyExecutable(paths);
    createArchive(paths);

    console.log(`Built: ${paths.outputDir}`);
};

buildCli().catch((error) => {
    console.error(error);

    process.exitCode = 1;
});
