import { useEffect, useState } from "react";
import { STATUS_OK } from "../lib/constants.js";

const LOADING_NOTE = "버전 목록을 불러오는 중이에요.";
const FAILED_NOTE = "버전 목록을 불러오지 못했어요. 로그인 상태를 확인해 주세요.";

// 공식 모델 목록([{ id, line, createdAt }], 최신순). 패널이나 팝오버를 열 때마다 읽는다. 목록은 메인이 보관하므로 다시 읽어도 가볍다. 읽는 중에는 null, 못 읽으면 빈 배열이다.
const useModels = (isOpen) => {
    const [models, setModels] = useState(null);

    useEffect(() => {
        if (models !== null && !isOpen) {
            return undefined;
        }

        let isCancelled = false;

        window.autopilot.getModels().then((result) => {
            if (!isCancelled) {
                setModels(result.status === STATUS_OK ? result.data.models : []);
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [isOpen]);

    return models;
};

const getModelsNote = (models) => {
    if (models === null) {
        return LOADING_NOTE;
    }

    return models.length === 0 ? FAILED_NOTE : "";
};

export { useModels, getModelsNote };
