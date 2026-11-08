import { test } from "node:test";
import assert from "node:assert/strict";

await import("../src/range.js");
const { sliderToRatio, dropCount, computeAutoRange } = globalThis.__swanlabYAutoRange.range;

// 独立的参照实现：先排序，再按 k 从两端去掉点
function reference(values, filterMin, filterMax) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  // p × N 先四舍五入到 9 位小数，再向上取整
  const k = (t) => Math.max(1, Math.ceil(Math.round(1e-4 * 100 ** t * n * 1e9) / 1e9));
  let lo = sorted[0];
  let hi = sorted[n - 1];
  if (filterMin.enabled) {
    const rest = sorted.slice(k(filterMin.t));
    if (rest.length) lo = rest[0];
  }
  if (filterMax.enabled) {
    const rest = sorted.slice(0, n - k(filterMax.t));
    if (rest.length) hi = rest[rest.length - 1];
  }
  return { lo, hi };
}

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("滑动条两端和中点对应的比例", () => {
  assert.equal(sliderToRatio(0), 1e-4);
  assert.ok(Math.abs(sliderToRatio(1) - 1e-2) < 1e-15);
  assert.ok(Math.abs(sliderToRatio(0.5) - 1e-3) < 1e-15);
});

test("k = ceil(p × N)，最少为 1", () => {
  assert.equal(dropCount(sliderToRatio(1), 300), 3);
  assert.equal(dropCount(sliderToRatio(1), 1000), 10);
  assert.equal(dropCount(sliderToRatio(1), 2047), 21);
  assert.equal(dropCount(sliderToRatio(1), 10000), 100);
  assert.equal(dropCount(sliderToRatio(0), 100), 1);
  assert.equal(dropCount(sliderToRatio(0), 10000), 1);
  assert.equal(dropCount(sliderToRatio(0), 10001), 2);
  assert.equal(dropCount(sliderToRatio(0.5), 2047), 3);
  assert.equal(dropCount(sliderToRatio(0.5), 1000), 1);
});

test("两个开关都打开时去掉两端的极端值", () => {
  const rand = seededRandom(7);
  const values = Array.from({ length: 1000 }, () => rand());
  values[13] = 500;
  values[400] = -300;
  const r = computeAutoRange(values, { enabled: true, t: 0 }, { enabled: true, t: 1 });
  const sorted = [...values].sort((a, b) => a - b);
  assert.equal(r.lo, sorted[1]);
  assert.equal(r.hi, sorted[989]);
});

test("两个开关都关闭时取最小值和最大值", () => {
  const values = [3, -1, 7, 2, 100];
  const r = computeAutoRange(values, { enabled: false, t: 0.3 }, { enabled: false, t: 0.7 });
  assert.deepEqual(r, { lo: -1, hi: 100 });
});

test("只开一个开关", () => {
  const values = [5, 1, 9, 3, 1000];
  assert.deepEqual(
    computeAutoRange(values, { enabled: false, t: 0 }, { enabled: true, t: 1 }),
    { lo: 1, hi: 9 },
  );
  assert.deepEqual(
    computeAutoRange(values, { enabled: true, t: 0 }, { enabled: false, t: 1 }),
    { lo: 3, hi: 1000 },
  );
});

test("过滤后没有剩余点时这一侧取过滤前的值", () => {
  assert.deepEqual(
    computeAutoRange([4], { enabled: true, t: 1 }, { enabled: true, t: 1 }),
    { lo: 4, hi: 4 },
  );
});

test("随机数据与参照实现一致", () => {
  const rand = seededRandom(42);
  for (let round = 0; round < 300; round += 1) {
    const n = 1 + Math.floor(rand() * 5000);
    const values = Array.from({ length: n }, () => (rand() - 0.5) * 10 ** Math.floor(rand() * 6));
    const filterMin = { enabled: rand() < 0.8, t: rand() };
    const filterMax = { enabled: rand() < 0.8, t: rand() };
    assert.deepEqual(
      computeAutoRange(values, filterMin, filterMax),
      reference(values, filterMin, filterMax),
      `n=${n} min=${JSON.stringify(filterMin)} max=${JSON.stringify(filterMax)}`,
    );
  }
});

test("空数组直接报错", () => {
  assert.throws(() => computeAutoRange([], { enabled: true, t: 0 }, { enabled: true, t: 1 }));
});
