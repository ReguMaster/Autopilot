import fs from "node:fs";
import { MINUTE_MS } from "./config.js";
import dateUtil from "./dateUtil.js";
import fileUtil from "./fileUtil.js";
import gitUtil from "./gitUtil.js";
import util from "./util.js";

const { escapeHtml } = util;

const LIVE_RELOAD_SCRIPT = `<script>setTimeout(function r(){document.querySelector("details[open]")?setTimeout(r,3e4):location.reload()},3e4)</script>`;

const REPORT_STYLE = `
:root{color-scheme:light dark}
body{margin:0;background:light-dark(#f7f7f5,#161618);color:light-dark(#1d1d1f,#ececee);font:14px/1.55 system-ui,sans-serif}
main{max-width:880px;margin:auto;padding:32px 16px 64px;overflow-wrap:anywhere}
h1{font-size:20px}
h2{font-size:15px}
.box{background:light-dark(#fff,#1f1f22);border:1px solid light-dark(#e2e2de,#303035);border-radius:8px;padding:12px 14px;margin:10px 0}
.bad{border-color:#b3261e}
.meta{color:light-dark(#6b6b70,#9a9aa2);font-size:12px}
.tiles{display:flex;flex-wrap:wrap;gap:10px}
.tiles .box{flex:1}
.tiles b{display:block;font-size:22px}
pre{white-space:pre-wrap;word-break:break-word}
summary{cursor:pointer}
`;

const RECENT_LOG_LINES = 15;

const getDetailsHtml = (title, text) => {
    return `<details><summary>${title}</summary><pre>${escapeHtml(text)}</pre></details>`;
};

const getCommitItemHtml = (commitInfo) => {
    return `<li><code>${escapeHtml(commitInfo.hash)}</code> ${escapeHtml(commitInfo.subject)} <span class="meta">${escapeHtml(commitInfo.stat)}</span></li>`;
};

const getRoundCardHtml = (roundInfo) => {
    const meta = `${dateUtil.getTimeString(roundInfo.start)} · ${roundInfo.minutes}분 · ${roundInfo.turns ?? 0}턴 · $${util.formatCost(roundInfo.cost)} · ${roundInfo.model} ${roundInfo.effort}`;
    const commitItems = roundInfo.commits.map(getCommitItemHtml).join("");
    const sessionHtml = roundInfo.session ? `<p class="meta">claude --resume ${escapeHtml(roundInfo.session)}</p>` : "";
    const summaryHtml = roundInfo.summary ? getDetailsHtml("세션 요약", roundInfo.summary) : "";
    const stderrHtml = roundInfo.stderr ? getDetailsHtml("stderr", roundInfo.stderr) : "";

    return `<section class="box"><b>${roundInfo.round}회차 · ${escapeHtml(roundInfo.outcome)}</b><p class="meta">${meta}</p><ul>${commitItems}</ul>${sessionHtml}${summaryHtml}${stderrHtml}</section>`;
};

const getSummaryTilesHtml = (runState) => {
    const commitCount = runState.rounds.reduce((sum, roundInfo) => sum + roundInfo.commits.length, 0);
    const totalCost = runState.rounds.reduce((sum, roundInfo) => sum + Number(roundInfo.cost || 0), 0);
    const elapsedMinutes = Math.round((Date.now() - runState.runStart) / MINUTE_MS);

    return [
        `<div class="box"><b>${runState.rounds.length}</b>회차</div>`,
        `<div class="box"><b>${commitCount}</b>commit</div>`,
        `<div class="box"><b>${elapsedMinutes}분</b>소요 시간</div>`,
        `<div class="box"><b>$${util.formatCost(totalCost)}</b>비용 (API 환산)</div>`
    ].join("");
};

const getStatusHtml = (runState, status, isLive, hasError) => {
    let guideHtml = "";

    if (isLive) {
        const stopGuide = fs.existsSync(runState.stopFile) ? "중단 요청됨" : "이번 회차 후 중단: autopilot stop";

        guideHtml = `<p class="meta">종료 예정 ${dateUtil.getTimeString(runState.deadline)} · ${stopGuide}</p>`;
    }

    return `<div class="box ${hasError ? "bad" : ""}">${escapeHtml(status)}${guideHtml}</div>`;
};

const getReportHtml = (runState, status, isLive, hasError) => {
    const roundCards = runState.rounds.map(getRoundCardHtml).join("\n");
    const branchName = gitUtil.getBranchName(runState.runGitCommand);
    const header = `${escapeHtml(runState.projectDir)} · ${dateUtil.getDatetimeString(runState.runStart)} → ${dateUtil.getDatetimeString(new Date())} · ${escapeHtml(runState.policy)} · 브랜치 ${escapeHtml(branchName)}`;
    let tailHtml = "";

    // 실행 중에는 git status를 호출하지 않는다.
    if (isLive) {
        const recentLog = fileUtil.readTextFile(runState.logFile).trim().split("\n").slice(-RECENT_LOG_LINES).join("\n");

        tailHtml = recentLog ? `<pre>${escapeHtml(recentLog)}</pre>` : "";
    } else {
        const gitStatus = gitUtil.getShortStatus(runState.runGitCommand);

        tailHtml = `<h2>작업 트리</h2><pre>${escapeHtml(gitStatus || "깨끗합니다.")}</pre>`;
    }

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${isLive ? LIVE_RELOAD_SCRIPT : ""}<meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoPilot 리포트</title><style>${REPORT_STYLE}</style></head><body><main><h1>AutoPilot 리포트</h1><p class="meta">${header}</p>${getStatusHtml(runState, status, isLive, hasError)}<div class="tiles">${getSummaryTilesHtml(runState)}</div><h2>회차</h2>${roundCards || "<p>실행된 회차가 없습니다.</p>"}${tailHtml}<p class="meta">전체 로그: ${escapeHtml(runState.logFile)}</p></main></body></html>`;
};

// 실행 중 갱신(isLive)은 실패해도 무시하고, 종료 리포트는 실패를 알린다.
const writeRunReport = (runState, status, isLive, hasError = false) => {
    try {
        fs.writeFileSync(runState.reportFile, getReportHtml(runState, status, isLive, hasError), "utf8");
    } catch (error) {
        if (!isLive) {
            throw error;
        }
    }
};

export default { writeRunReport };
