import { Icon } from "./Icon.jsx";

// 프로젝트 이름 줄 오른쪽의 상태 알약. tone은 run·ok·warn·danger·muted이고, run은 도는 고리를, 나머지는 icon(심볼 id)을 앞에 붙인다.
const HeadTag = ({ id, tone, icon = "", children }) => {
    return (
        <span id={id} className="head-tag" data-tone={tone}>
            {tone === "run" ? <span className="ring" aria-hidden="true" /> : null}
            {tone !== "run" && icon ? <Icon symbol={icon} /> : null}
            {children}
        </span>
    );
};

export { HeadTag };
