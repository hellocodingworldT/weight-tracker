// 몸무게 기록 앱 - 화면 동작과 구글 시트 연결

const STORAGE_CONFIG = 'wt.config';   // { url, key }
const STORAGE_RECORDS = 'wt.records'; // 마지막으로 시트에서 받은 기록 (빠른 표시용)
const MIN_WEIGHT = 20;
const MAX_WEIGHT = 300;

let records = loadJSON(STORAGE_RECORDS, []);

// ---------------------------------------------------------------- 저장소 도우미

function loadJSON(name, fallback) {
  try {
    const text = localStorage.getItem(name);
    return text ? JSON.parse(text) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJSON(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch (err) {
    // 저장 공간을 못 쓰는 환경이어도 앱은 계속 동작한다.
  }
}

function getConfig() {
  return loadJSON(STORAGE_CONFIG, null);
}

// ---------------------------------------------------------------- 구글 시트 연결

async function fetchRecords(config = getConfig()) {
  const url = config.url + '?key=' + encodeURIComponent(config.key);
  const res = await fetch(url);
  return handleResponse(res);
}

async function sendAction(body) {
  const config = getConfig();
  // text/plain으로 보내야 Apps Script가 CORS 오류 없이 받는다.
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: config.key }),
  });
  return handleResponse(res);
}

async function handleResponse(res) {
  if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '알 수 없는 오류');
  records = data.records;
  saveJSON(STORAGE_RECORDS, records);
  return records;
}

// ---------------------------------------------------------------- 화면 전환

const TITLES = { record: '기록', graph: '그래프', list: '기록 목록', settings: '설정' };

function showView(name) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  document.getElementById('view-title').textContent = TITLES[name];
  if (name === 'graph') renderGraph();
}

document.querySelectorAll('.tabbar button').forEach(b => {
  b.addEventListener('click', () => showView(b.dataset.view));
});
document.getElementById('btn-settings').addEventListener('click', () => showView('settings'));

// ---------------------------------------------------------------- 기록 화면

const dateInput = document.getElementById('input-date');
const weightInput = document.getElementById('input-weight');
const saveButton = document.getElementById('btn-save');
const recordMessage = document.getElementById('record-message');
const overwriteNote = document.getElementById('overwrite-note');

// toISOString()은 UTC 기준이라 한국 시간 새벽에 전날 날짜가 나온다. 폰의 현지 날짜로 만든다.
function todayString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function setMessage(el, text, type) {
  el.textContent = text;
  el.className = 'message' + (type ? ' ' + type : '');
}

function updateOverwriteNote() {
  const existing = records.find(r => r.date === dateInput.value);
  overwriteNote.hidden = !existing;
  if (existing) {
    overwriteNote.textContent = '이 날짜에 ' + existing.weight + 'kg 기록이 있어요. 저장하면 새 값으로 바뀝니다.';
  }
}

function renderSummary() {
  const latestEl = document.getElementById('summary-latest');
  const changeEl = document.getElementById('summary-change');
  if (records.length === 0) {
    latestEl.textContent = '-';
    changeEl.textContent = '-';
    return;
  }
  const first = records[0];
  const last = records[records.length - 1];
  const diff = Math.round((last.weight - first.weight) * 10) / 10;
  latestEl.textContent = last.weight + ' kg';
  changeEl.textContent = (diff > 0 ? '+' : '') + diff + ' kg';
}

function render() {
  renderSummary();
  updateOverwriteNote();
  renderList();
  // 숨겨진 화면에서는 캔버스 크기가 0이라 그래프를 그리지 않는다. 탭을 열 때 그린다.
  if (!document.getElementById('view-graph').hidden) renderGraph();
}

dateInput.addEventListener('change', updateOverwriteNote);

document.getElementById('record-form').addEventListener('submit', async e => {
  e.preventDefault();

  const date = dateInput.value;
  const weight = Number(weightInput.value);
  if (!date) {
    setMessage(recordMessage, '날짜를 골라 주세요.', 'error');
    return;
  }
  if (date > todayString()) {
    setMessage(recordMessage, '미래 날짜는 기록할 수 없어요.', 'error');
    return;
  }
  if (!weightInput.value || !(weight >= MIN_WEIGHT && weight <= MAX_WEIGHT)) {
    setMessage(recordMessage, '몸무게는 ' + MIN_WEIGHT + '~' + MAX_WEIGHT + 'kg 사이로 입력해 주세요.', 'error');
    return;
  }
  if (!getConfig()) {
    showView('settings');
    setMessage(settingsMessage, '먼저 웹앱 URL과 비밀 키를 입력해 주세요.', 'error');
    return;
  }

  saveButton.disabled = true;
  setMessage(recordMessage, '저장 중…');
  try {
    await sendAction({ action: 'save', date, weight });
    setMessage(recordMessage, date + ' ' + weight + 'kg 저장했어요.', 'ok');
    weightInput.value = '';
    render();
  } catch (err) {
    setMessage(recordMessage, '저장 실패: ' + err.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
});

// ---------------------------------------------------------------- 목록 화면

const recordList = document.getElementById('record-list');
const listMessage = document.getElementById('list-message');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function weekday(date) {
  // 'T00:00'을 붙여야 UTC가 아닌 폰의 현지 날짜로 해석된다.
  return WEEKDAYS[new Date(date + 'T00:00').getDay()];
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderList() {
  document.getElementById('list-empty').hidden = records.length > 0;
  recordList.replaceChildren();

  // records는 오래된 순이므로 뒤집어서 최신순으로 보여준다.
  const newestFirst = [...records].reverse();
  newestFirst.forEach((r, i) => {
    const li = makeEl('li');
    li.dataset.date = r.date;

    const dateEl = makeEl('span', 'record-date', r.date.slice(5).replace('-', '.'));
    dateEl.append(makeEl('small', '', '(' + weekday(r.date) + ')'));

    // 바로 이전 기록과의 차이
    const prev = newestFirst[i + 1];
    const diffEl = makeEl('span', 'record-diff');
    if (prev) {
      const diff = Math.round((r.weight - prev.weight) * 10) / 10;
      diffEl.textContent = diff === 0 ? '0' : (diff > 0 ? '+' : '') + diff;
      if (diff > 0) diffEl.classList.add('up');
      if (diff < 0) diffEl.classList.add('down');
    }

    const editBtn = makeEl('button', '', '수정');
    editBtn.type = 'button';
    editBtn.dataset.action = 'edit';

    const deleteBtn = makeEl('button', 'danger', '삭제');
    deleteBtn.type = 'button';
    deleteBtn.dataset.action = 'delete';

    li.append(dateEl, makeEl('span', 'record-weight', r.weight), diffEl, editBtn, deleteBtn);
    recordList.append(li);
  });
}

// 수정: 기록 화면으로 이동해 값을 채운다. 같은 날짜로 저장하면 덮어쓰기가 된다.
function startEdit(date) {
  const r = records.find(x => x.date === date);
  if (!r) return;
  showView('record');
  dateInput.value = r.date;
  weightInput.value = r.weight;
  setMessage(recordMessage, '');
  updateOverwriteNote();
  weightInput.focus();
  weightInput.select();
}

async function deleteRecord(date, button) {
  const r = records.find(x => x.date === date);
  if (!r || !confirm(date + ' (' + r.weight + 'kg) 기록을 삭제할까요?')) return;

  button.disabled = true;
  setMessage(listMessage, '삭제 중…');
  try {
    await sendAction({ action: 'delete', date });
    setMessage(listMessage, date + ' 기록을 삭제했어요.', 'ok');
    render();
  } catch (err) {
    setMessage(listMessage, '삭제 실패: ' + err.message, 'error');
    button.disabled = false;
  }
}

recordList.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  const date = button.closest('li').dataset.date;
  if (button.dataset.action === 'edit') startEdit(date);
  if (button.dataset.action === 'delete') deleteRecord(date, button);
});

// ---------------------------------------------------------------- 그래프 화면

let chart = null;
let graphRange = '30'; // '7' | '30' | 'all'

// 날짜를 '1970-01-01부터 며칠째'인 숫자로 바꿔 가로축에 쓴다.
// 그러면 기록이 없는 날도 간격이 그대로 유지된다.
function toDay(date) {
  return Date.parse(date + 'T00:00:00Z') / 86400000;
}

function fromDay(day) {
  const d = new Date(day * 86400000);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatKg(value) {
  return Math.round(value * 10) / 10 + ' kg';
}

function renderGraph() {
  const today = toDay(todayString());
  const points = records.map(r => ({ x: toDay(r.date), y: r.weight }));

  const emptyEl = document.getElementById('graph-empty');
  emptyEl.hidden = points.length > 0;
  emptyEl.textContent = '아직 기록이 없어요.';

  // 인터넷이 없어 Chart.js를 못 불러온 경우
  if (typeof Chart === 'undefined') {
    emptyEl.hidden = false;
    emptyEl.textContent = '그래프 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    return;
  }

  const accent = cssVar('--accent');
  const muted = cssVar('--muted');
  const line = cssVar('--line');

  // 끌어서 이동할 수 있는 전체 범위: 첫 기록 ~ 오늘 (양쪽에 반나절 여유를 두어 끝 점이 잘리지 않게)
  const firstDay = points.length ? points[0].x : today;
  const limitMin = firstDay - 0.5;
  const limitMax = today + 0.5;

  // 처음 보이는 창: 최근 N일. 기록이 N일보다 짧으면 첫 기록부터.
  const windowDays = graphRange === 'all' ? today - firstDay + 1 : Number(graphRange);
  const viewMin = Math.max(limitMin, limitMax - windowDays);

  // 눈금 간격은 실제로 보이는 폭으로 한 번 정해 두어, 끌어서 이동하는 동안 간격이 바뀌지 않게 한다.
  const shownDays = Math.round(limitMax - viewMin);
  const tickStep = Math.max(1, Math.ceil(shownDays / 7));

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('weight-chart'), {
    type: 'line',
    data: {
      datasets: [{
        data: points,
        borderColor: accent,
        backgroundColor: accent,
        borderWidth: 2,
        pointRadius: shownDays > 40 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: items => fromDay(items[0].parsed.x) + ' (' + weekday(new Date(items[0].parsed.x * 86400000).toISOString().slice(0, 10)) + ')',
            label: item => formatKg(item.parsed.y),
          },
        },
        zoom: {
          limits: { x: { min: limitMin, max: limitMax } },
          pan: {
            enabled: true,
            mode: 'x',
            threshold: 5,
            onPan: ({ chart }) => fitToView(chart),
            onPanComplete: ({ chart }) => fitToView(chart),
          },
          zoom: { wheel: { enabled: false }, pinch: { enabled: false } },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: viewMin,
          max: limitMax,
          // 눈금은 오늘부터 tickStep일 간격의 정수 날짜에만 찍는다.
          afterBuildTicks: axis => {
            const ticks = [];
            for (let d = Math.floor(axis.max); d >= Math.ceil(axis.min); d--) {
              if ((today - d) % tickStep === 0) ticks.unshift({ value: d });
            }
            axis.ticks = ticks;
          },
          ticks: {
            color: muted,
            autoSkip: false,
            maxRotation: 0,
            callback: value => fromDay(value),
          },
          grid: { display: false },
          border: { color: line },
        },
        y: {
          ticks: { color: muted, callback: value => value + '' },
          grid: { color: line },
          border: { display: false },
          title: { display: true, text: 'kg', color: muted },
        },
      },
    },
  });

  document.getElementById('graph-pan-hint').hidden = viewMin <= limitMin;
  fitToView(chart);
}

// 지금 화면에 보이는 구간에 맞춰 세로축 범위, 기간 표시, 통계를 갱신한다.
function fitToView(c) {
  const x = c.scales.x;
  const visible = c.data.datasets[0].data.filter(p => p.x >= x.min && p.x <= x.max);

  document.getElementById('graph-range-text').textContent =
    fromDay(Math.ceil(x.min)) + ' ~ ' + fromDay(Math.floor(x.max));
  renderStats(visible);

  if (visible.length) {
    const weights = visible.map(p => p.y);
    c.options.scales.y.min = Math.floor((Math.min(...weights) - 0.5) * 2) / 2;
    c.options.scales.y.max = Math.ceil((Math.max(...weights) + 0.5) * 2) / 2;
    c.update('none');
  }
}

function renderStats(points) {
  const minEl = document.getElementById('stat-min');
  const maxEl = document.getElementById('stat-max');
  const changeEl = document.getElementById('stat-change');
  if (points.length === 0) {
    minEl.textContent = maxEl.textContent = changeEl.textContent = '-';
    return;
  }
  const weights = points.map(p => p.y);
  const diff = Math.round((weights[weights.length - 1] - weights[0]) * 10) / 10;
  minEl.textContent = formatKg(Math.min(...weights));
  maxEl.textContent = formatKg(Math.max(...weights));
  changeEl.textContent = (diff > 0 ? '+' : '') + diff + ' kg';
}

document.querySelectorAll('.period button').forEach(b => {
  b.addEventListener('click', () => {
    graphRange = b.dataset.range;
    document.querySelectorAll('.period button').forEach(x => x.classList.toggle('active', x === b));
    renderGraph();
  });
});

// ---------------------------------------------------------------- 설정 화면

const urlInput = document.getElementById('input-url');
const keyInput = document.getElementById('input-key');
const settingsMessage = document.getElementById('settings-message');

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();

  const config = { url: urlInput.value.trim(), key: keyInput.value.trim() };
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(config.url)) {
    setMessage(settingsMessage, 'URL은 https://script.google.com/…/exec 형태여야 해요.', 'error');
    return;
  }
  if (!config.key) {
    setMessage(settingsMessage, '비밀 키를 입력해 주세요.', 'error');
    return;
  }

  setMessage(settingsMessage, '연결 확인 중…');
  try {
    await fetchRecords(config); // 연결이 되는 것을 확인한 뒤에 저장한다
    saveJSON(STORAGE_CONFIG, config);
    setMessage(settingsMessage, '연결 성공! 기록 ' + records.length + '개를 불러왔어요.', 'ok');
    render();
  } catch (err) {
    setMessage(settingsMessage, '연결 실패: ' + err.message, 'error');
  }
});

// ---------------------------------------------------------------- 시작

function init() {
  dateInput.value = todayString();
  dateInput.max = todayString();
  render(); // 폰에 남아 있는 기록으로 먼저 그린다

  const config = getConfig();
  if (!config) {
    showView('settings');
    setMessage(settingsMessage, '처음 한 번만 웹앱 URL과 비밀 키를 입력해 주세요.');
    return;
  }
  urlInput.value = config.url;
  keyInput.value = config.key;

  // 시트에서 최신 기록을 받아 다시 그린다
  fetchRecords()
    .then(render)
    .catch(err => setMessage(recordMessage, '기록을 불러오지 못했어요: ' + err.message, 'error'));
}

init();

// 홈 화면 설치와 오프라인 실행을 위한 service worker 등록
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(err => {
    console.warn('service worker 등록 실패:', err);
  });
}
