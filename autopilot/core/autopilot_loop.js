#!/usr/bin/env node

import { STATUS_OK, EXIT_CODE_SUCCESS, EXIT_CODE_FAILED } from "../src/utils/config.js";
import { runAutopilot, requestStop } from "../src/services/autopilotService.js";

import log from "../src/utils/logUtil.js";
import cliUtil from "../src/utils/cliUtil.js";

const runCli = async (args = process.argv.slice(2)) => {
    if (args[0] === "--help") {
        log.info(cliUtil.HELP_TEXT);

        return EXIT_CODE_SUCCESS;
    }

    if (args[0] === "stop") {
        if (args.length !== 1) {
            throw new Error(cliUtil.STOP_USAGE_TEXT);
        }

        const requestStopResult = requestStop();

        if (requestStopResult.status !== STATUS_OK) {
            return EXIT_CODE_FAILED;
        }

        log.info("AutoPilot will stop after the current round.");

        return EXIT_CODE_SUCCESS;
    }

    const runAutopilotResult = await runAutopilot(cliUtil.parseCommandArgs(args));

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
