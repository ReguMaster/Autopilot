import { useMemo } from "react";
import { describeLoginExpiry } from "../../viewFormat.js";
import { EMPTY_ACCOUNT, useAccountStore } from "../stores/accountStore.js";
import { useClock } from "../stores/clock.js";

// 선택한 계정의 로그인 만료 안내. 만료 시각을 모르면 null이고 분이 바뀔 때만 다시 계산한다.
const useLoginExpiry = () => {
    const loginExpiresAt = useAccountStore((store) => (store.snapshots[store.activeId] || EMPTY_ACCOUNT).loginExpiresAt);
    const minute = useClock((now) => Math.floor(now / 60000));

    return useMemo(() => describeLoginExpiry(loginExpiresAt, Date.now()), [loginExpiresAt, minute]);
};

export { useLoginExpiry };
