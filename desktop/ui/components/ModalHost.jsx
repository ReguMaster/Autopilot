import { modal, useModalStore } from "../stores/modalStore.js";
import { Button } from "./Button.jsx";
import { Modal } from "./Modal.jsx";

// modal.confirm()이 올린 요청을 그리는 자리. App에 하나만 둔다. 되돌릴 수 없는 일(tone: "danger")은 안전한 쪽인 취소에 먼저 포커스를 둔다.
const ModalHost = () => {
    const { open, request } = useModalStore();
    const { title = "", message = "", confirmLabel = "확인", cancelLabel = "취소", tone = "" } = request ?? {};
    const isDanger = tone === "danger";
    const cancel = () => modal.answer(false);

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
                    <Button size="" variant={isDanger ? "danger" : "primary"} data-autofocus={isDanger ? undefined : ""} onClick={() => modal.answer(true)}>
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            {message}
        </Modal>
    );
};

export { ModalHost };
