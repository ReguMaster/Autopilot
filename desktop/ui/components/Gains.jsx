import { parseGain, splitFigure } from "../../viewFormat.js";

const Figure = ({ className, value }) => {
    const { number, unit } = splitFigure(value);

    return (
        <span className={className}>
            {number}
            <small>{unit}</small>
        </span>
    );
};

// 성과 줄 하나. "이전 → 이후" 형식이면 숫자를 크게 보여주고, 아니면 문장만 보여준다.
const GainItem = ({ gain }) => {
    const parsed = parseGain(gain.text);

    return (
        <li>
            <span className="what">
                {parsed.label}
                <small>{`${gain.round}회차`}</small>
            </span>
            {parsed.after ? (
                <span className="figure num">
                    <Figure className="was" value={parsed.before} />
                    <span className="to">→</span>
                    <Figure className="is" value={parsed.after} />
                </span>
            ) : null}
        </li>
    );
};

const Gains = ({ gains, ...props }) => {
    return (
        <ul className="gains" {...props}>
            {gains.map((gain, index) => (
                <GainItem key={`${gain.round}:${index}:${gain.text}`} gain={gain} />
            ))}
        </ul>
    );
};

export { Gains };
