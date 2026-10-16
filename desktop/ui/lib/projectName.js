const getProjectName = (projectDir) => {
    return projectDir ? projectDir.split(/[\\/]/).filter(Boolean).pop() : "";
};

// 탭에 보일 이름. 폴더 이름이 같은 탭이 둘 이상이면 상위 폴더까지 붙여 구분한다.
const getTabLabels = (tabs) => {
    const counts = new Map();

    tabs.forEach((tab) => counts.set(tab.name, (counts.get(tab.name) ?? 0) + 1));

    return tabs.map((tab) => (counts.get(tab.name) > 1 ? tab.projectDir.split(/[\\/]/).filter(Boolean).slice(-2).join("/") : tab.name));
};

export { getProjectName, getTabLabels };
