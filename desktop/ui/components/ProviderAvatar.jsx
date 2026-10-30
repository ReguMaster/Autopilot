import "./ProviderAvatar.css";

// 협의 참가자의 프로필: Claude는 마크, Codex는 터미널 프롬프트(>_). 이름은 옆에 따로 적으므로 장식으로만 둔다.
// size: md(말풍선 옆) · sm(머리말) · xs(지난 실행 대화)
const MARKS = {
    claude: <use href="#mark-claude" />,
    codex: <path className="avatar-prompt" d="m5.5 7.5 4.5 4.5-4.5 4.5M12.5 16.5H18.5" />
};

const ProviderAvatar = ({ provider, size = "md" }) => {
    return (
        <span className="avatar" data-provider={provider} data-size={size} aria-hidden="true">
            <svg viewBox="0 0 24 24">{MARKS[provider]}</svg>
        </span>
    );
};

export { ProviderAvatar };
