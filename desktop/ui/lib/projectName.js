const getProjectName = (projectDir) => {
    return projectDir ? projectDir.split(/[\\/]/).filter(Boolean).pop() : "";
};

export { getProjectName };
