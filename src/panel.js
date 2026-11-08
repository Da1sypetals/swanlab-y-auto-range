(() => {
  const NS = globalThis.__swanlabYAutoRange;
  const { sliderToRatio } = NS.range;

  const MARK = "data-swanlab-y-auto-range";

  // class 字符串取自 SwanLab「仪表盘设置」面板里已有的元素，保证外观一致
  const CLS = {
    field: "pl-3 flex items-center gap-6 text-sm justify-between",
    fieldLabel: "flex items-center gap-1 w-20 shrink-0 border-l-2 pl-3",
    fieldLabelText: "leading-8 whitespace-nowrap",
    fieldContent: "w-full h-10 flex items-center min-w-0 space-x-2 [&_svg]:size-4",
    group: "flex gap-2 h-full",
    toggle:
      "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-[color,box-shadow] whitespace-nowrap bg-transparent px-2 min-w-9 h-full shrink-0 border data-[state=on]:bg-running data-[state=on]:text-running-foreground data-[state=on]:border-running-foreground/25",
    switch:
      "peer data-[state=checked]:bg-primary focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-muted-foreground",
    switchThumb:
      "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
    slider:
      "relative flex touch-none items-center select-none data-[disabled]:opacity-50",
    sliderTrack:
      "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full",
    sliderRange: "bg-primary absolute data-[orientation=horizontal]:h-full",
    sliderThumb:
      "border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden",
    readout: "text-xs text-muted-foreground",
  };

  const THUMB_PX = 16;

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function field(label, content) {
    const row = el("div", CLS.field);
    const labelBox = el("div", CLS.fieldLabel);
    const labelText = el("span", CLS.fieldLabelText);
    labelText.textContent = label;
    labelBox.append(labelText);
    const contentBox = el("div", CLS.fieldContent);
    contentBox.append(...content);
    row.append(labelBox, contentBox);
    return row;
  }

  function toggleButton(text, onClick) {
    const button = el("button", CLS.toggle);
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function setToggle(button, on) {
    button.dataset.state = on ? "on" : "off";
    button.setAttribute("aria-pressed", String(on));
  }

  function switchButton(onClick) {
    const button = el("button", CLS.switch);
    button.type = "button";
    button.setAttribute("role", "switch");
    const thumb = el("span", CLS.switchThumb);
    button.append(thumb);
    button.addEventListener("click", onClick);
    return button;
  }

  function setSwitch(button, checked) {
    const state = checked ? "checked" : "unchecked";
    button.dataset.state = state;
    button.firstElementChild.dataset.state = state;
    button.setAttribute("aria-checked", String(checked));
  }

  // 滑动条：thumb 宽 16px，中心的移动范围是 [8px, 宽度 - 8px]
  function slider(onChange) {
    const root = el("span", CLS.slider);
    root.dataset.orientation = "horizontal";
    root.style.flex = "1";
    root.style.height = `${THUMB_PX}px`;
    const track = el("span", CLS.sliderTrack);
    track.dataset.orientation = "horizontal";
    const range = el("span", CLS.sliderRange);
    range.dataset.orientation = "horizontal";
    range.style.left = "0%";
    track.append(range);
    const thumb = el("span", CLS.sliderThumb);
    thumb.setAttribute("role", "slider");
    thumb.setAttribute("aria-valuemin", "0");
    thumb.setAttribute("aria-valuemax", "1");
    thumb.tabIndex = 0;
    thumb.style.position = "absolute";
    thumb.style.transform = "translateX(-50%)";
    root.append(track, thumb);

    const tFromPointer = (event) => {
      const rect = root.getBoundingClientRect();
      const t = (event.clientX - rect.left - THUMB_PX / 2) / (rect.width - THUMB_PX);
      return Math.min(1, Math.max(0, t));
    };
    root.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      root.setPointerCapture(event.pointerId);
      thumb.focus();
      onChange(tFromPointer(event));
    });
    root.addEventListener("pointermove", (event) => {
      if (root.hasPointerCapture(event.pointerId)) onChange(tFromPointer(event));
    });
    thumb.addEventListener("keydown", (event) => {
      const t = Number(thumb.getAttribute("aria-valuenow"));
      const next = {
        ArrowLeft: t - 0.01,
        ArrowDown: t - 0.01,
        ArrowRight: t + 0.01,
        ArrowUp: t + 0.01,
        Home: 0,
        End: 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      onChange(Math.min(1, Math.max(0, next)));
    });
    return root;
  }

  function setSlider(root, t) {
    const [track, thumb] = root.children;
    track.firstElementChild.style.right = `${(1 - t) * 100}%`;
    thumb.style.left = `calc(${t * 100}% + ${THUMB_PX / 2 - THUMB_PX * t}px)`;
    thumb.setAttribute("aria-valuenow", String(t));
  }

  function formatRatio(t) {
    return `${(sliderToRatio(t) * 100).toPrecision(3)}%`;
  }

  function filterRow(label, name) {
    const toggle = switchButton(() =>
      NS.settings.update((s) => {
        s[name].enabled = !s[name].enabled;
      }),
    );
    const bar = slider((t) =>
      NS.settings.update((s) => {
        s[name].t = t;
      }),
    );
    const readout = el("span", CLS.readout);
    readout.style.minWidth = "4.5em";
    readout.style.textAlign = "right";
    const row = field(label, [toggle, bar, readout]);
    row.dataset.filter = name;
    return { row, toggle, bar, readout };
  }

  // yField: SwanLab 的 Y 轴「范围」一行（min、max、Log、重置），只在「指定 Y 的范围」时显示。
  // Log 与模式无关，单独放在「Log 坐标」一行，开关点击时转给 SwanLab 原有的 Log 按钮，原有按钮隐藏
  function build(yField) {
    const root = el("div", "space-y-3");
    root.setAttribute(MARK, "");
    const swanlabLog = yField.querySelector('button[data-slot="toggle"]');
    const swanlabReset = yField.querySelector("button:has(svg.lucide-rotate-ccw)");
    const rangeInputs = [
      yField.querySelector('input[placeholder="min"]'),
      yField.querySelector('input[placeholder="max"]'),
    ];

    const manual = toggleButton("指定 Y 的范围", () =>
      NS.settings.update((s) => {
        s.mode = "manual";
      }),
    );
    const auto = toggleButton("Auto", () =>
      NS.settings.update((s) => {
        s.mode = "auto";
      }),
    );
    manual.dataset.mode = "manual";
    auto.dataset.mode = "auto";
    const group = el("div", CLS.group);
    group.append(manual, auto);
    const modeRow = field("模式", [group]);

    const log = switchButton(() => {
      swanlabLog.click();
      requestAnimationFrame(syncLog);
    });
    log.dataset.role = "log";
    const logRow = field("Log 坐标", [log]);
    logRow.setAttribute(MARK, "");

    const filters = el("div", "space-y-3");
    filters.dataset.role = "filters";
    const min = filterRow("Filter min", "filterMin");
    const max = filterRow("Filter max", "filterMax");
    filters.append(min.row, max.row);

    root.append(modeRow, filters);
    return {
      root,
      logRow,
      yField,
      swanlabLog,
      swanlabReset,
      rangeInputs,
      log,
      manual,
      auto,
      filters,
      rows: { filterMin: min, filterMax: max },
    };
  }

  let current = null;

  function connected() {
    return current && current.root.isConnected && current.logRow.isConnected;
  }

  function syncLog() {
    if (!connected()) return;
    setSwitch(current.log, current.swanlabLog.dataset.state === "on");
  }

  // Auto 下 SwanLab 的全局 Y 轴范围必须为空：否则切回「指定 Y 的范围」时，之前填的 min/max
  // 会重新作用到所有图表上。用「范围」一行自带的重置按钮清空（SwanLab 把 $yRange 设为 [null, null]）
  function clearManualRange() {
    if (current.rangeInputs.some((input) => input.value !== "")) current.swanlabReset.click();
  }

  function render() {
    if (!connected()) return;
    const s = NS.settings.get();
    const auto = s.mode === "auto";
    setToggle(current.manual, !auto);
    setToggle(current.auto, auto);
    current.filters.hidden = !auto;
    current.yField.style.display = auto ? "none" : "";
    current.swanlabLog.style.display = "none";
    if (auto) clearManualRange();
    syncLog();
    for (const name of ["filterMin", "filterMax"]) {
      const { toggle, bar, readout } = current.rows[name];
      setSwitch(toggle, s[name].enabled);
      setSlider(bar, s[name].t);
      readout.textContent = formatRatio(s[name].t);
    }
  }

  // 「仪表盘设置」面板里 X/Y 轴范围所在的容器：两个轴标题 p，「Y 轴」标题后面的字段是 Y 轴范围
  // （min/max 输入框 + Log 开关），紧接着容器的兄弟元素是带开关的「悬停模式」一行
  function findYRangeField() {
    for (const container of document.querySelectorAll("div.space-y-3.text-sm")) {
      const titles = container.querySelectorAll(":scope > p");
      if (titles.length !== 2) continue;
      let yField = titles[1].nextElementSibling;
      while (yField && yField.hasAttribute(MARK)) yField = yField.nextElementSibling;
      if (!yField) continue;
      if (!yField.querySelector('input[placeholder="min"]')) continue;
      if (!yField.querySelector('input[placeholder="max"]')) continue;
      if (!yField.querySelector('button[data-slot="toggle"]')) continue;
      const hover = container.nextElementSibling;
      if (!hover || !hover.querySelector('button[role="switch"]')) continue;
      return yField;
    }
    return null;
  }

  // 「模式」一行放在「Y 轴」标题下面、SwanLab 的「范围」一行上面：
  // 选「指定 Y 的范围」时显示「范围」一行，选 Auto 时显示 Filter min / Filter max
  function ensure() {
    if (connected()) {
      syncLog();
      return;
    }
    if (current) {
      current.root.remove();
      current.logRow.remove();
    }
    const yField = findYRangeField();
    if (!yField) return;
    current = build(yField);
    yField.before(current.root);
    yField.after(current.logRow);
    render();
  }

  NS.panel = { ensure, render, MARK };
})();
