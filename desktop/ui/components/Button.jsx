import { cx } from "../lib/cx.js";

// 공통 버튼. variant는 primary·danger, size는 small이다(styles.css의 .button 규칙).
const Button = ({ variant = "", size = "small", className = "", type = "button", ...props }) => {
    return <button type={type} className={cx("button", size, variant, className)} {...props} />;
};

export { Button };
