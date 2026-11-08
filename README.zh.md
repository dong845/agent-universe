# Agent Universe · 智能体宇宙

[English](README.md)

把你用 Claude Code 和 Codex 做过的事，画成一个会随之生长的宇宙。全部从你电脑上的日志读出来，只在本机显示。

- **两颗恒星**：Claude Code 和 Codex。每完成一件成品，恒星的戴森壳就亮一片。
- **行星是项目**（和技能公会），成品越多越大。点一颗飞过去、进城：方楼是成品和各类工作，**大头小机器人**是正在干活的代理——主代理和它派出的子代理。
- **代理**：脸上的表情说明它在做什么（专注、思考、等你、出错、完成）；子代理手里拿着它这类工作的工具；点一个，镜头就跟着它，卡片告诉你它此刻在做什么。
- **需要你**：在等你的会话——可能在等授权、出错停止、本轮完成——配合 macOS 通知和一键复制恢复命令。可选的 hook 让授权提醒更准确。
- **历史**：把一个城市的请求排成一步步；选一步，城市停在那次请求完成的那一刻，说明全部来自日志。
- **小窗**：一个总在最前面的小窗口（Chrome/Edge），谁在干活、谁在等你，一眼看到。
- **回顾海报**：把近 7 / 30 / 365 天或全部时间做成一张可以分享的图。
- **分享**：把一次重放录成 MP4/GIF，或把整个世界导出成一个离线 HTML 页面。默认保留项目名、隐藏请求标题，永远不含路径和会话编号。
- **中文 / English**：跟随浏览器语言，右上角按钮切换。可选提示音；页面开着时达成里程碑会有小小的庆祝。第一次打开有引导。

## 开始

需要 **Node 22.18 或更新**（从 nodejs.org 下载），macOS 或 Linux。

```
npx agent-universe
```

在 http://127.0.0.1:5182/ 启动并打开浏览器（页面已经构建好，不需要编译）。在 Claude Code 里也可以装插件，之后输入 `/agent-universe` 打开：

```
/plugin marketplace add dong845/agent-universe-plugin
/plugin install agent-universe@agent-universe
```

从源码运行：

```
git clone <这个仓库> agent-universe
cd agent-universe
npm start
```

第一次运行会安装依赖（用 Node 自带 corepack 里的 pnpm）并构建网页，然后在 http://127.0.0.1:5182/ 启动服务并打开浏览器。还没有日志时会看到一个演示世界，以及 Agent Universe 从哪里读日志：`~/.claude/projects`（Claude Code）和 `~/.codex/sessions`（Codex）。选项：`npx agent-universe --port 5190 --no-open`（从源码：`npm start -- --port 5190 --no-open`）。

服务只监听 127.0.0.1，不向任何地方发送数据。它自己的文件在 `~/.agent-town/`（缓存、设置、分享用的密钥、下载的标志）。

## 官方标志

Claude 和 OpenAI 的标志不在这个仓库里，它们属于 Anthropic 和 OpenAI。在设置（⚙）里打开「官方标志（仅本机显示）」，会从 Wikimedia Commons 下载到 `~/.agent-town/logos/`，只在你的电脑上显示。没有它们时，以及所有导出的内容里，页面用自己的中性标志。

## 开发

```
node --run dev        # Vite 开发服务器，端口 5180（/api 转发到 5182）
node --run serve      # 只启动本地服务
node --run test       # 单元测试（vitest）
node --run e2e        # 浏览器测试，用已安装的 Chrome（需要开发服务器和一次构建）
```

设计和决定：[docs/decisions.md](docs/decisions.md)；日志格式：[docs/log-formats.md](docs/log-formats.md)；规格和计划在 `docs/superpowers/` 下。
