import { useLayoutEffect, useRef } from "react";

// 클래스를 뗐다 붙여 CSS 애니메이션을 처음부터 다시 건다.
const replayAnimation = (element, className) => {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
};

// value가 바뀐 그 그림에서만 className 애니메이션을 다시 건다(처음 그릴 때는 걸지 않는다). 돌려주는 ref를 요소에 붙인다.
// 요소의 className prop은 이 클래스를 포함하지 않아야 한다(React가 다시 쓰지 않으므로 클래스가 남는다).
const useReplayOnChange = (value, className) => {
    const ref = useRef(null);
    const previous = useRef(value);

    useLayoutEffect(() => {
        if (previous.current !== value) {
            previous.current = value;

            if (ref.current) {
                replayAnimation(ref.current, className);
            }
        }
    }, [value, className]);

    return ref;
};

export { replayAnimation, useReplayOnChange };
