# JSON 三方合并台

一个纯本地的 JSON 三方合并工具（React + TypeScript + Vite）。粘贴或导入**基线（Base）**、**当前分支（Ours）**、**目标分支（Theirs）**三份 JSON，按 JSON Pointer 递归执行三方合并，在树形视图中定位并解决冲突，最终导出合并 JSON 与相对基线的 RFC 6902 补丁。

## 快速启动（Docker Compose，一条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

停止：`docker compose down`

## 本地开发

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产构建（输出 dist/）
npm run preview    # 预览生产构建 http://localhost:4173
npm test           # 运行合并逻辑单元测试（vitest）
```

## 操作方法

1. **输入三份 JSON**：在三个面板中分别粘贴或点击「导入文件」选择 `.json` 文件；可点击「加载示例数据」快速体验。点击「开始合并」。
2. **解决冲突**：
   - 左侧合并树按 JSON Pointer 层级展示合并结果，冲突节点以红色标出，点击即可定位；
   - 右侧面板显示冲突的三方值（基线 / 当前 / 目标）与冲突原因，可选择「采用当前分支」「采用目标分支」，或填写自定义 JSON 值；
   - 顶部进度条显示已解决数量，全部解决后「生成合并结果」按钮可用。
3. **导出结果**：查看合并后的 JSON（可折叠树形视图）与相对基线的 RFC 6902 JSON Patch，支持一键复制或下载为 `merged.json` / `patch.json`。

### JSON Schema 约束校验（输出阶段入口）

在第 3 步「导出结果」页面顶部可对合并结果做 **Draft 2020-12 JSON Schema** 约束校验（基于 [Ajv](https://ajv.js.org/)，默认开启，可随时关闭）：

- **输入 / 导入 Schema**：在「JSON Schema 校验」面板中粘贴 Schema 文本，或点击「导入 Schema 文件」选择 `.json` 文件；输入后自动编译（300ms 防抖），编译成功后面板自动收起，状态栏显示「✓ 校验通过」。
- **错误分组与定位**：校验错误按 `instancePath`（JSON Pointer）分组展示，每组列出命中的**关键字**（如 `required`、`type`、`minimum`）、Ajv 校验消息与**关键字参数**（如 `missingProperty=name`、`limit=0`），并以小字附带 `schemaPath`。点击路径按钮（📍）会自动展开合并结果树、滚动并高亮对应的值。
- **支持本地 `$ref`**：`#/json/pointer` 与 `#anchor` 两种片段形式均可解析（正确处理嵌套 `$id` 资源作用域）。Schema JSON 解析失败、Schema 本身不合法，或包含无法解析的本地 `$ref` 时，会显示带**引用位置**的明确错误，且**不会覆盖上一次有效 Schema**——校验继续沿用旧 Schema，直到新 Schema 编译成功。
- **可关闭**：取消勾选即完全停用校验（已输入的 Schema 文本会保留）。
- **不阻断下载**：校验开启且存在错误时，「下载 merged.json」按钮旁会出现红色错误数警示，结果面板标题与顶部状态栏同步提示，但**仍可正常下载**结果文件。

## 合并规则

按 JSON Pointer 逐节点递归比较三方：

| 情况 | 结果 |
| --- | --- |
| 仅一侧相对基线变化 | 采用变化的一侧 |
| 双方改成相同的值（含都删除） | 采用一次 |
| 双方改成不同的值 | **冲突** |
| 一侧删除、另一侧修改 | **冲突** |

- 只有**对象**会按键递归合并；**数组和标量均按单个值整体处理**（双方改同一数组即冲突）。
- 双方新增的对象会按键递归合并；一方删除、另一方修改对象时整体记为冲突。
- 冲突解决方式：采用当前分支 / 采用目标分支 / 自定义 JSON 值（可表示删除以外的任意值）。

## 输出说明

- **合并结果 JSON**：应用所有自动合并与冲突解决后的完整文档，以可折叠 JSON 树展示；点击 Schema 错误的 JSON Pointer 可定位到对应值。
- **RFC 6902 补丁**：`基线 → 合并结果` 的 JSON Patch（`add` / `remove` / `replace`），路径按 RFC 6901 转义（`~` → `~0`，`/` → `~1`）。
- **Schema 校验**：Draft 2020-12，可选开关；错误不阻断导出，仅在下载旁警示错误数。

## 项目结构

```
src/
├── merge/                      # 与 UI 无关的核心逻辑
│   ├── threeWayMerge.ts        # 三方合并（生成合并树 + 冲突列表）
│   ├── rfc6902.ts              # 基线 → 结果的 JSON Patch 生成
│   ├── schemaValidation.ts     # Ajv 编译/校验、本地 $ref 预检、错误分组
│   ├── pointer.ts              # RFC 6901 JSON Pointer 工具
│   ├── deepEqual.ts            # 键序无关的深比较
│   ├── merge.test.ts           # 合并/patch 单元测试
│   └── schemaValidation.test.ts
├── components/                 # 输入 / 合并树 / 冲突面板 / 输出 等界面组件
│   ├── OutputStage.tsx         # 输出阶段：Schema 输入、校验、错误分组与下载警示
│   └── JsonTreeView.tsx        # 可按 JSON Pointer 定位高亮的 JSON 树视图
└── App.tsx                     # 三阶段流程编排
```
