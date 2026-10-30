// 단계가 높을수록 두 마루의 진폭이 커지는 물결. 노력·추론 알약과 슬라이드가 같은 모양을 쓴다. Codex 설정을 따르면 점선이다.
const getWavePath = (level) => `M-7 8q2-${(1 + level * 1.7).toFixed(1)} 4 0${"t4 0".repeat(8)}`;

const Wave = ({ level, isAuto = false }) => {
    return (
        <svg className={isAuto ? "wave is-auto" : "wave"} viewBox="0 0 18 16" aria-hidden="true">
            <path style={{ d: `path("${getWavePath(level)}")` }} />
        </svg>
    );
};

export { Wave, getWavePath };
