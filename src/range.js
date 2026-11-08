(() => {
  const NS = (globalThis.__swanlabYAutoRange ??= {});

  const P_MIN = 1e-4;
  const P_MAX = 1e-2;

  // 滑动条相对位置 t ∈ [0, 1]，比例 p = 0.01% × 100^t
  function sliderToRatio(t) {
    return P_MIN * Math.pow(P_MAX / P_MIN, t);
  }

  // k = ceil(p × N)，最少为 1
  // p × N 先保留 12 位有效数字再取整，避免浮点误差让 3.0000000000000004 变成 4
  function dropCount(p, n) {
    return Math.max(1, Math.ceil(Number((p * n).toPrecision(12))));
  }

  // values: 可见区间内全部原始数据点的数值
  // filter: { enabled: boolean, t: number }
  function computeAutoRange(values, filterMin, filterMax) {
    const n = values.length;
    if (n === 0) throw new Error("computeAutoRange: values 为空");
    const sorted = Float64Array.from(values).sort();
    let lo = sorted[0];
    let hi = sorted[n - 1];
    if (filterMin.enabled) {
      const k = dropCount(sliderToRatio(filterMin.t), n);
      if (k < n) lo = sorted[k];
    }
    if (filterMax.enabled) {
      const k = dropCount(sliderToRatio(filterMax.t), n);
      if (k < n) hi = sorted[n - 1 - k];
    }
    return { lo, hi };
  }

  NS.range = { P_MIN, P_MAX, sliderToRatio, dropCount, computeAutoRange };
})();
