import { useEffect, useLayoutEffect, useRef } from "react";

const CHIP_RESIZE_MS = 320;
const CHIP_RESIZE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const isWidthAnimation = (animation) => animation.effect.getKeyframes().some((keyframe) => "width" in keyframe);

// 글자 길이로 알약 너비가 바뀌면 뒤의 알약이 튀지 않고 함께 미끄러지도록 너비를 이어 준다.
// 출발 너비는 바뀌기 직전에 실제로 보이던 너비다. 전환 중에 또 바뀌어도 이어지도록 ResizeObserver가 매 프레임 너비를 기억한다.
// signature가 바뀐 그 그림에서만 건다(처음 그릴 때는 걸지 않는다). 돌려주는 ref를 알약에 붙인다.
const useWidthTween = (signature) => {
    const ref = useRef(null);
    const widthRef = useRef(0);
    const previous = useRef(signature);

    useEffect(() => {
        const element = ref.current;
        const observer = new ResizeObserver(() => {
            widthRef.current = element.getBoundingClientRect().width;
        });

        widthRef.current = element.getBoundingClientRect().width;
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        if (previous.current === signature) {
            return;
        }

        previous.current = signature;

        const element = ref.current;
        const fromWidth = widthRef.current;

        element
            .getAnimations()
            .filter(isWidthAnimation)
            .forEach((animation) => animation.cancel());

        const toWidth = element.getBoundingClientRect().width;

        widthRef.current = toWidth;

        if (!matchMedia("(prefers-reduced-motion: reduce)").matches && fromWidth && Math.abs(toWidth - fromWidth) >= 1) {
            element.animate([{ width: `${fromWidth}px` }, { width: `${toWidth}px` }], { duration: CHIP_RESIZE_MS, easing: CHIP_RESIZE_EASING });
        }
    }, [signature]);

    return ref;
};

export { useWidthTween };
