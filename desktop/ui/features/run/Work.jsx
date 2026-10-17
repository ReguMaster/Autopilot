import { useShallow } from "zustand/react/shallow";
import { getWorkSummary } from "../../../viewFormat.js";
import { SwapText } from "../../components/SwapText.jsx";
import { useRunStore } from "../../stores/runStore.js";

// 이번 실행에서 한 일: 숫자가 바뀔 때만 새 숫자가 맺힌다.
const Work = () => {
    const { rounds, work } = useRunStore(useShallow((store) => ({ rounds: store.state.rounds, work: store.state.work })));
    const summary = getWorkSummary({ rounds: rounds, work: work });

    return (
        <dl className="work" aria-label="이번 실행에서 한 일">
            <div>
                <dd>
                    <SwapText as="b" id="work-tools" className="num" value={String(summary.toolCalls)} />
                    <small>번</small>
                </dd>
                <dt>부른 도구</dt>
            </div>
            <div>
                <dd>
                    <SwapText as="b" id="work-read" className="num" value={String(summary.filesRead)} />
                    <small>개</small>
                </dd>
                <dt>읽어 본 파일</dt>
            </div>
            <div>
                <dd>
                    <SwapText as="b" id="work-edited" className="num" value={String(summary.filesEdited)} />
                    <small>개</small>
                </dd>
                <dt>고친 파일</dt>
            </div>
            <div>
                <dd>
                    <SwapText as="ins" id="work-insertions" className="num" value={`+${summary.insertions}`} />
                    <SwapText as="del" id="work-deletions" className="num" value={`−${summary.deletions}`} />
                </dd>
                <dt id="work-commits">{`남긴 커밋 ${summary.commits}개`}</dt>
            </div>
        </dl>
    );
};

export { Work };
