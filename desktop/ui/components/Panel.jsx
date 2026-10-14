import { cx } from "../lib/cx.js";

// 헤더 아래에 뜨는 흰 카드. 닫혀 있으면 inert라 포커스도 클릭도 받지 않는다(열고 닫는 전환은 styles/panels.css가 body의 *-open 클래스로 한다).
const Panel = ({ open, className = "", children, ...props }) => {
    return (
        <aside className={cx("panel", className)} inert={!open} {...props}>
            <div className="panel-scroll">{children}</div>
        </aside>
    );
};

export { Panel };
