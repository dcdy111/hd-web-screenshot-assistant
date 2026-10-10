# 通用高清网页截图助手 v2.1（Windows 双击版）

基于你原来的 Playwright 高清截图工具改进：**每次运行自行输入网址**，不绑定任何网站；回车默认打开「瞳序」 `http://43.139.69.134:18080/`。支持在网页上操作和登录后再截图，不自动登录、不写入任何账号密码。

## 1. 使用方法（最重要）

1. **先解压整个 ZIP** 到一个普通目录，不要直接在压缩包中双击。
2. **双击「启动高清截图.bat」**。
3. 出现提示后输入网址并回车；**直接回车**默认打开「瞳序」。示例：
   - `http://43.139.69.134:18080/`
   - `43.139.69.134:18080` （IP+端口自动按 HTTP 打开）
   - `https://example.com`
   - `localhost:5173` 或 `192.168.1.10:8080` （自动按 HTTP 打开）
4. 浏览器打开后正常登录、点击菜单、切换页面，**右上角悬浮工具条随网页显示**。
5. **同一次启动可以一直截图**：点击「当前屏PNG」或「框选PNG」后，继续浏览网页、切换功能、刷新页面，再次截图即可，**无需重新启动或输入网址**。推荐使用「框选PNG」精确截取系统界面。
   - 浏览器默认最大化并自适应当前显示器的实际可见区域，不再固定为 1600×900；截图倍率只影响导出图片，不会把窗口视口扩展到屏幕以外。
   - 框选坐标会根据网页当前滚动位置换算，滚动网页后也会截取你拖选的准确位置。
   - 如果网页自身的排版就有大面积留白，可以使用「框选PNG」只截取左上角实际内容；该工具不会擅自改变网站布局。
6. 所有文件保存在 `output\hd-screenshots\`；可双击「打开截图目录.bat」直接查看。
7. **关闭截图工具启动的浏览器窗口**即可结束程序。关闭后控制台也会提示结束。

> 首次启动可能需要联网安装依赖，请等待一次。以后无需重复安装。若需要安装 Node.js，请安装 Node.js 18+（建议 20/22 LTS）：https://nodejs.org/ 。电脑须已安装 Google Chrome 或 Microsoft Edge，二者任一即可。

## 2. 页面工具按钮

| 按钮 | 实际效果 | 建议用途 |
| --- | --- | --- |
| 当前屏PNG | 当前可视网页内容，默认 **4 倍像素密度**，不截工具栏 | 完整界面插入 Word / PPT |
| 框选PNG | 在网页上拖动选区并保留高倍率像素 | **报告中的局部功能截图（最推荐）** |
| 整页PNG | 保存当前网页可滚动的完整内容 | 长表格、整页流程；若页面过长，使用框选或降低倍率 |
| 当前屏PDF | 嵌入同内容高清 PNG 的 PDF，同时保存 PNG | 需要固定版式的高分辨率 PDF |
| 框选PDF | 选区快照 PDF，同时保存 PNG | 局部截图 PDF |
| 打印PDF | 浏览器的打印版式，文字尽量为矢量 | 正式打印页面；布局不保证和屏幕一致，可能跨多页 |

**快捷键**：`Alt + Shift + S` 当前屏 PNG，`Alt + Shift + F` 整页 PNG，`Alt + Shift + P` 当前屏 PDF。点击工具条右侧「—」可折叠。导出时工具条自动隐藏。Esc 取消框选。

**也支持控制台命令**：直接回车截当前屏；`f` 整页 PNG；`p` 当前屏快照 PDF；`pv` 打印 PDF；`b` 当前屏 PNG + PDF。推荐直接点网页工具条。

## 3. 高清的含义与建议

- 默认截图倍率 `4×`；浏览器会自适应最大化当前显示器，导出当前屏约为实际可见网页区域的 4 倍像素（具体尺寸受屏幕分辨率、系统缩放和浏览器工具栏高度影响）。
- 高像素截图是**重新从浏览器绘制网页**，不是把旧截图放大。网页中原本就低清晰度的位图、模糊照片不会被凭空增强。
- **插入 Word/PPT 优先用 PNG**，不要先把它贴进微信或截图软件再导出，避免被再次压缩。
- 太长的网页如果超过安全像素上限，会提示改用框选或降低倍率，防止浏览器占满内存。
- 如果网页正在加载动画或图表，等内容稳定后再点击截图。
- 如果网站有登录页，可正常手动登录。Cookie 会记录在本机用户目录，方便下次打开相同网站；工具不读取密码。

## 4. 运行环境与隐私

- Windows 10 / 11；Node.js 18+ 和 npm；Google Chrome 或 Microsoft Edge。
- 不需要装 Python。`crop-hd-screenshot.py` 是原工具附带的**可选离线裁剪器**，只有运行它才需要 Python、Pillow、reportlab：`pip install pillow reportlab`。
- 登录状态默认保存在 `%LOCALAPPDATA%\HDWebScreenshotAssistant\browser-profile`，**不放在 ZIP 中**，避免把登录状态意外发给别人。如需清除登录状态，关闭程序后删除这个目录。
- 不自动收集、上传、同步截图；结果只保存到本地 `output\hd-screenshots`。
- 截取真实业务页面时，请自行核对患者信息、账号、密钥是否需要遮盖。

## 5. 常见问题

**双击 BAT 提示未检测到 Node.js**：安装 Node.js，重开窗口，再双击 BAT。

**首次安装失败**：请确认有网络，或在本目录打开 PowerShell 执行 `npm ci --no-audit --no-fund` 后重试。

**浏览器找不到**：安装 Chrome 或 Edge；通常 Windows 自带 Edge。

**工具条没出现**：稍等页面加载完成，刷新页面。仍失败时可回到黑色控制台直接按回车截当前屏，或输入 `p` 导出 PDF。

**报截图过大**：在当前网页选择较小区域「框选PNG」，或在命令行使用 `--dpr=2`，减少输出像素。

**网站打不开**：检查输入的网址、http/https、端口和网络状态。访问内网/localhost 服务时必须先在本机启动对应服务。

**PDF 为什么不是完全矢量**：当前屏/框选 PDF 是真实截图嵌入 PDF；只有「打印PDF」尝试保留文字矢量属性，网页图像本来就无法无损转换为矢量，而且打印排版可能变化。

## 6. 高级启动示例（可选）

双击 BAT 已足够使用。若希望自定义倍率或输出目录，可在当前文件夹打开终端：

```powershell
node .\hd-screenshot-assistant.js --dpr=3 --width=1920 --height=1080
node .\hd-screenshot-assistant.js --url=https://example.com --dpr=2
node .\hd-screenshot-assistant.js --url=https://example.com --headless --once=viewport
node .\hd-screenshot-assistant.js --url=https://example.com --headless --once=pdf
```

可用参数：`--url=...`、`--dpr=1..5`、`--width=...`、`--height=...`、`--out=...`、`--browser=auto|chrome|msedge|chromium`、`--once=viewport|full|pdf|pdf-vector|both`。

## 7. 压缩包文件

```text
启动高清截图.bat            Windows 双击启动，自动检查/安装 Node 依赖
打开截图目录.bat            一键打开保存目录
hd-screenshot-assistant.js  高清截图核心
package.json / package-lock.json  依赖与版本锁定
crop-hd-screenshot.py       可选的已有图片离线裁剪工具
README.md                   使用说明
.gitignore                  避免误打包依赖和输出内容
```

### 改进及检查

- 启动网址改为**每次可输入**，瞳序只作为空输入时的默认值。
- 修复 IP+端口在未写协议时被错误识别为 HTTPS 的问题。
- 优先调用系统 Chrome、Edge，免下载独立 Chromium；首次自动安装 npm 依赖。
- PDF 导出分为「截图快照」和「真实打印」，避免错误宣传打印 PDF 与屏幕完全一致。
- 选区截图在网站页内直接执行，工具条截图时自动隐藏。
- 限制超大图片尺寸，防止高倍率长页面导致内存耗尽。
- 截图文件带时间戳，不覆盖先前的文件。
- 保存登录状态在 Windows 用户目录，避免工具转发时混入登录凭据。
- 已加入浏览器 E2E 回归，覆盖当前屏、框选、连续截图、页面刷新、PDF 以及 PDF 之后继续截图；由 Windows GitHub Actions 自动运行。
- 交互模式自适应当前显示器的真实视口；使用 CDP 截图倍率输出高清图，不把可见浏览器窗口改成虚拟的大尺寸。
- 框选区域换算为网页文档坐标后截图，页面滚动时仍与指针选择位置一致。
- **Windows BAT 的实际双击启动仍以用户系统环境为准**。

## GitHub 克隆安装

```powershell
git clone https://github.com/dcdy111/hd-web-screenshot-assistant.git
cd hd-web-screenshot-assistant
```

之后双击 `启动高清截图.bat` 即可。命令行也可以执行 `npm ci`、`npm run check` 检查基本运行环境。仓库内不含实际网站账号、密码、Cookie、页面截图或浏览器用户配置。

> 注意：`package.json` 中的 `private: true` 只表示禁止误发到 npm 注册表，**不会影响 GitHub 仓库公开可见**。代码公开不代表获得外部网页的截图使用许可，发布截图时仍应遵守网站授权和隐私要求。
