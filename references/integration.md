# 集成与部署边界

## 组件关系

- OpenClaw 工具负责接收用户参数，只暴露一个端到端的 `generate_weekly_report` 周报工具。
- Bridge 负责选择周日期、读取飞书、同步数据库、调用整理服务、渲染 HTML 和发送邮件。
- 整理服务负责逐行提炼、亮点选择、风险和下周重点。
- 渲染器只负责转义、稳定排序和填充模板，不应删除业务行。

## 配置

以下信息只能通过环境变量或密钥管理提供，不能提交到仓库：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_SPREADSHEET_TOKEN`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `WEEKLY_REPORT_AI_MODEL`
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`
- 数据库连接信息

内部飞书文档和看板链接也应配置化，例如 `WEEKLY_REPORT_SOURCE_URL` 与 `WEEKLY_REPORT_DASHBOARD_URL`。

## 防止重复发送

一次用户请求只能调用一个端到端工具。邮件发送端还应使用持久化幂等键，例如“收件人规范化值 + 周日期”，不要依赖可变化的邮件主题。只有 SMTP 发送失败时才释放发送资格；重启后幂等记录仍应保留。

自动化验证只测试生成结果和幂等判定，不发送真实邮件。真实邮件测试必须由用户明确授权并指定收件人。

## 部署

线上更新前创建带时间戳的备份。部署后应编译、重启网关并确认服务状态正常，再进行不发邮件的生成验证。回滚时恢复同一批备份中的服务、渲染器、模板和 OpenClaw 工具，避免版本不一致。
