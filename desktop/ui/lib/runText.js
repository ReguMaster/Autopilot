// 상태 줄에 쓰는 문구. 옛 renderer.js의 getStatusText·getPhaseText·renderClock이 하던 계산이다.
const EMPTY_CLOCK = "--:--:--";

const getStatusText = (state, phase) => {
    if (state.status === "running" && state.round) {
        return `${state.round}회차 진행 중`;
    }

    if (state.status === "stopping" && state.round) {
        return `${state.round}회차 마무리 중, 종료 요청됨`;
    }

    return phase.label;
};

// 진행 단계 줄은 상태 문구와 겹치면 숨기고, 재시도·사용량 한도·회차 결과처럼 따로 알릴 때만 보인다.
const getPhaseText = (state) => {
    if (state.status === "idle") {
        return state.reason && state.endedAt ? state.reason : "";
    }

    const phase = state.phase === `${state.round}회차 진행 중` ? "" : state.phase;

    if (state.attached) {
        return phase ? `${phase}, 이전에 시작한 엔진에 다시 연결됨` : "이전에 시작한 엔진에 다시 연결됨";
    }

    return phase;
};

export { EMPTY_CLOCK, getStatusText, getPhaseText };
