import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ModelVersions } from "./islands/ModelVersions.jsx";

// 아직 React로 옮기지 않은 화면(renderer.js) 안의 자리에 섬 단위로 붙인다. 첫 그림은 바로 그려 스모크 테스트가 확인할 수 있게 한다.
const mount = (id, element) => {
    const root = createRoot(document.getElementById(id));

    flushSync(() => root.render(element));
};

mount("model-versions", <ModelVersions />);
