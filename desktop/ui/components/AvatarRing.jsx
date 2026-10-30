import { getUsageTone } from "../../viewFormat.js";
import { cx } from "../lib/cx.js";
import "./AvatarRing.css";

// 이름 첫 글자 아바타. percent를 주면 둘레 링이 그만큼 차고(70% 이상 주황, 90% 이상 빨강), 없으면 빈 링이다. size는 sm(레일)·lg(프로필 패널)이다.
const AvatarRing = ({ letter, percent = null, size = "sm", className = "", ...props }) => {
    const tone = percent === null ? undefined : getUsageTone(percent);

    return (
        <span className={cx("avatar-ring", size, className)} data-tone={tone} style={{ "--value": String(percent ?? 0) }} {...props}>
            <span className="avatar-letter">{letter}</span>
        </span>
    );
};

export { AvatarRing };
