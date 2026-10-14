import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { boot } from "./boot.js";

// 메인이 보관한 첫 상태를 모두 받은 뒤에 그린다. 그래야 첫 그림부터 제 모양이다.
const start = async () => {
    await boot();

    createRoot(document.getElementById("root")).render(<App />);
};

start();
