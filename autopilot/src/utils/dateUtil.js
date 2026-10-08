const padNumber = (number) => {
    return String(number).padStart(2, "0");
};

const getDateString = (dateTime) => {
    return `${dateTime.getFullYear()}-${padNumber(dateTime.getMonth() + 1)}-${padNumber(dateTime.getDate())}`;
};

const getTimeString = (dateTime) => {
    return `${padNumber(dateTime.getHours())}:${padNumber(dateTime.getMinutes())}:${padNumber(dateTime.getSeconds())}`;
};

const getDatetimeString = (dateTime) => {
    return `${getDateString(dateTime)} ${getTimeString(dateTime)}`;
};

// 소수 첫째 자리까지 반올림한 분 단위
const getMinutesFromMs = (ms) => {
    return Math.round(ms / 6000) / 10;
};

// 날짜는 의도적으로 무시한다. 이미 지난 시각이면 다음 날로 본다.
const getDeadline = (endTime, now = new Date()) => {
    const [hour, minute] = endTime.split(":").map(Number);
    const deadline = new Date(now);

    deadline.setHours(hour, minute, 0, 0);

    if (deadline <= now) {
        deadline.setDate(deadline.getDate() + 1);
    }

    return deadline;
};

export default { padNumber, getDateString, getTimeString, getDatetimeString, getMinutesFromMs, getDeadline };
