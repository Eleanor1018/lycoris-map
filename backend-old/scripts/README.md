# 离线点位翻译

`translate_markers.py` 通过 `psql` 导出待翻译点位，并校验、导入填写后的 JSON 文件。首批译文由当前协作任务直接翻译，已于 2026-09-06 导入生产。没有接入外部翻译 API、GitHub Actions 或定期自动任务。

## 生产执行记录（2026-09-06）

SSH 已恢复；已创建并验证 `pg_dump` 备份，依次执行版本、语言迁移并部署新后端。首批导入 359 条公开且 `APPROVED` 点位的英文译文，`saved=359`、`changed_or_protected=0`。全库 382 条原文的校验摘要前后一致，5 条私有点位及 18 条 `REJECTED` 点位不在本批范围。

隔离 PostgreSQL 17 数据库副本和正式接口均逐条核对了 359 条中英文列表，并抽查详情语言选择、双语搜索、viewport/nearby 及匿名权限；缺译回退及私有详情限制在隔离副本验证。新源站 HTTPS 经代理访问返回 HTTP 200，当时外部 Cloudflare 域名入口仍待核对，网页、手机新界面尚未发布。本段为双语后端上线时的记录，不表示后续性能改动已部署。

上述实际库验证与下文此前的 26 项工具、67 项 Java 测试分别记录。备份、连接凭据及实际点位导出数据均不应写入仓库；下文保留后续离线操作流程。

## 准备

需要 Python 3.10+、`psql` 和已执行[双语数据库迁移](../deploy/migrations/README.md)的目标数据库。以下命令从 `backend-old/` 运行，`<private-directory>` 应替换为仓库外的受控绝对目录。导出文件可能包含用户投稿，不要把它们、数据库备份或连接凭据提交到仓库。

工具继承当前进程的 PostgreSQL 连接设置，例如 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGSSLMODE`，以及保存在仓库外的 `PGPASSFILE`。如使用 `PGPASSWORD`，只在当前受控环境中提供，不写入代码、命令示例或仓库文件。工具不会自行加载 `.env`，`psql` 使用非交互模式，连接凭据须事先配置。`--psql` 可指定 `psql` 可执行文件路径。

## 导出、填写、校验、导入

### 1. 查看待处理数量并导出

```sh
python scripts/translate_markers.py --limit 100
python scripts/translate_markers.py --export "<private-directory>/markers-pending.json" --limit 100
```

不带操作参数时只读取数据库、统计待处理记录。默认只考虑 `APPROVED` 且公开的点位，跳过哈希有效的已有译文及所有 `origin=MANUAL` 的译文。文件导出使用排他创建，不会覆盖同名文件；重新导出时使用新文件名。`--export -` 将 JSON 写入标准输出，统计写入标准错误。

`--limit` 范围为 1–500，默认 100；它限制每次导出的待处理记录数，也限制每个导入文件的记录数。若文件含 200 条，校验和导入也需传 `--limit 200`。需要更多记录时分批导出、处理。

### 2. 只填写每条记录的 `translation`

导出文件结构如下。示例中的 `sourceHash` 仅为位置说明，实际操作必须保留导出值：

```json
{
  "formatVersion": 1,
  "markers": [
    {
      "id": 123,
      "sourceLanguage": "zh",
      "targetLanguage": "en",
      "title": "无障碍诊所",
      "description": null,
      "sourceHash": "保留导出的64位哈希",
      "translation": null
    }
  ]
}
```

将 `translation: null` 替换为仅包含两个字符串字段的对象，并另存为待审核文件，例如：

```json
"translation": {
  "title": "Accessible clinic",
  "description": ""
}
```

保留 `id`、`sourceLanguage`、`targetLanguage`、原文 `title` / `description` 和 `sourceHash`。目标语言必须是源语言之外的另一种受支持语言：中文转英文，英文转中文。需要修改原文时，先通过应用正常编辑，再重新导出。

校验要求包括：

- 每条记录使用唯一的正整数 ID，原文字段与导出哈希一致。
- 译文标题非空，最多 120 个 UTF-16 单元；描述最多 20,000 个 UTF-16 单元。常见表情符号计两个单元。
- 原文描述为空或只有空白时，译文描述填写 `""`，不能增加原文没有的信息。
- 原文中的 HTTP/HTTPS URL 完整保留，不改变域名、路径或查询参数；文本不得含 NUL 字符。

### 3. 先校验文件

```sh
python scripts/translate_markers.py --import "<private-directory>/markers-translated.json" --limit 100
```

未指定 `--apply` 时为 `validate-only`：只校验本地文件，不连接或写入数据库。这一步检查格式、哈希、语言及文本限制；当前原文是否已变化、数据库记录是否仍可导入，要在实际导入时重新核对。

### 4. 备份数据库，再明确应用

```sh
pg_dump --format=custom --file="<private-directory>/before-translation-import.dump"
python scripts/translate_markers.py --import "<private-directory>/markers-translated.json" --apply --limit 100
```

只有 `--import` 与 `--apply` 同时出现才写入译文；单独使用 `--apply` 会报错。每条导入在数据库中原子检查源语言、标题、描述和当前审核、可见性，然后对 `(marker_id, language)` 执行 upsert。批次逐条提交；中途失败时，之前成功的记录可能已保存，可根据结果核对并重试，重复导入不会产生重复译文行。

输出统计中的 `validated` 是已校验的文件记录数，`saved` 是成功保存数，`changed_or_protected` 表示因源变化、权限/审核变化、记录删除或人工译文保护而跳过的数量。原文变化后应重新导出、按新原文翻译，不要修改旧文件哈希来绕过检查。

## 私有点位与人工译文

只有明确需要处理已批准的私有点位时才使用 `--include-private`，并在导出和实际导入两步都传入该参数；它不会包含未批准的点位。包含私有内容的 JSON 应放在同样受控的仓库外目录中。

主表始终保留固定 `sourceLanguage` 的原文。人工异语投稿审批或管理员编辑写入 `origin=MANUAL`；本离线导入通道写入 `origin=MACHINE`。工具会跳过已存在的 `MANUAL` 行，即使其原文哈希已经失效。人工译文应通过应用的人工编辑流程修订。

原文变化后，旧译文的哈希不再匹配，显示和搜索回退到原文；译文行仍保留。仅修改类别、开放时间、权限等元数据不会使译文哈希失效。完整语言请求规则、共享审核版本及哈希规范见[迁移说明](../deploy/migrations/README.md#数据与语言规则)。

## 验证

上线前已验证 19 项纯 Python 测试和 7 项隔离 PostgreSQL 16 测试，共 26 项工具用例；后端 67 项 Java 测试也已通过。本次 PostgreSQL 17 实际库副本和正式接口验证另见上方生产执行记录。测试命令：

```sh
python -B -m unittest discover -s scripts -p test_translate_markers.py -v
./mvnw test
```

Windows 使用 `mvnw.cmd test`。`-B` 避免生成 Python 字节码缓存。默认工具测试不连接数据库，7 项 PostgreSQL 测试会跳过。复现数据库测试时，需自行新建不挂已有卷、无公开端口的临时容器，并满足以下显式限制：

- 容器名为 `lycoris-i18n-verify-*`，标签为 `com.lycoris.test=translation-guard`。
- 测试库和测试用户均为 `marker_test`，数据库中不含真实数据。
- 环境变量 `LYCORIS_TEST_POSTGRES_CONTAINER` 指向该容器后，再运行上述 Python 测试。

测试会创建和清空该专用数据库中的测试表；完成后由创建者删除该临时容器及其匿名卷。上述 PostgreSQL 16 测试使用的隔离容器已经清理；这组测试未访问现有数据库或修改服务器。
