// scopeParser.js 단위 테스트 (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScopeText } = require('../scopeParser');

const TODAY = '2026-11-14';

test('"과목: …" + "1. 교과서 / 가. 페이지: …" 형식 공지를 항목별로 정리한다', () => {
  const text = [
    '과목: 역학과 에너지 (11월 24일 화요일)',
    '1. 교과서',
    '가. 페이지: 처음~73페이지',
    '나. 풀어야 할 문제: 44페이지 1번, 4번',
    '2. 학습지',
    '가. 학습지: 2학기 학습지 전부',
  ].join('\n');
  assert.deepEqual(parseScopeText(text, TODAY), [{
    subject: '역학과 에너지',
    date: '2026-11-24',
    scope: '교과서 처음~73페이지; 교과서 44페이지 1번, 4번; 2학기 학습지 전부',
  }]);
});

test('출제 팁·안내 문장("출제 확률 높음", "~합니다.")은 범위에서 빠진다', () => {
  const text = [
    '과목: 역학과 에너지',
    '1. 교과서 처음~73페이지',
    '- 운동량 보존 부분은 출제 확률 높음',
    '교과서 예제를 조금 바꿔서 냅니다.',
    '서술형은 풀이 과정을 꼭 써야 합니다.',
    '2. 학습지 1~5번',
  ].join('\n');
  const [r] = parseScopeText(text, TODAY);
  assert.equal(r.subject, '역학과 에너지');
  assert.equal(r.scope, '교과서 처음~73페이지; 학습지 1~5번');
});

test('"11월 24일(화)", "11/25(수)" 날짜를 인식한다', () => {
  // 날짜만 있는 머리말 줄 → 아래 과목에 적용 / 과목 줄 안의 날짜 → 그 과목에 적용
  const r = parseScopeText('11월 24일(화)\n국어 교과서 1~3단원\n11/25(수) 영어 Lesson 1~4', TODAY);
  assert.deepEqual(r.map((x) => [x.subject, x.date]), [['국어', '2026-11-24'], ['영어', '2026-11-25']]);
  assert.equal(r[0].scope, '교과서 1~3단원');
  assert.equal(r[1].scope, 'Lesson 1~4');
});

test('연도가 없는 날짜는 오늘 기준으로 연도를 추정한다', () => {
  const date = (line, today = TODAY) => parseScopeText(`${line} 수학 1단원`, today)[0].date;
  assert.equal(date('11월 24일'), '2026-11-24');       // 곧 다가올 날짜 → 올해
  assert.equal(date('1/5(화)'), '2027-01-05');         // 이미 지난 1월 → 내년
  assert.equal(date('10월 1일'), '2026-10-01');        // 두 달 안쪽으로 지난 날짜 → 올해 그대로
  assert.equal(date('12월 20일', '2027-01-03'), '2026-12-20'); // 새해 초에 본 작년 12월 공지
  assert.equal(date('2027.03.05'), '2027-03-05');      // 연도가 적혀 있으면 그대로
});

test('해가 바뀌는 경우: 60일 전 ~ 305일 후 범위의 연도를 고른다', () => {
  const date = (line, today) => parseScopeText(`${line} 수학 1단원`, today)[0].date;
  assert.equal(date('12월 30일', '2027-01-03'), '2026-12-30'); // 새해 직후 → 작년 12월
  assert.equal(date('1월 5일', '2026-12-20'), '2027-01-05');   // 연말 → 내년 1월
  assert.equal(date('3/15', '2026-11-14'), '2027-03-15');      // 올해 3월은 60일보다 더 지남 → 내년
  assert.equal(date('11월 24일', '2026-11-14'), '2026-11-24'); // 올해
});

test('"국 어"처럼 글자 사이가 띄어진 과목명도 인식한다', () => {
  const r = parseScopeText('국 어 : 11/25(수) 교과서 1~3단원\n한 국 사 : 11/26(목) 프린트 전체', TODAY);
  assert.deepEqual(r.map((x) => [x.subject, x.date, x.scope]), [
    ['국어', '2026-11-25', '교과서 1~3단원'],
    ['한국사', '2026-11-26', '프린트 전체'],
  ]);
});

test('"수학 2단원"을 수학2로 착각하지 않는다 (붙여 쓴 "수학2"는 수학2)', () => {
  const [a] = parseScopeText('수학 2단원 ~ 3단원', TODAY);
  assert.equal(a.subject, '수학');
  assert.match(a.scope, /^2단원/);
  const [b] = parseScopeText('수학2 3단원', TODAY);
  assert.equal(b.subject, '수학2');
  assert.equal(b.scope, '3단원');
});
