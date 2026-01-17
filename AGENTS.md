# 仓库指南

## 项目结构与模块组织

- `index.html`：应用外壳与布局；页面元素 `id` 需与 `src/app.js` 中查询一致。
- `src/app.js`：主入口（Vite）。使用 `pdfjs-dist` 加载/渲染 PDF，并管理字符框的点击/拖拽选中。
- `src/style.css`：Tailwind 入口（`@tailwind …`）与少量自定义层（`@layer base/components/utilities`）。
- `tailwind.config.cjs`、`postcss.config.cjs`：样式构建配置。
- `package.json`、`yarn.lock`：依赖与脚本（默认使用 Yarn）。

## 构建、测试与本地开发命令

- `yarn install`：安装依赖。
- `yarn dev`：启动本地开发服务器（Vite）。
- `yarn build`：产物构建到 `dist/`。
- `yarn preview`：本地预览 `dist/`，用于验证生产构建。
- （可选）`yarn dev -- --host`：在局域网暴露服务，便于移动端/其他设备联调。

如使用 npm：`npm install` + `npm run dev|build|preview`。

## 编码风格与命名约定

- 缩进：HTML/CSS/JS 统一 2 空格。
- JavaScript：优先 `const`、早返回、分号、双引号（保持 `src/app.js` 风格一致）。
- DOM 绑定：重构时保持 `index.html` 的 `id` 稳定（`file-input`、`clear-btn`、`viewer`、`selection-panel`）。
- CSS：优先 Tailwind utility；可复用样式用 `@apply`（如 `.page`、`.overlay`、`.box`）。

## 测试指南

目前未配置自动化测试。建议最小人工回归：
- `yarn dev` 启动后加载示例 PDF；验证点击选中、拖拽框选、窗口缩放触发重渲染。
- 观察多页懒渲染：向下滚动确认占位页进入视口后再渲染。

## 提交与 PR 指南

- 当前工作区无 Git 历史可参考；建议采用 Conventional Commits（如 `feat(viewer): 支持多页选择`）。
- PR 需包含：改动说明、UI 截图/录屏（如涉及界面）、“人工验证清单”。
- 避免提交真实/敏感 PDF；使用合成样例。不要提交 `node_modules/` 或 `dist/`（初始化 Git 时加入 `.gitignore`）。

## 运行与调试提示

- 选中逻辑：点击与拖拽依赖 `.box` 的 `dataset`（`page`/`index`/`bbox`），修改结构后需同步更新读写。
- 性能：页面采用 `IntersectionObserver` 懒渲染；若调整容器滚动区域，确认 `root: viewer` 仍正确。

## 安全与配置提示

- 将 PDF 视为不可信输入，避免默认引入上传/分享等行为。
- 保持 `pdfjs-dist` 的 worker 引入方式（`pdf.worker?worker`）；升级依赖后务必复测渲染与选中逻辑。
