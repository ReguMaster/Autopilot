import { useCallback } from "react";

// 한 요소에 ref를 여러 개 붙인다. 넘기는 ref 객체가 그대로이면 돌려주는 함수도 그대로다.
const useMergedRef = (...refs) => {
    return useCallback((element) => {
        for (const ref of refs) {
            ref.current = element;
        }
    }, refs); // eslint-disable-line react-hooks/exhaustive-deps
};

export { useMergedRef };
