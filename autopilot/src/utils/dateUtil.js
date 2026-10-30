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

// HH:mm만 주면 다음에 오는 그 시각(이미 지났으면 다음 날)이고, yyyy-MM-dd HH:mm이면 그 날짜의 시각이다.
// 없는 날짜(2월 30일 등)는 Date가 다음 달로 넘기므로 null을 돌려 호출한 쪽이 거부하게 한다.
const getDeadline = (endTime, now = new Date()) => {
    const [datePart, timePart] = endTime.includes(" ") ? endTime.split(" ") : ["", endTime];
    const [hour, minute] = timePart.split(":").map(Number);
    const deadline = new Date(now);

    if (datePart) {
        const [year, month, day] = datePart.split("-").map(Number);

        deadline.setFullYear(year, month - 1, day);

        if (deadline.getMonth() !== month - 1 || deadline.getDate() !== day) {
            return null;
        }
    }

    deadline.setHours(hour, minute, 0, 0);

    if (!datePart && deadline <= now) {
        deadline.setDate(deadline.getDate() + 1);
    }

    return deadline;
};

export default { padNumber, getDateString, getTimeString, getDatetimeString, getMinutesFromMs, getDeadline };
