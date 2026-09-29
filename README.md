# SoftFactory 资产库

AI-Native 团队（SoftGenius）运行期工作区与正式产物仓库。仓库地址：`git@github.com:crowhyc/SoftFactory-AINative.git`，VPC 本机路径：`/opt/SoftFactory-AINative`。

## 目录约定

- `.multica-workspaces/`：Multica daemon 的任务运行工作目录，只作临时执行环境，**不提交**（见 `.gitignore`）。
- `artifacts/<任务号>/`：每个任务（Multica issue 号，如 `YUNZ-10`）的正式产物，由对应 agent 在此交付并提交。
  - 实现工程师：代码、数据样例、README、自测证据。
  - 独立验证工程师：`verification/verification-report.md` 与验证证据。
- `artifacts/INDEX.md`：资产总索引，由任务与流程协调员在任务收口时追加维护。

## 提交规则

- 每个 agent 只提交自己任务的 `artifacts/<任务号>/` 目录；`artifacts/INDEX.md` 仅协调员维护。
- 提交信息统一 `task(<任务号>)：<一句话说明>`。
- 推送失败时不强制覆盖、不丢弃他人提交；在原任务评论中说明并升级协调员。

## 与方法仓库的关系

- `/opt/SoftGenius`（SoftGenius）保存方法论与运行规范源稿；本仓库只保存运行期产物与工作区，二者职责分离。
