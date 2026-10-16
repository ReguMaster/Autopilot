import { create } from "zustand";
import { shareStructure } from "../lib/shareStructure.js";

// 열린 탭(프로젝트)과 각 탭의 실행 상태, 보고 있는 탭. 메인이 상태가 바뀔 때마다 보내 준다.
const useTabsStore = create(() => ({ tabs: [], active: "" }));

const applyTabs = ({ tabs, active }) => {
    useTabsStore.setState((current) => ({ tabs: shareStructure(current.tabs, tabs), active: active }));
};

export { useTabsStore, applyTabs };
