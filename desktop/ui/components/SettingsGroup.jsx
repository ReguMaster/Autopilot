import { cx } from "../lib/cx.js";
import { Select } from "./Select.jsx";
import { Stepper } from "./Stepper.jsx";

// 설정 페이지의 묶음: 제목(과 한 줄 설명)과 카드.
const SettingsGroup = ({ id, sectionId, title, note = "", children, ...props }) => {
    return (
        <section id={sectionId} className="settings-group" aria-labelledby={id} {...props}>
            <h3 id={id} className="group-title">
                {title}
            </h3>
            {note ? <p className="group-note">{note}</p> : null}
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

// 고르는 줄: 제목과 설명, 오른쪽에 선택 상자. 나머지 props는 Select로 넘어간다.
const SelectRow = ({ labelId, title, note = "", noteId, extra = null, ...props }) => {
    return (
        <div className="row version-row">
            <span className="row-body">
                <b id={labelId}>{title}</b>
                {note ? <small id={noteId}>{note}</small> : null}
                {extra}
            </span>
            <Select labelId={labelId} {...props} />
        </div>
    );
};

// 횟수를 정하는 줄: 제목과 설명, 오른쪽에 조절기. 나머지 props는 Stepper로 넘어간다.
const StepperRow = ({ labelId, title, note = "", extra = null, ...props }) => {
    return (
        <div className="row version-row">
            <span className="row-body">
                <b id={labelId}>{title}</b>
                {note ? <small>{note}</small> : null}
                {extra}
            </span>
            <Stepper {...props} />
        </div>
    );
};

// 눌러서 다른 화면을 열거나 동작을 하는 줄.
const NavRow = ({ danger = false, className = "", ...props }) => {
    return <button type="button" className={cx("row nav-row", danger && "danger", className)} {...props} />;
};

export { SettingsGroup, SwitchRow, SelectRow, StepperRow, NavRow };
