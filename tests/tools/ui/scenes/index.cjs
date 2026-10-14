const shell = require("./shell.cjs");
const stage = require("./stage.cjs");
const composer = require("./composer.cjs");
const overlays = require("./overlays.cjs");
const perf = require("./perf.cjs");

const SCENES = [...shell.SCENES, ...stage.SCENES, ...composer.SCENES, ...overlays.SCENES, ...perf.SCENES];

module.exports = { SCENES };
