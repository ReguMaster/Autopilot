import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { viewFormatPlugin } from "./viewFormatPlugin.mjs";

const UI_DIR = import.meta.dirname;
const OUT_DIR = path.join(UI_DIR, "..", "bundle");
const IS_WATCH = process.argv.includes("--watch");

const getOptions = () => {
    return {
        entryPoints: { ui: path.join(UI_DIR, "index.jsx"), app: path.join(UI_DIR, "main.jsx") },
        outdir: OUT_DIR,
        entryNames: "[name]",
        bundle: true,
        format: "iife",
        target: "chrome140",
        jsx: "automatic",
        minify: !IS_WATCH,
        sourcemap: IS_WATCH,
        define: { "process.env.NODE_ENV": IS_WATCH ? '"development"' : '"production"' },
        plugins: [viewFormatPlugin],
        logLevel: "info"
    };
};

const run = async () => {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });

    if (!IS_WATCH) {
        await build(getOptions());

        return;
    }

    const watcher = await context(getOptions());

    await watcher.watch();
};

run().catch(() => process.exit(1));
