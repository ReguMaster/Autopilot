import { useReplayOnChange } from "../hooks/useReplay.js";

// 문구가 바뀔 때만 새 문구가 맺히는 전환(swap)을 다시 건다.
const SwapText = ({ as: Tag = "span", value, ...props }) => {
    const ref = useReplayOnChange(value, "swap");

    return (
        <Tag ref={ref} {...props}>
            {value}
        </Tag>
    );
};

export { SwapText };
