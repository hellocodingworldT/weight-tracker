/**
 * 몸무게 기록 앱 - 구글 시트 저장용 Apps Script
 *
 * 시트 구조 (첫 번째 시트 탭):
 *   A: date (YYYY-MM-DD) | B: weight (kg) | C: updatedAt
 *
 * 앱과 주고받는 방법:
 *   GET  ?key=비밀키                     → 전체 기록을 JSON으로 돌려줌
 *   POST {key, action:'save', date, weight} → 저장 (같은 날짜면 덮어쓰기)
 *   POST {key, action:'delete', date}       → 삭제
 */

const HEADER = ['date', 'weight', 'updatedAt'];
const MIN_WEIGHT = 20;
const MAX_WEIGHT = 300;

/**
 * 처음 한 번만 실행하는 준비 함수.
 * - 첫 줄에 제목(header)을 쓰고, 날짜 열을 텍스트 형식으로 바꾼다.
 * - 비밀 키를 만들어 저장하고, 실행 로그에 보여준다.
 */
function setup() {
  const sheet = getSheet_();
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  // 날짜를 텍스트로 두어야 시트가 날짜 형식으로 멋대로 바꾸지 않는다.
  sheet.getRange('A:A').setNumberFormat('@');

  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SECRET_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('SECRET_KEY', key);
  }
  Logger.log('비밀 키: ' + key + '  ← 앱 설정 화면에 입력하세요');
}

/** 기록 전체 읽기 */
function doGet(e) {
  if (!isValidKey_(e.parameter.key)) {
    return json_({ ok: false, error: '비밀 키가 맞지 않습니다' });
  }
  return json_({ ok: true, records: readAll_() });
}

/** 저장 / 삭제 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '요청 형식이 잘못되었습니다' });
  }

  if (!isValidKey_(body.key)) {
    return json_({ ok: false, error: '비밀 키가 맞지 않습니다' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) {
    return json_({ ok: false, error: '날짜는 YYYY-MM-DD 형식이어야 합니다' });
  }

  // 두 요청이 동시에 와도 시트가 꼬이지 않도록 잠근다.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'save') {
      const weight = Number(body.weight);
      if (!(weight >= MIN_WEIGHT && weight <= MAX_WEIGHT)) {
        return json_({ ok: false, error: '몸무게는 ' + MIN_WEIGHT + '~' + MAX_WEIGHT + 'kg 사이여야 합니다' });
      }
      saveRecord_(body.date, Math.round(weight * 10) / 10);
    } else if (body.action === 'delete') {
      deleteRecord_(body.date);
    } else {
      return json_({ ok: false, error: '알 수 없는 action: ' + body.action });
    }
  } finally {
    lock.releaseLock();
  }

  return json_({ ok: true, records: readAll_() });
}

// ---------------------------------------------------------------- 내부 함수

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
}

function isValidKey_(key) {
  const saved = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
  return Boolean(saved) && key === saved;
}

/** 날짜 칸이 Date 객체로 들어와 있어도 YYYY-MM-DD 문자열로 맞춘다. */
function toDateString_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

/** 해당 날짜가 있는 행 번호(1부터), 없으면 -1 */
function findRow_(sheet, date) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < dates.length; i++) {
    if (toDateString_(dates[i][0]) === date) return i + 2;
  }
  return -1;
}

function saveRecord_(date, weight) {
  const sheet = getSheet_();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const row = findRow_(sheet, date);
  if (row === -1) {
    sheet.appendRow([date, weight, now]);
  } else {
    sheet.getRange(row, 1, 1, 3).setValues([[date, weight, now]]);
  }
  // 날짜 순으로 정렬해 두면 시트에서 보기 편하다.
  const lastRow = sheet.getLastRow();
  if (lastRow > 2) {
    sheet.getRange(2, 1, lastRow - 1, 3).sort(1);
  }
}

function deleteRecord_(date) {
  const sheet = getSheet_();
  const row = findRow_(sheet, date);
  if (row !== -1) sheet.deleteRow(row);
}

function readAll_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    .filter(r => r[0] !== '' && r[1] !== '')
    .map(r => ({ date: toDateString_(r[0]), weight: Number(r[1]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
