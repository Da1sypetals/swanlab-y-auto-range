(() => {
  const NS = globalThis.__swanlabYAutoRange;

  let chartjsInstalling = false;
  let scheduled = false;

  // SwanLab 的页面是单页应用，图表和设置面板随时会挂载；DOM 变化后在下一帧检查一次
  function tick() {
    scheduled = false;
    NS.panel.ensure();
    if (!chartjsInstalling && NS.chartjsHook.detected()) {
      chartjsInstalling = true;
      NS.chartjsHook.install();
    }
    if (!NS.unovisHook.isInstalled() && NS.unovisHook.detected()) {
      NS.unovisHook.install();
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(tick);
  }

  // 拖动滑动条时设置会连续变化，同一帧内只刷新一次图表
  let refreshScheduled = false;
  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      NS.chartjsHook.refreshAll();
      NS.unovisHook.refreshAll();
    });
  }

  NS.settings.subscribe(() => {
    NS.panel.render();
    scheduleRefresh();
  });

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  schedule();
})();
