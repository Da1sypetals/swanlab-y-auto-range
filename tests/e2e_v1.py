import math
import shutil
import sys
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".work" / "e2e_v1"
URL = sys.argv[1] if len(sys.argv) > 1 else (
    "https://swanlab.cn/@ZeyiLin/PyTorch_Audio_Classification/v1/aetiv4/runs"
)
MIN_CHARTS = int(sys.argv[2]) if len(sys.argv) > 2 else 2
# Chrome for Testing 支持 --load-extension，并且 headless 模式可以运行扩展
CHROME = str(
    Path.home()
    / "Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64"
    / "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)

DUMP_JS = """
() => {
  const NS = globalThis.__swanlabYAutoRange;
  const isLine = (x) => 'interpolateMissingData' in x.config && 'lineWidth' in x.config;
  return [...NS.unovisHook.containers].filter((c) => c.element.isConnected).map((c) => {
    const root = c.element.closest('.line-chart-cursor');
    const card = root.closest('.group\\\\/chart') ?? root.parentElement;
    const lines = c.components.filter(isLine);
    const r = c.element.getBoundingClientRect();
    const m = c._getMargin();
    return {
      title: card.innerText.split('\\n')[0].trim(),
      xDomain: c.config.xDomain,
      swanlabYDomain: c.config.yDomain,
      yDomain: lines.length ? lines[0].yScale.domain() : null,
      ticks: c.config.yAxis._getConfiguredTickValues(),
      swanlabTicks: c.config.yAxis.config.tickValues,
      ourTicksForSwanlab: NS.ticks.linearTicks(c.config.yDomain[0], c.config.yDomain[1]),
      ourTicksForShown: lines.length ? NS.ticks.linearTicks(...lines[0].yScale.domain()) : null,
      logScale: typeof c.config.yScale.base === 'function' || typeof c.config.yScale.constant === 'function',
      brushClass: root.className,
      lines: lines.map((l) => (l.datamodel.data ?? []).map((p) => [String(p.seriesId), p.x, p.y ?? null, p.origin ?? null, !!p.invalid])),
      plot: [r.x + m.left, r.y + m.top, c.width, c.height],
    };
  });
}
"""

SETTINGS_JS = "() => structuredClone(globalThis.__swanlabYAutoRange.settings.get())"

PANEL_JS = """
(el) => {
  const range = el.nextElementSibling;
  const logRow = range.nextElementSibling;
  const swanlabLog = range.querySelector('button[data-slot="toggle"]');
  return {
    prevText: el.previousElementSibling.textContent.trim(),
    nextIsRange: !!range.querySelector('input[placeholder="max"]'),
    rangeVisible: range.offsetParent !== null,
    rangeValues: [...range.querySelectorAll('input')].map((i) => i.value),
    filtersVisible: el.querySelector('[data-role="filters"]').offsetParent !== null,
    logRowText: logRow.textContent.trim(),
    logRowIsOurs: logRow.hasAttribute('data-swanlab-y-auto-range'),
    logVisible: logRow.offsetParent !== null,
    logState: logRow.querySelector('[data-role="log"]').dataset.state,
    swanlabLogVisible: swanlabLog.offsetParent !== null,
    swanlabLogState: swanlabLog.dataset.state,
    nextOfContainerText: el.parentElement.nextElementSibling.textContent.trim(),
  };
}
"""

READY_JS = f"""
() => {{
  const NS = globalThis.__swanlabYAutoRange;
  if (!NS || !NS.unovisHook.isInstalled()) return false;
  const live = [...NS.unovisHook.containers].filter((c) => c.element.isConnected);
  return live.length >= {MIN_CHARTS} && live.every((c) => c.components.some((x) => 'lineWidth' in x.config && (x.datamodel.data ?? []).length > 0));
}}
"""


def expected_bounds(chart, settings, y_fixed):
    if settings["mode"] != "auto" or y_fixed:
        return None
    x0, x1 = chart["xDomain"]
    smoothed = any(p[3] is not None for line in chart["lines"] for p in line)
    seen = set()
    values = []
    for line in chart["lines"]:
        for sid, x, y, origin, invalid in line:
            if invalid or x < x0 or x > x1:
                continue
            v = origin if smoothed else y
            if v is None or not math.isfinite(v):
                continue
            if (sid, x) in seen:
                continue
            seen.add((sid, x))
            values.append(v)
    if not values:
        return None
    a = np.sort(np.asarray(values, dtype=np.float64))
    n = len(a)

    def k(t):
        return max(1, math.ceil(round(1e-4 * 100**t * n, 9)))

    lo, hi = a[0], a[-1]
    if settings["filterMin"]["enabled"] and k(settings["filterMin"]["t"]) < n:
        lo = a[k(settings["filterMin"]["t"])]
    if settings["filterMax"]["enabled"] and k(settings["filterMax"]["t"]) < n:
        hi = a[n - 1 - k(settings["filterMax"]["t"])]
    if not lo < hi:
        return None
    return float(lo), float(hi), n


def dump(page):
    charts = page.evaluate(DUMP_JS)
    titles = [c["title"] for c in charts]
    assert len(set(titles)) == len(titles), titles
    return {c["title"]: c for c in charts}


def check_charts(page, label, y_fixed=()):
    settings = page.evaluate(SETTINGS_JS)
    charts = dump(page)
    assert len(charts) >= MIN_CHARTS, (label, list(charts))
    for title, chart in charts.items():
        # 刻度生成规则与 SwanLab 一致：对 SwanLab 自己的 yDomain，扩展算出的刻度和 SwanLab 传给 Axis 的刻度相同
        if not chart["logScale"]:
            assert chart["ourTicksForSwanlab"] == chart["swanlabTicks"], (title, chart["ourTicksForSwanlab"], chart["swanlabTicks"])
        exp = expected_bounds(chart, settings, title in y_fixed)
        if exp is None:
            assert chart["yDomain"] == chart["swanlabYDomain"], (label, title, chart["yDomain"], chart["swanlabYDomain"])
            print(f"  [{label}] {title}: y={chart['yDomain']} 使用 SwanLab 原有范围")
        else:
            lo, hi, n = exp
            assert chart["yDomain"] == [lo, hi], (label, title, chart["yDomain"], [lo, hi])
            if not chart["logScale"]:
                assert chart["ticks"] == chart["ourTicksForShown"], (label, title, chart["ticks"])
            print(f"  [{label}] {title}: N={n} y={chart['yDomain']} 刻度={chart['ticks']}")
    return charts


def launch(p, profile):
    if profile.exists():
        shutil.rmtree(profile)
    return p.chromium.launch_persistent_context(
        str(profile),
        executable_path=CHROME,
        headless=True,
        args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"],
        viewport={"width": 1600, "height": 1000},
        locale="zh-CN",
    )


def scroll_to(page, title):
    page.evaluate(
        """(title) => {
          for (const c of globalThis.__swanlabYAutoRange.unovisHook.containers) {
            if (!c.element.isConnected) continue;
            const root = c.element.closest('.line-chart-cursor');
            const card = root.closest('.group\\\\/chart') ?? root.parentElement;
            if (card.innerText.split('\\n')[0].trim() === title) {
              root.scrollIntoView({ block: 'center' });
              return;
            }
          }
          throw new Error('没有找到图表 ' + title);
        }""",
        title,
    )
    page.wait_for_timeout(800)
    return dump(page)[title]


def drag(page, x0, y0, x1, y1):
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=15)
    page.mouse.up()


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = launch(p, WORK / "profile")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "swanlab-y-auto-range" in m.text and errors.append(m.text))
        page.goto(URL)
        page.wait_for_function(READY_JS, timeout=90000)
        page.wait_for_timeout(1500)

        charts = check_charts(page, "默认")
        print("1. 默认设置下 Y 轴为 Auto 范围")
        page.screenshot(path=str(WORK / "auto_default.png"))

        page.get_by_role("button", name="设置", exact=True).click()
        # 扩展插入两处：「模式」块在「范围」一行前面，「Log 坐标」一行在它后面；first 是「模式」块
        block = page.locator("[data-swanlab-y-auto-range]").first
        block.wait_for(timeout=10000)
        layout = block.evaluate(PANEL_JS)
        assert layout["prevText"] == "Y 轴" and layout["nextIsRange"], layout
        assert layout["nextOfContainerText"] == "悬停模式", layout
        assert not layout["rangeVisible"] and layout["filtersVisible"], layout
        assert layout["logRowIsOurs"] and layout["logRowText"] == "Log 坐标" and layout["logVisible"], layout
        assert not layout["swanlabLogVisible"], layout
        print("2. Auto 时的面板:", layout)
        panel = block.locator("xpath=ancestor::div[contains(@class,'space-y-4')][1]")
        panel.screenshot(path=str(WORK / "panel.png"))

        block.locator('[data-filter="filterMin"] button[role="switch"]').click()
        page.wait_for_timeout(600)
        print("3. 关闭 Filter min")
        check_charts(page, "Filter min 关闭")

        bar = block.locator('[data-filter="filterMax"] [role="slider"]').locator("xpath=..")
        box = bar.bounding_box()
        thumb = block.locator('[data-filter="filterMax"] [role="slider"]').bounding_box()
        drag(page, thumb["x"] + 8, thumb["y"] + 8, box["x"] + 8 + (box["width"] - 16) * 0.3, box["y"] + 8)
        page.wait_for_timeout(600)
        print(f"4. Filter max 拖到 30%: {page.evaluate(SETTINGS_JS)['filterMax']}")
        check_charts(page, "Filter max 30%")

        block.locator('button[data-mode="manual"]').click()
        page.wait_for_timeout(600)
        layout = block.evaluate(PANEL_JS)
        assert layout["rangeVisible"] and not layout["filtersVisible"] and layout["logVisible"], layout
        assert not layout["swanlabLogVisible"], layout
        print("5. 切换到「指定 Y 的范围」，显示「范围」一行，隐藏 Filter 两项:", layout)
        panel.screenshot(path=str(WORK / "panel_manual.png"))
        check_charts(page, "指定 Y 的范围")

        range_row = block.locator("xpath=following-sibling::div[1]")
        for placeholder, value in (("min", "0"), ("max", "1")):
            box_input = range_row.locator(f'input[placeholder="{placeholder}"]')
            box_input.fill(value)
            box_input.press("Enter")
        page.wait_for_timeout(1000)
        charts = check_charts(page, "填写 min=0 max=1")
        assert all(c["yDomain"] == [0, 1] for c in charts.values()), {t: c["yDomain"] for t, c in charts.items()}
        print("5.1 在「范围」一行填 min=0、max=1，所有图表的 Y 轴都变成 [0, 1]")

        block.locator('button[data-mode="auto"]').click()
        page.wait_for_timeout(1000)
        layout = block.evaluate(PANEL_JS)
        assert layout["rangeValues"] == ["", ""], layout
        assert not layout["rangeVisible"] and layout["filtersVisible"], layout
        print("5.2 切换到 Auto，「范围」一行的 min、max 被清空")
        check_charts(page, "Auto 清空范围")

        block.locator('button[data-mode="manual"]').click()
        page.wait_for_timeout(1000)
        layout = block.evaluate(PANEL_JS)
        assert layout["rangeValues"] == ["", ""], layout
        charts = check_charts(page, "再切回指定 Y 的范围")
        assert not any(c["yDomain"] == [0, 1] for c in charts.values())
        print("5.3 再切回「指定 Y 的范围」，min、max 为空，图表不再是 [0, 1]")

        block.locator('button[data-mode="auto"]').click()
        block.locator('[data-filter="filterMin"] button[role="switch"]').click()
        page.wait_for_timeout(600)
        layout = block.evaluate(PANEL_JS)
        assert not layout["rangeVisible"] and layout["filtersVisible"] and layout["logVisible"], layout
        print("6. 切换回 Auto，隐藏「范围」一行，重新打开 Filter min")
        check_charts(page, "切换回 Auto")

        page.locator('[data-role="log"]').click()
        page.wait_for_timeout(800)
        layout = block.evaluate(PANEL_JS)
        assert layout["logState"] == "checked" and layout["swanlabLogState"] == "on", layout
        charts = dump(page)
        assert all(c["logScale"] for c in charts.values()), {t: c["logScale"] for t, c in charts.items()}
        print("6.1 打开「Log 坐标」，SwanLab 原有的 Log 开关跟着打开，图表变为对数坐标")
        panel.screenshot(path=str(WORK / "panel_auto_log.png"))
        check_charts(page, "Log 打开")
        page.locator('[data-role="log"]').click()
        page.wait_for_timeout(800)
        layout = block.evaluate(PANEL_JS)
        assert layout["logState"] == "unchecked" and layout["swanlabLogState"] == "off", layout
        assert not any(c["logScale"] for c in dump(page).values())
        print("6.2 关闭「Log 坐标」，恢复线性坐标")

        page.locator("h1", has_text="仪表盘设置").locator(
            "xpath=ancestor::div[./button[.//*[contains(@class,'lucide-x')]]][1]/button[.//*[contains(@class,'lucide-x')]]"
        ).click()
        page.wait_for_timeout(600)

        charts = dump(page)
        target = min(charts, key=lambda t: charts[t]["plot"][1])
        chart = scroll_to(page, target)
        x, y, w, h = chart["plot"]
        full_x = chart["xDomain"]
        drag(page, x + w * 0.3, y + h * 0.5, x + w * 0.7, y + h * 0.5 + 4)
        page.wait_for_timeout(1500)
        after = dump(page)[target]
        assert "brush-x" in after["brushClass"].split(), after["brushClass"]
        assert after["xDomain"][0] > full_x[0] and after["xDomain"][1] < full_x[1], (full_x, after["xDomain"])
        print(f"7. 在 {target} 上水平拉框，X 轴区间 {full_x} -> {after['xDomain']}")
        check_charts(page, "拉框只改变 X")
        page.screenshot(path=str(WORK / "zoom_x.png"))

        x, y, w, h = scroll_to(page, target)["plot"]
        drag(page, x + w * 0.2, y + h * 0.15, x + w * 0.8, y + h * 0.85)
        page.wait_for_timeout(1500)
        after = dump(page)[target]
        assert "brush-xy" in after["brushClass"].split(), after["brushClass"]
        print(f"8. 在 {target} 上斜向拉框，Y 轴使用拉框结果: y={after['yDomain']}")
        check_charts(page, "同时改变 X 和 Y", y_fixed={target})
        page.screenshot(path=str(WORK / "zoom_xy.png"))

        page.evaluate("() => globalThis.__swanlabYAutoRange.settings.update((s) => { s.filterMax.t = 1; })")
        page.wait_for_timeout(600)
        print("9. 修改 Filter max 后，斜向拉框的图表保持拉框结果，其他图表重新计算")
        check_charts(page, "拉框后修改设置", y_fixed={target})

        x, y, w, h = scroll_to(page, target)["plot"]
        page.mouse.dblclick(x + w / 2, y + h / 2)
        page.wait_for_timeout(2500)
        page.wait_for_function(READY_JS, timeout=30000)
        after = dump(page)[target]
        assert after["xDomain"] == full_x, (after["xDomain"], full_x)
        print(f"10. 双击重置 {target} 的缩放后回到 Auto")
        check_charts(page, "重置缩放")

        page.get_by_role("button", name="设置", exact=True).click()
        block.wait_for(timeout=10000)
        spin = page.locator("div[class*='*:justify-between']").first.locator("input[role='spinbutton']")
        spin.fill("0.6")
        spin.press("Enter")
        page.wait_for_timeout(2500)
        charts = dump(page)
        for title, chart in charts.items():
            kinds = {any(p[3] is not None for p in line) for line in chart["lines"] if line}
            assert kinds == {False, True}, (title, kinds)
        print("11. 平滑设为 0.6，图上同时有原始曲线和平滑曲线，统计使用平滑点的 origin")
        check_charts(page, "平滑")
        page.screenshot(path=str(WORK / "smooth.png"))

        assert not errors, errors
        print("全部检查通过")
        ctx.close()


main()
