import { cx } from "../lib/cx.js";

// 설정 패널의 묶음: 제목과 흰 카드.
const SettingsGroup = ({ id, sectionId, title, children, ...props }) => {
    return (
        <section id={sectionId} className="settings-group" aria-labelledby={id} {...props}>
            <h3 id={id} className="group-title">
                {title}
            </h3>
            <div className="group-card">{children}</div>
        </section>
    );
};

// 켜고 끄는 줄: 제목과 설명, 오른쪽에 스위치. extra는 설명 아래에 더 붙이는 줄이다.
const SwitchRow = ({ id, title, note, noteId, extra = null, checked, disabled, onChange, ...props }) => {
    return (
        <label className="row switch-row">
            <span className="row-body">
                <b>{title}</b>
                <small id={noteId}>{note}</small>
                {extra}
            </span>
            <input type="checkbox" id={id} className="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} {...props} />
        </label>
    );
};

// 눌러서 다른 화면을 열거나 동작을 하는 줄.
const NavRow = ({ danger = false, className = "", ...props }) => {
    return <button type="button" className={cx("row nav-row", danger && "danger", className)} {...props} />;
};

export { SettingsGroup, SwitchRow, NavRow };
