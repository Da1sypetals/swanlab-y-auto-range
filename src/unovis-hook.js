// SwanLab v1 版折线图（Unovis XYContainer + Brush）
(() => {
  const NS = globalThis.__swanlabYAutoRange;
  const { computeAutoRange } = NS.range;
  const { linearTicks, logTicks } = NS.ticks;

  // 渲染过的折线图容器，设置变化时逐个重新渲染
  const containers = new Set();
  // y 轴 Axis 实例 -> Auto 范围下的刻度
  const autoTicks = new WeakMap();
  // 拉框改变过 Y 轴区间的图表（LineContainer 的根元素）；双击重置缩放时 SwanLab 会重建整个图表组件
  const yFixedRoots = new WeakSet();
  let installed = false;

  // SwanLab 折线图的 LineContainer 根元素，拉框方式写在它的 class 上：brush-x / brush-y / brush-xy
  function chartRoot(element) {
    return element.closest(".line-chart-cursor");
  }

  function isLine(component) {
    const { config } = component;
    return "interpolateMissingData" in config && "lineWidth" in config;
  }

  function isLogScale(scale) {
    return typeof scale.base === "function" || typeof scale.constant === "function";
  }

  // 当前 X 轴可见区间内，图表上所有 run 的原始数据点
  // 平滑开启时平滑曲线的点在 origin 字段保留原始值，这时只读平滑曲线的 origin；
  // 点样式的曲线会把同一个点放两次，按 (seriesId, x) 去重
  function visibleRawValues(container) {
    const [xMin, xMax] = container.config.xDomain;
    const lines = container.components.filter(isLine);
    const smoothed = lines.some((line) =>
      (line.datamodel.data ?? []).some((p) => typeof p.origin === "number"),
    );
    const seen = new Map();
    const values = [];
    for (const line of lines) {
      for (const p of line.datamodel.data ?? []) {
        if (p.invalid) continue;
        if (p.x < xMin || p.x > xMax) continue;
        const v = smoothed ? p.origin : p.y;
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        let xs = seen.get(p.seriesId);
        if (!xs) seen.set(p.seriesId, (xs = new Set()));
        if (xs.has(p.x)) continue;
        xs.add(p.x);
        values.push(v);
      }
    }
    return values;
  }

  function computeFor(container) {
    const settings = NS.settings.get();
    if (settings.mode !== "auto") return null;
    if (yFixedRoots.has(chartRoot(container.element))) return null;
    const values = visibleRawValues(container);
    if (values.length === 0) return null;
    const bounds = computeAutoRange(values, settings.filterMin, settings.filterMax);
    // 上下限重合时没有可用的区间，交给 SwanLab 原有逻辑
    if (!(bounds.lo < bounds.hi)) return null;
    return bounds;
  }

  function ownerOf(instance, method) {
    let proto = Object.getPrototypeOf(instance);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, method)) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!proto) throw new Error(`[swanlab-y-auto-range] 没有找到 ${method}`);
    return proto;
  }

  // XYContainer 计算各坐标轴范围时，用 Auto 范围临时替换 SwanLab 传入的 yDomain
  function patchContainer(proto) {
    const original = proto._updateScalesDomain;
    proto._updateScalesDomain = function (...components) {
      if (!chartRoot(this.element)) return original.apply(this, components);
      containers.add(this);
      const bounds = computeFor(this);
      const { yAxis } = this.config;
      if (!bounds) {
        if (yAxis) autoTicks.delete(yAxis);
        return original.apply(this, components);
      }
      if (yAxis) {
        const ticks = isLogScale(this.config.yScale) ? logTicks : linearTicks;
        autoTicks.set(yAxis, ticks(bounds.lo, bounds.hi));
      }
      const swanlabDomain = this.config.yDomain;
      this.config.yDomain = [bounds.lo, bounds.hi];
      const result = original.apply(this, components);
      this.config.yDomain = swanlabDomain;
      return result;
    };
  }

  // SwanLab 按自己的 yDomain 生成刻度后通过 tickValues 传给 Axis；Auto 范围下换成按 Auto 范围生成的刻度
  function patchAxis(proto) {
    const original = proto._getConfiguredTickValues;
    proto._getConfiguredTickValues = function () {
      return autoTicks.get(this) ?? original.call(this);
    };
  }

  // 拉框结束时，SwanLab 已经按拖动方向决定了拉框方式并应用缩放；拉框改变了 Y 轴区间的图表改用拉框结果
  function patchBrush(proto) {
    const original = proto._onBrushEnd;
    proto._onBrushEnd = function (event) {
      const result = original.call(this, event);
      const root = chartRoot(this.element);
      if (root && event && event.sourceEvent && this.config.selection) {
        if (root.classList.contains("brush-y") || root.classList.contains("brush-xy")) {
          yFixedRoots.add(root);
        } else if (root.classList.contains("brush-x")) {
          yFixedRoots.delete(root);
        } else {
          throw new Error("[swanlab-y-auto-range] 无法识别拉框方式");
        }
      }
      return result;
    };
  }

  // Unovis 的 Vue 组件通过 defineExpose({ component }) 暴露内部实例，遍历 Vue 组件树收集这些实例；
  // Vue 生产版本里 app._instance 为空，组件树从挂载元素上的 _vnode 开始
  function exposedInstances() {
    const rootVNode = document.querySelector("#app")._vnode;
    const found = [];
    const visitVNode = (vnode) => {
      if (!vnode || typeof vnode !== "object") return;
      if (vnode.component) visitInstance(vnode.component);
      if (vnode.suspense) visitVNode(vnode.suspense.activeBranch);
      if (Array.isArray(vnode.children)) for (const child of vnode.children) visitVNode(child);
    };
    const visitInstance = (instance) => {
      const ref = instance.exposed?.component;
      if (ref && typeof ref === "object" && "value" in ref && ref.value) found.push(ref.value);
      visitVNode(instance.subTree);
    };
    visitVNode(rootVNode);
    return found;
  }

  function detected() {
    return document.querySelector(".line-chart-cursor [data-vis-xy-container]") !== null;
  }

  // 图表的 Brush、Axis 可能比容器晚挂载，三类实例都找到时才完成安装
  function install() {
    if (installed) return true;
    const instances = exposedInstances();
    const container = instances.find((i) => typeof i._updateScalesDomain === "function");
    const axis = instances.find((i) => typeof i._getConfiguredTickValues === "function");
    const brush = instances.find((i) => typeof i._onBrushEnd === "function");
    if (!container || !axis || !brush) return false;
    patchContainer(ownerOf(container, "_updateScalesDomain"));
    patchAxis(ownerOf(axis, "_getConfiguredTickValues"));
    patchBrush(ownerOf(brush, "_onBrushEnd"));
    installed = true;
    for (const instance of instances) {
      if (typeof instance._updateScalesDomain === "function") instance.render();
    }
    return true;
  }

  function refreshAll() {
    for (const container of containers) {
      if (!container.element.isConnected) {
        containers.delete(container);
        continue;
      }
      container.render();
    }
  }

  function isInstalled() {
    return installed;
  }

  NS.unovisHook = { detected, install, refreshAll, isInstalled, containers, autoTicks };
})();
