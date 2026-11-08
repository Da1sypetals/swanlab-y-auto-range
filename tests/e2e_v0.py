import math
import shutil
import sys
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".work" / "e2e"
URL = sys.argv[1] if len(sys.argv) > 1 else (
    "https://swanlab.cn/@ZeyiLin/Qwen2-fintune/runs/cfg5f8dzkp6vouxzaxlx6/chart"
)
MIN_CHARTS = 3
# Chrome for Testing 支持 --load-extension，并且 headless 模式可以运行扩展
CHROME = str(
    Path.home()
    / "Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64"
    / "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)

# 页面里查找 Chart.js 类的方式与扩展相同，这里单独实现一份用于没有加载扩展的对照组
FIND_CHART_JS = """
async () => {
  const urls = [...document.querySelectorAll('link[rel="modulepreload"]')]
    .map((l) => l.href).filter((u) => u.includes('/vendor/'));
  for (const u of urls) {
    const mod = await import(u);
    for (const v of Object.values(mod)) {
      if (typeof v === 'function' && typeof v.getChart === 'function' && v.instances) {
        window.__testChart = v;
        return true;
      }
    }
  }
  return false;
}
"""

DUMP_JS = """
() => Object.values(window.__testChart.instances).map((c) => ({
  key: c.data.datasets[0]?.data[0]?.detail?.key ?? null,
  datasets: c.data.datasets.map((ds) => ({
    smooth: ds.data[0]?.detail?.smooth ?? null,
    area: ds.data[0]?.detail?.area ?? null,
    cluster: ds.data[0]?.detail?.cluster ?? null,
    key: ds.data[0]?.detail?.key ?? null,
    points: ds.data.map((p) => [p.index, p.data ?? null, p.origin ?? null]),
  })),
  xUser: c.scales.x.getUserBounds(),
  zoomedY: c.getZoomedScaleBounds().y ?? null,
  y: [c.scales.y.min, c.scales.y.max],
  rect: (() => { const r = c.canvas.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
  area: [c.chartArea.left, c.chartArea.top, c.chartArea.right, c.chartArea.bottom],
}))
"""

SETTINGS_JS = "() => structuredClone(globalThis.__swanlabYAutoRange.settings.get())"

READY_JS = f"""
() => {{
  const C = window.__testChart;
  if (!C) return false;
  const charts = Object.values(C.instances);
  return charts.length >= {MIN_CHARTS} && charts.every((c) => c.data.datasets.length > 0 && c.chartArea);
}}
"""


def expected_bounds(chart, settings):
    if settings["mode"] != "auto" or chart["zoomedY"] is not None:
        return None
    xu = chart["xUser"]
    datasets = [d for d in chart["datasets"] if d["points"] and not d["area"]]
    smoothed = {(d["cluster"], d["key"]) for d in datasets if d["smooth"]}
    values = []
    for d in datasets:
        if d["smooth"]:
            column = 2
        elif (d["cluster"], d["key"]) in smoothed:
            continue
        else:
            column = 1
        for p in d["points"]:
            if xu["minDefined"] and p[0] < xu["min"]:
                continue
            if xu["maxDefined"] and p[0] > xu["max"]:
                continue
            v = p[column]
            if v is not None and math.isfinite(v):
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


# SwanLab 在没有设置 Y 轴范围时，y 轴 afterDataLimits 给两端各加 12.5% 留白（LineChart 里的 Ti 函数）
def swanlab_padded(lo, hi):
    r = (hi - lo) * 0.25 / 2
    hi = hi + r
    if lo - r < 0:
        hi += r
    else:
        lo -= r
    return [lo, hi]


def wait_charts(page):
    page.wait_for_function("() => !!window.__testChart || !!globalThis.__swanlabYAutoRange?.chartjsHook?.chartClass()", timeout=60000)
    page.evaluate("() => { window.__testChart ??= globalThis.__swanlabYAutoRange.chartjsHook.chartClass(); }")
    page.wait_for_function(READY_JS, timeout=60000)
    page.wait_for_timeout(800)


def dump(page):
    return {c["key"]: c for c in page.evaluate(DUMP_JS)}


def check_charts(page, baseline, label):
    settings = page.evaluate(SETTINGS_JS)
    charts = dump(page)
    assert len(charts) >= MIN_CHARTS, (label, list(charts))
    for key, chart in charts.items():
        exp = expected_bounds(chart, settings)
        if exp is None:
            if chart["zoomedY"] is not None:
                want = swanlab_padded(chart["zoomedY"]["min"], chart["zoomedY"]["max"])
            else:
                want = baseline[key]
            assert chart["y"] == want, (label, key, chart["y"], want)
            print(f"  [{label}] {key}: y={chart['y']} 使用 SwanLab 原有范围")
        else:
            lo, hi, n = exp
            assert chart["y"] == [lo, hi], (label, key, chart["y"], [lo, hi])
            print(f"  [{label}] {key}: N={n} y={chart['y']}")
    return charts


def launch(p, with_extension, profile):
    if profile.exists():
        shutil.rmtree(profile)
    args = []
    if with_extension:
        args = [f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}"]
    return p.chromium.launch_persistent_context(
        str(profile),
        executable_path=CHROME,
        headless=True,
        args=args,
        viewport={"width": 1600, "height": 1000},
        locale="zh-CN",
    )


def collect_baseline(p):
    ctx = launch(p, False, WORK / "profile-plain")
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_function("() => [...document.querySelectorAll('canvas')].some((c) => c.$chartjs)", timeout=60000)
    assert page.evaluate(FIND_CHART_JS)
    page.wait_for_function(READY_JS, timeout=60000)
    page.wait_for_timeout(800)
    baseline = {k: c["y"] for k, c in dump(page).items()}
    ctx.close()
    return baseline


def drag(page, x0, y0, x1, y1):
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=12)
    page.mouse.up()


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        baseline = collect_baseline(p)
        print("对照组（没有扩展）的 Y 轴范围:", baseline)

        ctx = launch(p, True, WORK / "profile-ext")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "swanlab-y-auto-range" in m.text and errors.append(m.text))
        page.goto(URL)
        wait_charts(page)

        settings = page.evaluate(SETTINGS_JS)
        assert settings == {
            "mode": "auto",
            "filterMin": {"enabled": True, "t": 0},
            "filterMax": {"enabled": True, "t": 1},
        }, settings
        print("1. 默认设置正确")
        check_charts(page, baseline, "默认")

        page.get_by_role("button", name="设置", exact=True).click()
        block = page.locator("[data-swanlab-y-auto-range]")
        block.wait_for(timeout=10000)
        layout = block.evaluate(
            """(el) => ({
              prevText: el.previousElementSibling.textContent.trim(),
              nextIsRange: !!el.nextElementSibling.querySelector('input[placeholder="max"]'),
              rangeVisible: el.nextElementSibling.offsetParent !== null,
              logVisible: el.querySelector('[data-role="log"]').offsetParent !== null,
              nextOfContainerHasSwitch: !!el.parentElement.nextElementSibling.querySelector('button[role="switch"]'),
              nextOfContainerText: el.parentElement.nextElementSibling.textContent.trim(),
              modeStates: [...el.querySelectorAll('button[data-mode]')].map((b) => [b.textContent, b.dataset.state]),
              filtersHidden: el.querySelector('[data-role="filters"]').hidden,
              switches: [...el.querySelectorAll('[data-filter] button[role="switch"]')].map((b) => b.dataset.state),
              sliders: [...el.querySelectorAll('[role="slider"]')].map((s) => s.getAttribute('aria-valuenow')),
              readouts: [...el.querySelectorAll('[data-filter] .text-xs')].map((s) => s.textContent),
            })"""
        )
        print("2. 面板结构:", layout)
        assert layout["prevText"] == "Y 轴" and layout["nextIsRange"]
        assert not layout["rangeVisible"] and layout["logVisible"]
        assert layout["nextOfContainerHasSwitch"]
        assert layout["modeStates"] == [["指定 Y 的范围", "off"], ["Auto", "on"]]
        assert layout["filtersHidden"] is False
        assert layout["switches"] == ["checked", "checked"]
        assert layout["sliders"] == ["0", "1"]
        assert layout["readouts"] == ["0.0100%", "1.00%"]
        panel = block.locator("xpath=ancestor::div[contains(@class,'space-y-4')][1]")
        panel.screenshot(path=str(WORK / "panel_default.png"))

        bar = block.locator('[data-filter="filterMax"] [role="slider"]').locator("xpath=..")
        box = bar.bounding_box()
        thumb = block.locator('[data-filter="filterMax"] [role="slider"]').bounding_box()
        drag(
            page,
            thumb["x"] + thumb["width"] / 2,
            thumb["y"] + thumb["height"] / 2,
            box["x"] + 8 + (box["width"] - 16) * 0.5,
            box["y"] + box["height"] / 2,
        )
        page.wait_for_timeout(400)
        settings = page.evaluate(SETTINGS_JS)
        assert abs(settings["filterMax"]["t"] - 0.5) < 0.02, settings
        readout = block.locator('[data-filter="filterMax"] .text-xs').text_content()
        print(f"3. 拖动 Filter max 滑动条到中间: t={settings['filterMax']['t']:.4f} 显示 {readout}")
        check_charts(page, baseline, "Filter max 拖到中间")

        block.locator('[data-filter="filterMin"] button[role="switch"]').click()
        page.wait_for_timeout(400)
        assert page.evaluate(SETTINGS_JS)["filterMin"]["enabled"] is False
        print("4. 关闭 Filter min")
        check_charts(page, baseline, "Filter min 关闭")

        block.locator('[data-filter="filterMax"] button[role="switch"]').click()
        page.wait_for_timeout(400)
        print("5. 两个开关都关闭")
        check_charts(page, baseline, "两个开关都关闭")
        block.locator('[data-filter="filterMax"] button[role="switch"]').click()
        page.wait_for_timeout(400)

        block.locator('button[data-mode="manual"]').click()
        page.wait_for_timeout(400)
        assert block.locator('[data-role="filters"]').is_hidden()
        assert block.locator('[data-role="log"]').is_hidden()
        assert block.locator("xpath=following-sibling::div[1]").is_visible()
        assert page.evaluate(SETTINGS_JS)["mode"] == "manual"
        print("6. 切换到「指定 Y 的范围」，显示「范围」一行，Filter 两项隐藏")
        check_charts(page, baseline, "指定 Y 的范围")
        panel.screenshot(path=str(WORK / "panel_manual.png"))

        block.locator('button[data-mode="auto"]').click()
        page.wait_for_timeout(400)
        assert block.locator('[data-role="filters"]').is_visible()
        assert block.locator("xpath=following-sibling::div[1]").is_hidden()
        print("7. 切换回 Auto，「范围」一行隐藏")
        check_charts(page, baseline, "切换回 Auto")
        panel.screenshot(path=str(WORK / "panel_auto_changed.png"))

        page.locator("h1", has_text="仪表盘设置").locator(
            "xpath=ancestor::div[contains(@class,'relative')][1]/button[.//*[contains(@class,'lucide-x')]]"
        ).click()
        page.wait_for_timeout(500)
        assert block.count() == 0 or block.is_hidden()

        charts = dump(page)
        target = "train/loss" if "train/loss" in charts else min(charts, key=lambda k: charts[k]["rect"][1])
        page.evaluate(
            """(key) => Object.values(window.__testChart.instances)
              .find((ch) => ch.data.datasets[0].data[0].detail.key === key)
              .canvas.scrollIntoView({ block: 'center' })""",
            target,
        )
        page.wait_for_timeout(800)
        c = dump(page)[target]
        left, top, right, bottom = c["area"]
        cx, cy = c["rect"][0], c["rect"][1]
        drag(
            page,
            cx + left + (right - left) * 0.3,
            cy + top + (bottom - top) * 0.3,
            cx + left + (right - left) * 0.7,
            cy + top + (bottom - top) * 0.7,
        )
        page.wait_for_timeout(800)
        after = dump(page)[target]
        assert after["xUser"]["minDefined"] and after["xUser"]["maxDefined"], after["xUser"]
        assert after["zoomedY"] is None
        print(f"8. 在 {target} 上拉框，X 轴区间变为 [{after['xUser']['min']:.2f}, {after['xUser']['max']:.2f}]")
        check_charts(page, baseline, "拉框只改变 X")
        page.screenshot(path=str(WORK / "zoom_x.png"))

        page.evaluate(
            """(key) => {
              const c = Object.values(window.__testChart.instances)
                .find((ch) => ch.data.datasets[0].data[0].detail.key === key);
              c.zoomScale('y', { min: 1, max: 5 }, 'none');
            }""",
            target,
        )
        page.wait_for_timeout(400)
        after = dump(page)[target]
        assert after["zoomedY"] == {"min": 1, "max": 5}, after["zoomedY"]
        assert after["y"] == swanlab_padded(1, 5), after["y"]
        print(f"9. {target} 的 Y 轴区间被缩放改为 [1, 5] 后使用缩放结果: y={after['y']}")
        check_charts(page, baseline, "同时改变 X 和 Y")

        c = dump(page)[target]
        left, top, right, bottom = c["area"]
        page.mouse.dblclick(c["rect"][0] + (left + right) / 2, c["rect"][1] + (top + bottom) / 2)
        page.wait_for_timeout(1500)
        page.wait_for_function(READY_JS, timeout=30000)
        after = dump(page)[target]
        assert not after["xUser"]["minDefined"] and after["zoomedY"] is None, after
        print(f"10. 双击重置 {target} 的缩放后回到 Auto")
        check_charts(page, baseline, "重置缩放")

        page.reload()
        page.evaluate("() => { window.__testChart = undefined; }")
        wait_charts(page)
        settings = page.evaluate(SETTINGS_JS)
        assert settings["filterMin"]["enabled"] is False and abs(settings["filterMax"]["t"] - 0.5) < 0.02, settings
        print("11. 刷新页面后设置保留:", settings)
        check_charts(page, baseline, "刷新后")

        page.get_by_role("button", name="设置", exact=True).click()
        block.wait_for(timeout=10000)
        smooth = page.locator("div[class*='*:justify-between']").first
        spin = smooth.locator("input[role='spinbutton']")
        spin.fill("0.6")
        spin.press("Enter")
        page.wait_for_timeout(1500)
        charts = dump(page)
        kinds = {
            key: sorted({(bool(d["smooth"]), d["points"][0][2] is not None) for d in c["datasets"] if d["points"]})
            for key, c in charts.items()
        }
        assert all(v == [(False, False), (True, True)] for v in kinds.values()), kinds
        print("12. 平滑设为 0.6，图上同时有原始曲线和平滑曲线（平滑点带 origin）")
        check_charts(page, baseline, "平滑 + 原始曲线")

        # 单个图表的「显示原始数据」只有项目成员能在图表编辑窗口里关闭；
        # 关闭后 SwanLab（LineChart 的 Pi 函数）只生成平滑曲线的数据集，这里把图表的数据集设成同样的内容
        page.evaluate(
            """() => {
              for (const c of Object.values(window.__testChart.instances)) {
                c.data.datasets = c.data.datasets.filter((ds) => ds.data[0].detail.smooth);
                c.update('none');
              }
            }"""
        )
        page.wait_for_timeout(500)
        charts = dump(page)
        kinds = {
            key: sorted({(bool(d["smooth"]), d["points"][0][2] is not None) for d in c["datasets"] if d["points"]})
            for key, c in charts.items()
        }
        assert all(v == [(True, True)] for v in kinds.values()), kinds
        print("13. 关闭显示原始数据，图上只有平滑曲线，统计使用 origin 字段")
        check_charts(page, baseline, "只有平滑曲线")
        page.screenshot(path=str(WORK / "smooth_only.png"))

        assert not errors, errors
        print("全部检查通过")
        ctx.close()


main()
