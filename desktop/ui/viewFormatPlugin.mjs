import fs from "node:fs";

// viewFormat.js는 renderer.js와 같은 클래식 스크립트로 시작해 export가 없다. 최상위 const를 모두 내보내는 모듈로 읽어 UI 코드가 import하게 한다.
const viewFormatPlugin = {
    name: "view-format",
    setup: (pluginBuild) => {
        pluginBuild.onLoad({ filter: /[\\/]desktop[\\/]viewFormat\.js$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, "utf8");

            if (/^export /m.test(source)) {
                return { contents: source, loader: "js" };
            }

            const names = [...source.matchAll(/^const ([A-Za-z0-9_]+) =/gm)].map((match) => match[1]);

            return { contents: `${source}\nexport { ${names.join(", ")} };`, loader: "js" };
        });
    }
};

export { viewFormatPlugin };
