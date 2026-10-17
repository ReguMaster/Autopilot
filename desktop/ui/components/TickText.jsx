import { useReplayOnChange } from "../hooks/useReplay.js";

// 값이 바뀌면 바뀐 방향(up·down)에서 미끄러져 들어온다.
const TickText = ({ as: Tag = "span", value, direction = "up", ...props }) => {
    const ref = useReplayOnChange(value, `tick-${direction}`);

    return (
        <Tag ref={ref} {...props}>
            {value}
        </Tag>
    );
};

export { TickText };
