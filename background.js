const HOLIDAY_API_BASE = "https://holidays-jp.github.io/api/v1";

async function fetchHolidaysForYear(year) {
  const response = await fetch(`${HOLIDAY_API_BASE}/${year}/date.json`);
  if (!response.ok) {
    throw new Error(`祝日APIの取得に失敗しました (${response.status})`);
  }
  return response.json();
}

function getJstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function countRemainingWeekdays(holidays, year, month, day, includeToday, substituteWorkDates = [], substituteHolidayDates = []) {
  const substituteWorkSet = new Set(substituteWorkDates);
  const substituteHolidaySet = new Set(substituteHolidayDates);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = includeToday ? day : day + 1;
  let count = 0;

  for (let currentDay = startDay; currentDay <= lastDay; currentDay += 1) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(currentDay).padStart(2, "0")}`;
    const weekday = new Date(`${dateStr}T12:00:00+09:00`).getUTCDay();
    const isNormalWeekday = weekday !== 0 && weekday !== 6 && !holidays[dateStr];

    if (substituteWorkSet.has(dateStr)) {
      count += 1;
    } else if (!substituteHolidaySet.has(dateStr) && isNormalWeekday) {
      count += 1;
    }
  }

  return count;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GET_REMAINING_WEEKDAYS") {
    return false;
  }

  (async () => {
    try {
      const { year, month, day } = getJstDateParts();
      const includeToday = message.includeToday === true;
      const substituteWorkDates = Array.isArray(message.substituteWorkDates) ? message.substituteWorkDates : [];
      const substituteHolidayDates = Array.isArray(message.substituteHolidayDates) ? message.substituteHolidayDates : [];
      const holidays = await fetchHolidaysForYear(year);
      const remainingWeekdays = countRemainingWeekdays(
        holidays,
        year,
        month,
        day,
        includeToday,
        substituteWorkDates,
        substituteHolidayDates,
      );

      sendResponse({ ok: true, remainingWeekdays, includeToday, year, month, day });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "不明なエラー",
      });
    }
  })();

  return true;
});
