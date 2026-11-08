// SwanLab v0 版折线图（Chart.js + chartjs-plugin-zoom）
(() => {
  const NS = globalThis.__swanlabYAutoRange;
  const { computeAutoRange } = NS.range;

  let ChartClass = null;
  // 每次 update 在 beforeLayout 里算好 Auto 范围，afterBuildTicks 里写回 y 轴
  const autoBounds = new WeakMap();

  function seriesKey(detail) {
    return `${detail.cluster}\u0000${detail.key}`;
  }

  function isSwanlabLine(chart) {
    return (
      chart.config.type === "line" &&
      chart.data.datasets.some((ds) => ds.data.length > 0 && ds.data[0].detail)
    );
  }

  // 拉框改变了 Y 轴区间时，zoom 插件会记录 y 的缩放范围，这个图表使用拉框得到的 Y 范围
  function isYFixedByZoom(chart) {
    return chart.getZoomedScaleBounds().y !== undefined;
  }

  // 当前 X 轴可见区间内，图表上所有 run 的原始数据点
  // 平滑开启时，平滑曲线的每个点在 origin 字段保留原始值；同一指标只取一份原始值
  function visibleRawValues(chart) {
    const { min: xMin, max: xMax, minDefined, maxDefined } =
      chart.scales.x.getUserBounds();
    const datasets = chart.data.datasets.filter(
      (ds) => ds.data.length > 0 && !ds.data[0].detail.area,
    );
    const smoothed = new Set(
      datasets
        .filter((ds) => ds.data[0].detail.smooth)
        .map((ds) => seriesKey(ds.data[0].detail)),
    );
    const values = [];
    for (const ds of datasets) {
      const detail = ds.data[0].detail;
      let field;
      if (detail.smooth) field = "origin";
      else if (smoothed.has(seriesKey(detail))) continue;
      else field = "data";
      for (const point of ds.data) {
        if (minDefined && point.index < xMin) continue;
        if (maxDefined && point.index > xMax) continue;
        const v = point[field];
        if (Number.isFinite(v)) values.push(v);
      }
    }
    return values;
  }

  function computeForChart(chart) {
    const settings = NS.settings.get();
    if (settings.mode !== "auto") return null;
    if (!isSwanlabLine(chart)) return null;
    if (isYFixedByZoom(chart)) return null;
    const values = visibleRawValues(chart);
    if (values.length === 0) return null;
    const bounds = computeAutoRange(values, settings.filterMin, settings.filterMax);
    // 上下限重合时没有可用的区间，交给 SwanLab 原有逻辑
    if (!(bounds.lo < bounds.hi)) return null;
    return bounds;
  }

  const plugin = {
    id: "swanlabYAutoRange",
    beforeLayout(chart) {
      autoBounds.set(chart, computeForChart(chart));
    },
    // SwanLab 的 y 轴 afterDataLimits 会加 12.5% 留白，buildTicks 又会扩展到整齐的刻度值；
    // 在 afterBuildTicks 写回范围，随后 SwanLab 的 afterTickToLabelConversion 按这个范围重新生成刻度
    afterBuildTicks(chart, args) {
      if (args.scale.id !== "y") return;
      const bounds = autoBounds.get(chart);
      if (!bounds) return;
      args.scale.min = bounds.lo;
      args.scale.max = bounds.hi;
    },
  };

  // SwanLab 用 Vite 打包，Chart.js 所在的 vendor 模块在页面里有 modulepreload 链接；
  // 用同一个 URL 动态 import 得到的是页面正在使用的同一个模块实例
  async function findChartClass() {
    const isChartJsFile = (url) => /\/auto-[^/]+\.js$/.test(url);
    const urls = [...document.querySelectorAll('link[rel="modulepreload"]')]
      .map((link) => link.href)
      .filter((url) => url.startsWith(`${location.origin}/`) && url.includes("/vendor/"));
    urls.sort((a, b) => Number(!isChartJsFile(a)) - Number(!isChartJsFile(b)));
    for (const url of urls) {
      const mod = await import(url);
      for (const value of Object.values(mod)) {
        if (
          typeof value === "function" &&
          typeof value.getChart === "function" &&
          typeof value.register === "function" &&
          value.instances
        ) {
          return value;
        }
      }
    }
    throw new Error("[swanlab-y-auto-range] 没有找到 Chart.js 模块");
  }

  function detected() {
    for (const canvas of document.querySelectorAll("canvas")) {
      if (canvas.$chartjs) return true;
    }
    return false;
  }

  function refreshAll() {
    if (!ChartClass) return;
    for (const chart of Object.values(ChartClass.instances)) chart.update("none");
  }

  async function install() {
    ChartClass = await findChartClass();
    ChartClass.register(plugin);
    refreshAll();
  }

  function chartClass() {
    return ChartClass;
  }

  NS.chartjsHook = { detected, install, refreshAll, chartClass };
})();
