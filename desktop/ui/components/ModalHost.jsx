import { useEffect, useState } from "react";
import { modal, useModalStore } from "../stores/modalStore.js";
import { Button } from "./Button.jsx";
import { Modal } from "./Modal.jsx";

// modal.confirm()이 올린 요청을 그리는 자리. App에 하나만 둔다. 되돌릴 수 없는 일(tone: "danger")은 안전한 쪽인 취소에 먼저 포커스를 둔다.
const ModalHost = () => {
    const { open, request } = useModalStore();
    const { title = "", message = "", confirmLabel = "확인", cancelLabel = "취소", tone = "", choices = [] } = request ?? {};
    const [choice, setChoice] = useState("");
    const isDanger = tone === "danger";
    const cancel = () => modal.answer(false);

    useEffect(() => {
        setChoice(request?.choices?.[0]?.value ?? "");
    }, [request]);

    return (
        <Modal
            open={open}
            title={title}
            role="alertdialog"
            onClose={cancel}
            footer={
                <>
                    <Button size="" data-autofocus={isDanger ? "" : undefined} onClick={cancel}>
                        {cancelLabel}
                    </Button>
                    <Button size="" variant={isDanger ? "danger" : "primary"} data-autofocus={isDanger ? undefined : ""} onClick={() => modal.answer(true, choices.length ? choice : undefined)}>
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            {message}
            {choices.length ? (
                <div className="modal-choices" role="radiogroup" aria-label={title}>
                    {choices.map((item) => (
                        <label key={item.value} className="modal-choice">
                            <input type="radio" name="modal-choice" value={item.value} checked={choice === item.value} onChange={() => setChoice(item.value)} />
                            <span className="modal-choice-text">
                                <b>{item.label}</b>
                                <small>{item.description}</small>
                            </span>
                        </label>
                    ))}
                </div>
            ) : null}
        </Modal>
    );
};

export { ModalHost };
