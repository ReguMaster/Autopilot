// Symbols.jsx의 심볼을 가져다 쓰는 아이콘. 크기·색은 클래스(icon·chevron·mark 등)가 정한다.
const Icon = ({ symbol, className = "icon", ...props }) => {
    return (
        <svg className={className} aria-hidden="true" {...props}>
            <use href={`#${symbol}`} />
        </svg>
    );
};

export { Icon };
