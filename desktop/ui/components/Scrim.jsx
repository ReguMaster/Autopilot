import { ui } from "../stores/uiStore.js";

// 패널·시트가 열리면 헤더 아래 화면을 옅게 덮는다. 누르면 모두 닫는다.
const Scrim = () => {
    return <div className="scrim" aria-hidden="true" onClick={ui.closeAll}></div>;
};

export { Scrim };
