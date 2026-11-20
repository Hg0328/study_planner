// 계획 결과 스냅샷: 설정을 건드리지 않은 계정의 계획이 바뀌지 않았는지 확인
//  (계획 알고리즘이나 기본값을 일부러 바꿨다면 아래 값을 새로 계산해 갱신하고, PR에 이유를 적을 것)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../scheduler');

const hash = (plan) => crypto.createHash('sha256').update(JSON.stringify(plan.map((t) => [t.date, t.start, t.end, t.exam_id, t.kind, t.title]))).digest('hex').slice(0, 16);
const exams = [
  { id: 1, subject: '국어', date: '2026-12-01', difficulty: 3, scope: '1단원 문학; 2단원 문법', pref_days: '' },
  { id: 2, subject: '수학', date: '2026-12-02', difficulty: 4, scope: '다항식, 방정식, 부등식', pref_days: '6', priority: 'high' },
  { id: 3, subject: '영어', date: '2026-12-04', difficulty: 2, scope: '', pref_days: '' },
  { id: 4, subject: '수학', date: '2027-03-10', difficulty: 4, kind: 'suneung', scope: '수열과 급수; 미분법 응용', pref_days: '' },
];
const CASES = {
  '기본 설정 (가입 직후 그대로)': { settings: S.sanitizeSettings({}), expect: '67f2561d4364b1a4' },
  '학원 있음': { settings: S.sanitizeSettings({ academies: [{ name: '학원', days: [1, 3], start: '19:00', end: '21:00' }] }), expect: 'd29258bea249fcd4' },
  '직장인 프리셋 값': { settings: S.sanitizeSettings({ lifeType: 'worker', school: Array.from({ length: 7 }, (_, d) => ({ on: d >= 1 && d <= 5, start: '09:00', end: '18:00' })), bufferMin: 60, maxWeekdayMin: 120, maxWeekendMin: 300 }), expect: '76704a2f97c494de' },
};
for (const [name, c] of Object.entries(CASES)) {
  test(`계획 스냅샷: ${name}`, () => {
    const plan = S.buildPlan({ settings: c.settings, exams, startDate: '2026-11-16' }).all;
    assert.ok(plan.length > 100);
    assert.equal(hash(plan), c.expect, `계획 결과가 바뀜 (${plan.length}개)`);
  });
}
