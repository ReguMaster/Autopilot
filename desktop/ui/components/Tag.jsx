// 결과·상태를 짧게 보여주는 알약. tone은 ok·warn·danger·run·muted다.
const Tag = ({ tone, children }) => {
    return (
        <span className="tag" data-tone={tone}>
            {children}
        </span>
    );
};

export { Tag };
