# 构建与发布

本目录是源码、测试和版本号的唯一维护入口。公开仓库：https://github.com/LimitedMouse/bangumi-quick-mark。

## 日常修改

1. 修改 `src/`，维护相关测试；用户脚本是构建产物，不直接编辑。
2. 版本只修改 `package.json`；`npm run build` 自动同步用户脚本和安装页版本。
3. 运行 `npm run build`、`npm run check`、`npm test`。测试会自动管理独立浏览器会话，使用模拟站点，不提交真实收藏。
4. 检查 `git diff --check`、源码差异及截图，确认文档与最终行为一致。

## 本地打包

执行 `npm run package`，在 `.local/release/bangumi-quick-mark-<版本>/` 生成安装文件与 `source/` 源码快照。源码快照包含同一份包元数据、构建工具、测试和文档，可以重新构建验证；不包含 Git 历史、本地浏览器数据、历史工作副本或个人备份。

无需为每次打包克隆公开仓库，不再维护另一份 package.json，也不要修改源码快照后反向复制。

## GitHub 发布

推送或创建 Release 仅在用户明确要求时进行。

当前目录作为统一开发与发布工作目录，`origin` 指向公开仓库，`main` 基于公开历史正常提交与推送。历史本地 `master` 保留在 `backup/local-master-before-publish` 分支，历史工作副本保留在 `.local/archive/`，不参与发布。不得直接强制推送或擅自替换公开历史，也不要每次发布再创建一个新的仓库副本。

创建同版本 Release 时上传用户脚本与安装包，核对安装页 `releases/latest` 下载链接、版本及文件内容。Tampermonkey / Violentmonkey 的实际安装需要单独验证，浏览器注入测试不替代管理器安装验证。

## 本地产物

- `.local/test/`：自动化测试脚本、日志、截图及浏览器会话产物。
- `.local/browser/`：主动调试注入所需的临时文件。
- `.local/release/`：可重新生成的安装包与源码快照。
- `.local/archive/2026-10-12/`：历史 output、release、intro 和 Playwright 产物，完整保留旧仓库 Git 历史及未提交修改。

归档中的 `output/public-repo` 有未提交的新功能文件，恢复这些修改前应单独检查。归档不参与测试、构建或发布，不能直接作为当前源码使用。
