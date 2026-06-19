const TARGET_SELECTOR =
  "#time-card-accordion-02 > div > div > table > tbody > tr > td:nth-child(7) > span";
const PANEL_ID = "atnd-attendance-helper-panel";
const PANEL_POSITION_KEY = "panelPosition";

const DRAG_HANDLE_ICON = `
  <svg viewBox="0 0 40 12" width="40" height="12" aria-hidden="true">
    <circle cx="5" cy="3" r="1.2" fill="currentColor"></circle>
    <circle cx="15" cy="3" r="1.2" fill="currentColor"></circle>
    <circle cx="25" cy="3" r="1.2" fill="currentColor"></circle>
    <circle cx="35" cy="3" r="1.2" fill="currentColor"></circle>
    <circle cx="5" cy="9" r="1.2" fill="currentColor"></circle>
    <circle cx="15" cy="9" r="1.2" fill="currentColor"></circle>
    <circle cx="25" cy="9" r="1.2" fill="currentColor"></circle>
    <circle cx="35" cy="9" r="1.2" fill="currentColor"></circle>
  </svg>
`;
const MAX_WAIT_MS = 30000;
const POLL_INTERVAL_MS = 500;

function parseHoursMinutes(text) {
  const match = text.trim().match(/^(\d+):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes >= 60) {
    return null;
  }

  return hours + minutes / 60;
}

function formatHoursMinutes(totalHours) {
  const totalMinutes = Math.round(totalHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatDecimalHours(totalHours) {
  return totalHours.toFixed(2);
}

function getJstDateIdSuffix() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/-/g, "");
}

function getTodayWorkingReportId() {
  return `working_report_${getJstDateIdSuffix()}`;
}

function getTodayWorkingReportSpan() {
  const reportId = getTodayWorkingReportId();
  const xpath = `//*[@id="${reportId}"]/td[3]/div/span[2]`;
  const xpathResult = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  ).singleNodeValue;

  if (xpathResult instanceof Element) {
    return xpathResult;
  }

  const row = document.getElementById(reportId);
  if (!row) {
    return null;
  }

  const selectors = [
    "td:nth-child(3) > div > span:nth-of-type(2)",
    "td:nth-child(3) div > span:nth-of-type(2)",
    "td:nth-of-type(3) > div > span:nth-of-type(2)",
  ];

  for (const selector of selectors) {
    const span = row.querySelector(selector);
    if (span) {
      return span;
    }
  }

  return null;
}

function normalizeReportText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/[−－—–‐‑‒⁻]/g, "-");
}

function isTodayUnreported(text) {
  const normalized = normalizeReportText(text);
  if (!normalized || normalized === "--:--" || normalized === "-:-") {
    return true;
  }

  return !/[0-9０-９]/.test(normalized);
}

function getTodayAttendanceStatus() {
  const span = getTodayWorkingReportSpan();
  if (!span) {
    return {
      includeToday: true,
      rawText: null,
      found: false,
      reportId: getTodayWorkingReportId(),
    };
  }

  const rawText = span.textContent.trim();
  const includeToday = isTodayUnreported(rawText);

  return {
    includeToday,
    rawText,
    found: true,
    reportId: getTodayWorkingReportId(),
  };
}

function getSubstituteDates() {
  const substituteWorkDates = [];
  const substituteHolidayDates = [];

  for (const row of document.querySelectorAll("tr[data-date]")) {
    const date = row.dataset.date;
    if (!date) continue;

    const statusCell = row.querySelector("td:nth-child(4)");
    if (!statusCell) continue;

    const text = statusCell.textContent.trim();
    if (text === "振替出勤") {
      substituteWorkDates.push(date);
    } else if (text === "振替休日") {
      substituteHolidayDates.push(date);
    }
  }

  return { substituteWorkDates, substituteHolidayDates };
}

function createPanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) {
    return panel;
  }

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="atnd-helper-header">
      <div
        class="atnd-helper-drag-handle"
        data-action="drag-handle"
        title="ドラッグで移動"
        aria-label="パネルをドラッグで移動"
      >
        ${DRAG_HANDLE_ICON}
      </div>
    </div>
    <div class="atnd-helper-body">
      <div class="atnd-helper-row">
        <span class="atnd-helper-label">残り月間所定不足時間</span>
        <span class="atnd-helper-value" data-field="leftover">-</span>
      </div>
      <div class="atnd-helper-row">
        <span class="atnd-helper-label">残り平日</span>
        <span class="atnd-helper-value" data-field="weekdays">-</span>
      </div>
      <div class="atnd-helper-row atnd-helper-result">
        <span class="atnd-helper-label">1日あたり</span>
        <span class="atnd-helper-value" data-field="daily">-</span>
      </div>
      <div class="atnd-helper-note" data-field="note"></div>
    </div>
  `;

  document.body.appendChild(panel);
  setupPanelDrag(panel);
  loadPanelPosition(panel);
  return panel;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyPanelPosition(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  const clampedLeft = clamp(left, 8, Math.max(8, maxLeft));
  const clampedTop = clamp(top, 8, Math.max(8, maxTop));

  panel.style.left = `${clampedLeft}px`;
  panel.style.top = `${clampedTop}px`;
  panel.style.right = "auto";

  return { left: clampedLeft, top: clampedTop };
}

function getDefaultPanelPosition(panel) {
  panel.style.left = "auto";
  panel.style.right = "16px";
  panel.style.top = "16px";
  const rect = panel.getBoundingClientRect();
  return { left: window.innerWidth - rect.width - 16, top: 16 };
}

function savePanelPosition(panel) {
  const rect = panel.getBoundingClientRect();
  chrome.storage.local.set({
    [PANEL_POSITION_KEY]: { left: rect.left, top: rect.top },
  });
}

function loadPanelPosition(panel) {
  chrome.storage.local.get(PANEL_POSITION_KEY, (result) => {
    const saved = result[PANEL_POSITION_KEY];
    if (
      saved &&
      typeof saved.left === "number" &&
      typeof saved.top === "number"
    ) {
      applyPanelPosition(panel, saved.left, saved.top);
      return;
    }

    const defaultPosition = getDefaultPanelPosition(panel);
    applyPanelPosition(panel, defaultPosition.left, defaultPosition.top);
  });
}

function setupPanelDrag(panel) {
  const handle = panel.querySelector('[data-action="drag-handle"]');
  if (!(handle instanceof HTMLElement)) {
    return;
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }

    dragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.classList.add("atnd-helper-dragging");
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    applyPanelPosition(panel, event.clientX - offsetX, event.clientY - offsetY);
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    panel.classList.remove("atnd-helper-dragging");
    savePanelPosition(panel);
  });

  window.addEventListener(
    "resize",
    debounce(() => {
      const rect = panel.getBoundingClientRect();
      applyPanelPosition(panel, rect.left, rect.top);
      savePanelPosition(panel);
    }, 100),
  );
}

function setPanelState(panel, state) {
  panel.querySelector('[data-field="leftover"]').textContent = state.leftover ?? "-";
  panel.querySelector('[data-field="weekdays"]').textContent =
    state.weekdays != null ? `${state.weekdays}日` : "-";
  panel.querySelector('[data-field="daily"]').textContent = state.daily ?? "-";
  panel.querySelector('[data-field="note"]').textContent = state.note ?? "";
  panel.dataset.status = state.status ?? "loading";
}

function waitForElement(selector, timeoutMs) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const startedAt = Date.now();
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        clearInterval(timerId);
        resolve(element);
      } else if (Date.now() - startedAt >= timeoutMs) {
        observer.disconnect();
        clearInterval(timerId);
        reject(new Error("月間所定不足時間の要素が見つかりませんでした"));
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timerId = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        clearInterval(timerId);
        resolve(element);
      } else if (Date.now() - startedAt >= timeoutMs) {
        observer.disconnect();
        clearInterval(timerId);
        reject(new Error("月間所定不足時間の要素が見つかりませんでした"));
      }
    }, POLL_INTERVAL_MS);
  });
}

function getRemainingWeekdays(includeToday, substituteWorkDates, substituteHolidayDates) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GET_REMAINING_WEEKDAYS", includeToday, substituteWorkDates, substituteHolidayDates },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error ?? "残り平日の取得に失敗しました"));
          return;
        }
        resolve(response);
      },
    );
  });
}

async function updatePanel(panel, leftoverWorkHoursText) {
  const leftoverWorkHours = parseHoursMinutes(leftoverWorkHoursText);
  if (leftoverWorkHours == null) {
    setPanelState(panel, {
      status: "error",
      leftover: leftoverWorkHoursText || "-",
      note: "月間所定不足時間の形式を読み取れませんでした（HH:MM形式を想定）",
    });
    return;
  }

  setPanelState(panel, {
    status: "loading",
    leftover: leftoverWorkHoursText,
    note: "残り平日を計算中...",
  });

  try {
    const attendanceStatus = getTodayAttendanceStatus();
    const { includeToday, found } = attendanceStatus;
    const { substituteWorkDates, substituteHolidayDates } = getSubstituteDates();
    const { remainingWeekdays } = await getRemainingWeekdays(includeToday, substituteWorkDates, substituteHolidayDates);

    const attendanceLabel = !found
      ? "勤怠情報が見つからないため今日を含めて計算"
      : includeToday
        ? "今日（未退勤打刻）"
        : "今日（退勤打刻済み）";
    const weekdayNote = includeToday
      ? `${attendanceLabel} / 今月末までの平日（祝日除外）`
      : `${attendanceLabel} / 明日以降の平日（祝日除外）`;

    if (remainingWeekdays === 0) {
      setPanelState(panel, {
        status: "ready",
        leftover: leftoverWorkHoursText,
        weekdays: 0,
        daily: "-",
        note: "今月の残り平日がありません",
      });
      return;
    }

    const dailyHours = leftoverWorkHours / remainingWeekdays;
    const dailyCompact = formatHoursMinutes(dailyHours);
    setPanelState(panel, {
      status: "ready",
      leftover: leftoverWorkHoursText,
      weekdays: remainingWeekdays,
      daily: `${dailyCompact} (${formatDecimalHours(dailyHours)}h)`,
      note: weekdayNote,
    });
  } catch (error) {
    setPanelState(panel, {
      status: "error",
      leftover: leftoverWorkHoursText,
      note: error instanceof Error ? error.message : "計算に失敗しました",
    });
  }
}

function debounce(fn, waitMs) {
  let timerId = null;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), waitMs);
  };
}

async function init() {
  const panel = createPanel();
  setPanelState(panel, {
    status: "loading",
    note: "月間所定不足時間を読み込み中...",
  });

  try {
    const [element] = await Promise.all([
      waitForElement(TARGET_SELECTOR, MAX_WAIT_MS),
      waitForElement(`#${getTodayWorkingReportId()}`, MAX_WAIT_MS).catch(() => null),
    ]);

    const render = debounce(() => updatePanel(panel, element.textContent.trim()), 200);
    await render();

    const leftoverObserver = new MutationObserver(render);
    leftoverObserver.observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    const todayRow = document.getElementById(getTodayWorkingReportId());
    if (todayRow) {
      const todayObserver = new MutationObserver(render);
      todayObserver.observe(todayRow, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  } catch (error) {
    setPanelState(panel, {
      status: "error",
      note: error instanceof Error ? error.message : "初期化に失敗しました",
    });
  }
}

init();
