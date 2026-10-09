#!/usr/bin/env node

import fs from "node:fs";
import { STATUS_OK, EXIT_CODE_SUCCESS, EXIT_CODE_FAILED } from "../src/utils/config.js";
import { runAutopilot, requestStop, requestRoundOptions, getRunStatus, requestProgressReset } from "../src/services/autopilotService.js";

import log from "../src/utils/logUtil.js";
import cliUtil from "../src/utils/cliUtil.js";
import fileUtil from "../src/utils/fileUtil.js";

const readTasks = (tasksFile) => {
    if (!tasksFile) {
        return "";
    }

    if (!fs.existsSync(tasksFile)) {
        throw new Error(`작업 파일을 찾지 못했습니다: ${tasksFile}`);
    }

    return fileUtil.readTextFile(tasksFile);
};

const runCli = async (args = process.argv.slice(2)) => {
    if (args[0] === "--help") {
        log.info(cliUtil.HELP_TEXT);

        return EXIT_CODE_SUCCESS;
    }

    if (args[0] === "stop") {
        const requestStopResult = requestStop(cliUtil.parseProjectArgs(args.slice(1)));

        if (requestStopResult.status !== STATUS_OK) {
            return EXIT_CODE_FAILED;
        }

        log.info("AutoPilot will stop after the current round.");

        return EXIT_CODE_SUCCESS;
    }

    if (args[0] === "status") {
        const getRunStatusResult = getRunStatus(cliUtil.parseProjectArgs(args.slice(1)));

        if (getRunStatusResult.status !== STATUS_OK) {
            return EXIT_CODE_FAILED;
        }

        log.info(JSON.stringify(getRunStatusResult.data));

        return EXIT_CODE_SUCCESS;
    }

    if (args[0] === "reset-progress") {
        const requestProgressResetResult = requestProgressReset(cliUtil.parseProjectArgs(args.slice(1)));

        if (requestProgressResetResult.status !== STATUS_OK) {
            return EXIT_CODE_FAILED;
        }

        const { isReset, archivePath } = requestProgressResetResult.data;

        log.info(isReset ? `Progress record reset. Original archived: ${archivePath}` : "Progress record is already initial.");

        return EXIT_CODE_SUCCESS;
    }

    if (args[0] === "set") {
        const { projectDir, ...roundOptions } = cliUtil.parseSetArgs(args.slice(1));
        const requestRoundOptionsResult = requestRoundOptions(roundOptions, { projectDir: projectDir });

        if (requestRoundOptionsResult.status !== STATUS_OK) {
            return EXIT_CODE_FAILED;
        }

        const { model, effort } = requestRoundOptionsResult.data.roundOptions;

        log.info(`AutoPilot will use model ${model ?? "(default)"}, effort ${effort ?? "(default)"} from the next round.`);

        return EXIT_CODE_SUCCESS;
    }

    const runOptions = cliUtil.parseRunArgs(args);
    const runAutopilotResult = await runAutopilot({ ...runOptions, tasks: readTasks(runOptions.tasksFile) });

    return runAutopilotResult.data?.exitCode ?? EXIT_CODE_FAILED;
};

runCli()
    .then((exitCode) => {
        process.exitCode = exitCode;
    })
    .catch((error) => {
        log.error(error.message);

        process.exitCode = EXIT_CODE_FAILED;
    });
