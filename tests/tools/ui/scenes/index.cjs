const shell = require("./shell.cjs");
const stage = require("./stage.cjs");
const composer = require("./composer.cjs");

const SCENES = [...shell.SCENES, ...stage.SCENES, ...composer.SCENES];

module.exports = { SCENES };
