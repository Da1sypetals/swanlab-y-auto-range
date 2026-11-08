# SwanLab Y Auto Range

Edge / Chrome 扩展。在 swanlab.cn「仪表盘设置」面板的 Y 轴区域加入「指定 Y 的范围」与「Auto」切换，Auto 按比例丢弃极端值后决定 Y 轴范围。

## 安装

1. Edge 打开 `edge://extensions`，打开「开发人员模式」。
2. 点「加载解压缩的扩展」，选择本目录 `swanlab-y-auto-range`。
3. 刷新 swanlab.cn 的图表页面。

## 功能

- 「仪表盘设置」的 Y 轴区域，「Y 轴」标题下方新增「模式」一行：「指定 Y 的范围」「Auto」两个互斥按钮，默认 Auto。两种模式二选一：
  - 选「指定 Y 的范围」时，下方显示 SwanLab 原有的「范围」一行（min、max、Log、重置）。
  - 选「Auto」时，「范围」一行隐藏，下方显示 Filter min、Filter max；「模式」一行右侧显示 Log 按钮，点击时操作 SwanLab 原有的 Log 开关。
- Filter min、Filter max 每项有一个开关和一个滑动条。滑动条位置 t ∈ [0, 1]，比例 p = 0.01% × 100^t。默认两个开关都打开，Filter min 的滑块在最左边（0.01%），Filter max 的滑块在最右边（1%）。
- Auto 的计算（每个折线图单独计算）：
  - N 是当前 X 轴可见区间内这个图表上所有 run 的原始数据点数量；平滑开启时使用平滑曲线每个点记录的原始值。
  - k = max(1, ⌈p × N⌉)。
  - Filter min 打开时丢弃最小的 k 个点，剩余点的最小值作为下界；关闭时下界取可见点的最小值。
  - Filter max 打开时丢弃最大的 k 个点，剩余点的最大值作为上界；关闭时上界取可见点的最大值。
  - 某一侧过滤后没有剩余点时，这一侧取过滤前的值。
  - 上下界相等时（例如数值一直不变的曲线），Y 轴按 SwanLab 原有方式显示。
- 选中「指定 Y 的范围」时，Y 轴按 SwanLab 原有方式显示：使用「范围」一行的 min、max，没填的一侧由 SwanLab 决定。
- 拉框缩放：
  - 只改变 X 轴区间时，保持 Auto，按新的可见 X 区间重新统计 N 并计算 Y 轴范围。
  - 改变了 Y 轴区间时，这个图表的 Y 轴使用拉框结果。
  - 双击图表重置缩放后，回到面板上选的模式。
- 设置保存在浏览器 swanlab.cn 站点的 localStorage 里。

## 支持的页面

- 新版图表页面：地址中带 `/v1/`，图表由 Unovis 绘制，对应 `src/unovis-hook.js`。
- 旧版图表页面：地址中带 `/v0/`，图表由 Chart.js 绘制，对应 `src/chartjs-hook.js`。

## 文件

- `src/range.js`：Auto 范围的计算。
- `src/ticks.js`：Auto 范围下的 Y 轴刻度，生成规则与 SwanLab 新版图表一致。
- `src/settings.js`：设置的读写。
- `src/panel.js`：「仪表盘设置」面板里新增的一行。
- `src/chartjs-hook.js`、`src/unovis-hook.js`：接管两种图表的 Y 轴范围。
- `src/main.js`：入口。

## 测试

单元测试：

```bash
node --test tests/range.test.mjs
```

端到端测试：用 Playwright 启动加载了本扩展的 Chrome for Testing，打开 SwanLab 公开项目，逐个图表核对 Y 轴范围与独立计算的结果一致。Chrome for Testing 的路径写在脚本的 `CHROME` 变量里。

```bash
python3 tests/e2e_v1.py
```

```bash
python3 tests/e2e_v0.py
```
