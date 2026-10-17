import { useRunStore } from "../stores/runStore.js";
import { useTabsStore } from "../stores/tabsStore.js";

// 보고 있는 탭뿐 아니라 어느 탭이든 실행 중인지. 계정 추가·제거·데이터 폴더 변경과 설정 덮어쓰기처럼 모든 탭에 걸친 일을 잠글 때 쓴다.
const useAnyRunning = () => {
    const isViewedRunning = useRunStore((store) => store.state.status !== "idle");
    const isOtherRunning = useTabsStore((store) => store.tabs.some((tab) => tab.status !== "idle"));

    return isViewedRunning || isOtherRunning;
};

export { useAnyRunning };
