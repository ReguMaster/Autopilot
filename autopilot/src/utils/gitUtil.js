import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dateUtil from "./dateUtil.js";

const createGitRunner = (gitExecutable, projectDir, env) => {
    return (args) => {
        const result = spawnSync(gitExecutable, ["-c", "core.quotepath=false", ...args], { cwd: projectDir, env: env, encoding: "utf8", windowsHide: true });

        if (result.error || result.status) {
            throw new Error(`git ${args[0]} 실패: ${result.error?.message || result.stderr}`);
        }

        return result.stdout.trim();
    };
};

const assertGitProject = (runGitCommand, projectDir) => {
    const gitRootDir = runGitCommand(["rev-parse", "--show-toplevel"]);

    if (fs.realpathSync.native(gitRootDir) !== fs.realpathSync.native(projectDir)) {
        throw new Error("프로젝트 폴더가 Git 저장소의 루트여야 합니다.");
    }

    // commit이 하나도 없으면 여기서 실패한다.
    runGitCommand(["rev-parse", "HEAD"]);
};

const getHeadHash = (runGitCommand) => {
    return runGitCommand(["rev-parse", "HEAD"]);
};

const getBranchName = (runGitCommand) => {
    return runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"]);
};

const getCommitHashesSince = (runGitCommand, since) => {
    const output = runGitCommand(["log", `--since=${dateUtil.getDatetimeString(since)}`, "--format=%h", "HEAD"]);

    return output.split("\n").filter(Boolean);
};

// 이미 기록한 hash는 제외하고, 새로 찾은 commit은 recordedHashes에 추가한다.
const collectNewCommits = (runGitCommand, since, recordedHashes) => {
    const output = runGitCommand(["log", `--since=${dateUtil.getDatetimeString(since)}`, "--format=%h%x09%s", "HEAD"]);
    const commits = [];

    for (const line of output.split("\n").filter(Boolean)) {
        const [hash, ...subjectParts] = line.split("\t");

        if (recordedHashes.has(hash)) {
            continue;
        }

        recordedHashes.add(hash);

        commits.push({
            hash: hash,
            subject: subjectParts.join("\t"),
            stat: runGitCommand(["show", "--shortstat", "--format=", hash])
        });
    }

    return commits;
};

// 회차 전후로 HEAD의 파일 내용이 달라지지 않았으면 작업이 없는 것으로 본다. 진행 기록은 저장소 밖에 있어 commit에 포함되지 않는다.
const hasWorkChanges = (runGitCommand, previousHash) => {
    return Boolean(runGitCommand(["diff", "--name-only", previousHash, "HEAD"]));
};

const getRecentLog = (runGitCommand) => {
    return runGitCommand(["--no-pager", "log", "--oneline", "-20"]);
};

const getStatus = (runGitCommand) => {
    return runGitCommand(["status"]);
};

const getShortStatus = (runGitCommand) => {
    return runGitCommand(["status", "--short"]);
};

export default { createGitRunner, assertGitProject, getHeadHash, getBranchName, getCommitHashesSince, collectNewCommits, hasWorkChanges, getRecentLog, getStatus, getShortStatus };
