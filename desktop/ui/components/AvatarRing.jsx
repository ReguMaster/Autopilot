import { getUsageTone } from "../../viewFormat.js";
import { cx } from "../lib/cx.js";
import { ProviderAvatar } from "./ProviderAvatar.jsx";
import "./AvatarRing.css";

// AI 로고가 든 링. percent를 주면 둘레 링이 그만큼 차고(70% 이상 주황, 90% 이상 빨강), 없으면 빈 링이다.
const AvatarRing = ({ provider, percent = null, className = "", ...props }) => {
    const tone = percent === null ? undefined : getUsageTone(percent);

    return (
        <span className={cx("avatar-ring", className)} data-tone={tone} style={{ "--value": String(percent ?? 0) }} {...props}>
            <ProviderAvatar provider={provider} size="xs" />
        </span>
    );
};

export { AvatarRing };
