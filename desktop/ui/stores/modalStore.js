import { create } from "zustand";

// 확인 모달은 한 번에 하나만 뜬다. 닫는 전환 동안 내용이 남도록 request는 닫아도 지우지 않는다.
const useModalStore = create(() => ({ open: false, request: null }));

const modal = {
    // options: { title, message, confirmLabel, cancelLabel, tone("danger"면 취소에 먼저 포커스) }. 확인이면 true, 취소·Esc·바깥 클릭이면 false로 풀린다.
    confirm: (options) => {
        return new Promise((resolve) => {
            useModalStore.getState().request?.resolve(false);
            useModalStore.setState({ open: true, request: { ...options, resolve: resolve } });
        });
    },
    answer: (isConfirmed) => {
        useModalStore.getState().request?.resolve(isConfirmed);
        useModalStore.setState({ open: false });
    }
};

export { useModalStore, modal };
