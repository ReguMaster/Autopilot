import { useEffect, useState } from "react";
import { readPhaseDoc } from "../../actions/run.js";
import { STATUS_OK } from "../../lib/constants.js";
import { useAppStore } from "../../stores/appStore.js";

// 단계 산출물 · 다른 AI의 안 · 검토 문서를 메인이 정해진 위치에서 읽어 온다. 보는 프로젝트가 바뀌면 다시 읽는다.
const usePhaseDoc = (key) => {
    const projectDir = useAppStore((store) => store.settings.projectDir);
    const [doc, setDoc] = useState({ isLoading: true, data: null });

    useEffect(() => {
        let isCurrent = true;

        setDoc({ isLoading: true, data: null });
        readPhaseDoc(key).then((result) => {
            if (isCurrent) {
                setDoc({ isLoading: false, data: result.status === STATUS_OK ? result.data : null });
            }
        });

        return () => {
            isCurrent = false;
        };
    }, [key, projectDir]);

    return doc;
};

export { usePhaseDoc };
