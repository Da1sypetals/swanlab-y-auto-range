// 与 SwanLab v1 折线图 Y 轴刻度的生成规则一致（LineChart 模块里的 Yn / z_ / B_ / H_ / Dl），
// Auto 范围下 Y 轴刻度的样子和 SwanLab 原有的刻度相同
(() => {
  const NS = globalThis.__swanlabYAutoRange;

  const MAX_TICKS = 6;

  function candidateSteps(span) {
    if (!Number.isFinite(span) || span <= 0) return [];
    const bases = [1, 2, 3, 5, 10];
    const exp = Math.floor(Math.log10(span));
    const steps = new Set();
    for (let e = exp - 1; e <= exp + 1; e++) {
      const unit = Math.pow(10, e);
      for (const b of bases) steps.add(b * unit);
    }
    return [...steps].sort((a, b) => a - b);
  }

  function roundToStep(value, step) {
    const digits = Math.max(0, Math.ceil(-Math.log10(Math.abs(step))) + 6);
    return Number(value.toFixed(digits));
  }

  function ticksForStep(lo, hi, step) {
    const first = Math.ceil(lo / step) * step;
    const last = Math.floor(hi / step) * step;
    if (first > last) return [];
    const count = Math.floor((last - first) / step + 1e-9) + 1;
    if (count > MAX_TICKS) return [];
    return Array.from({ length: count }, (_, i) => roundToStep(first + i * step, step)).filter(
      (v) => v >= lo && v <= hi,
    );
  }

  function linearTicks(lo, hi) {
    if (lo === hi) return [lo];
    let best = [];
    for (const step of candidateSteps(hi - lo)) {
      const ticks = ticksForStep(lo, hi, step);
      if (ticks.length > best.length) best = ticks;
    }
    return best.length > 0 ? best : [lo, hi];
  }

  function logTicks(lo, hi) {
    if (hi <= 0 || lo <= 0) return linearTicks(lo, hi);
    const minExp = Math.floor(Math.log10(lo));
    const maxExp = Math.ceil(Math.log10(hi));
    const all = new Set();
    for (let e = minExp; e < maxExp; e++) {
      const unit = Math.pow(10, e);
      for (let m = 1; m < 10; m++) all.add(unit * m);
    }
    all.add(Math.pow(10, maxExp));
    const inRange = [...all].filter((v) => v >= lo && v <= hi);
    if (inRange.length < 2) return linearTicks(lo, hi);
    if (inRange.length <= 8) return inRange.sort((a, b) => a - b);
    const powers = new Set();
    for (let e = minExp; e <= maxExp; e++) powers.add(Math.pow(10, e));
    const powersInRange = [...powers].filter((v) => v >= lo && v <= hi);
    if (powersInRange.length > 2 && powersInRange.length <= 5) return powersInRange;
    const source = powersInRange.length > 5 ? powersInRange : inRange;
    const picked = [source[0]];
    const stride = Math.ceil((source.length - 2) / 3);
    for (let i = stride; i < source.length - 1; i += stride) picked.push(source[i]);
    picked.push(source[source.length - 1]);
    return picked;
  }

  NS.ticks = { linearTicks, logTicks };
})();
