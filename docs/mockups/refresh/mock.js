// 시안 공용: 아이콘 스프라이트(앱의 Symbols.jsx와 같은 모양), 화면 테마 토글, 애니메이션 다시 걸기
(() => {
    const SYMBOLS = {
        check: '<path d="M3.5 8.5l3 3 6-6.5" />',
        pause: '<path d="M6 4.5v7M10 4.5v7" />',
        chevron: '<path d="M4 6l4 4 4-4" />',
        plus: '<path d="M8 3.5v9M3.5 8h9" />',
        back: '<path d="M10 3.5 5.5 8l4.5 4.5" />',
        x: '<path d="M4 4l8 8M12 4l-8 8" />',
        folder: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />',
        gear: '<circle cx="8" cy="8" r="2" /><path d="M8 2.5v1.6M8 11.9v1.6M2.5 8h1.6M11.9 8h1.6M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1" />',
        doc: '<path d="M4.5 2.5h5l2.5 2.5v8a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z" /><path d="M9.5 2.5V5H12" />',
        spark: '<path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3z" />'
    };

    const sprite = Object.entries(SYMBOLS)
        .map(([name, body]) => `<symbol id="icon-${name}" viewBox="0 0 16 16">${body}</symbol>`)
        .join("");

    document.body.insertAdjacentHTML("afterbegin", `<svg class="sprite" aria-hidden="true">${sprite}</svg>`);

    window.icon = (name, className = "icon") => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;

    // 애니메이션 클래스를 지웠다가 다시 걸어 처음부터 재생한다.
    window.replay = (element, className = "run") => {
        element.classList.remove(className);
        void element.offsetWidth;
        element.classList.add(className);
    };

    const THEMES = [
        ["", "화면 테마: 시스템"],
        ["light", "화면 테마: 라이트"],
        ["dark", "화면 테마: 다크"]
    ];
    const root = document.documentElement;
    const button = document.getElementById("m-theme");
    let index = 0;

    const readSaved = () => {
        try {
            return localStorage.getItem("mockup-theme") || "";
        } catch {
            return "";
        }
    };

    const apply = () => {
        const [value, label] = THEMES[index];

        if (value) {
            root.setAttribute("data-theme", value);
        } else {
            root.removeAttribute("data-theme");
        }

        if (button) {
            button.textContent = label;
        }

        try {
            localStorage.setItem("mockup-theme", value);
        } catch {
            // 저장하지 못해도 이번 화면에서는 바뀐다.
        }
    };

    index = Math.max(0, THEMES.findIndex(([value]) => value === readSaved()));
    apply();
    button?.addEventListener("click", () => {
        index = (index + 1) % THEMES.length;
        apply();
    });
})();
