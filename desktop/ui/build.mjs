import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const UI_DIR = import.meta.dirname;
const OUT_DIR = path.join(UI_DIR, "..", "bundle");
const IS_WATCH = process.argv.includes("--watch");

// viewFormat.js는 renderer.js와 같은 클래식 스크립트라 export가 없다. 최상위 const를 모두 내보내는 모듈로 읽어 UI 코드가 import하게 한다.
const viewFormatPlugin = {
    name: "view-format",
    setup: (pluginBuild) => {
        pluginBuild.onLoad({ filter: /[\\/]desktop[\\/]viewFormat\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, "utf8");
            const names = [...source.matchAll(/^const ([A-Za-z0-9_]+) =/gm)].map((match) => match[1]);

            return { contents: `${source}\nexport { ${names.join(", ")} };`, loader: "js" };
        });
    }
};

const getOptions = () => {
    return {
        entryPoints: [path.join(UI_DIR, "index.jsx")],
        outdir: OUT_DIR,
        entryNames: "ui",
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
