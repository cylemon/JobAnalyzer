# 演示模式（GitHub Pages 静态站）

本工具是**单机应用**：后端是 Node 进程，数据在本地 SQLite 文件里。而 GitHub Pages 只能托管
静态文件，不跑任何进程。于是「给个链接就能点开看」这件事，靠的是把整个后端**搬进浏览器**：

```
        本地运行                                  演示站（GitHub Pages）
┌──────────────────────────┐            ┌──────────────────────────────────┐
│ web/    React 前端        │            │ web/    React 前端（同一份）        │
│ server/ Hono 路由与业务    │            │ server/ Hono 路由与业务（同一份）    │
│         ↓ better-sqlite3 │            │         ↓ sql.js（WASM 版 SQLite） │
│         ↓ HTTP 调模型 API │            │         ↓ 预置实现（demo/llm.ts）  │
│ data/jobanalyzer.db      │            │ 快照随产物一起发（demo/snapshot/）   │
└──────────────────────────┘            └──────────────────────────────────┘
```

**换的是宿主，不是逻辑。** 路由、服务、契约校验、界面全部是同一份代码；
演示构建只在 `vite.config.ts` 里替换三个模块（见下文）。所以演示站里能点到的东西，
就是本机版真的会做的事 —— 包括筛选排序、匹配计算、缺口统计这些跑在"服务端"的逻辑。

## 一句话概括每个文件

| 文件 | 作用 |
| --- | --- |
| `export-snapshot.ts` | 把本地 `data/jobanalyzer.db` 导出一份干净快照（会先 checkpoint WAL）。`npm run demo:snapshot` |
| `snapshot/` | 上面导出的快照，随仓库提交；演示数据就是它 |
| `mount.ts` | 载入快照、挂载 Hono 应用、接管 `window.fetch` 上的 `/api/*` |
| `browserDb.ts` | 替换 `server/db/client.ts`：把 better-sqlite3 换成 sql.js |
| `llm.ts` | 替换 `server/llm/index.ts`：把 HTTP 调模型换成预置实现 |
| `presetExtract.ts` / `presetJudge.ts` / `presetRoadmap.ts` | 三段预置实现：按提示词的判据就地分析，产出同结构的 JSON |
| `bootstrap.ts` | 替换 `web/lib/bootstrap.ts`：前端启动时把后端挂上 |
| `shims/` | `node:fs` / `node:path` / `node:crypto` 等内置模块的浏览器替身 |
| `demoConfig.ts` | 演示站的「data/config.json」，密钥是写明假的占位串 |

`presets.test.ts` 是这部分的测试：它不检查"答得对不对"（那是主观的），
只检查**产出的东西能不能通过真实那条处理链** —— 出的 JSON 能不能被
`toJobDraft` / `parseRoadmap` 吃下去、判定有没有覆盖每一条要求。
提示词结构一改而预置实现没跟上，这里就会红。

## 演示模式与完整版的差别（页面上也有说明）

- **模型回复是预置的**：`llm.ts` 按提示词的签名句分派到 `preset*` 三段实现，用规则分析而非模型推理。
  同一份 JD 在本地跑与在演示站跑，结构一致、条目各有依据，差别只在判别力（规则比模型笨，这是明摆着的）。
- **数据在内存里**：刷新页面即恢复到快照的初始状态。这也让演示可重复。
- **备份与恢复不可用**：它们要读写本机文件，演示站没有磁盘（`shims/fs.ts` 会明确报错，不假装成功）。
  「导出全部数据」不受影响，它读的是当前这份库。

## 两个坑（都踩过，留个记录）

**1. 模块被解析成两份，状态各写各的。** `server/db/client.ts` 被替换成 `browserDb.ts` 之后，
同一个文件会有两条进入路径：一条是被替换的相对导入，另一条是 `mount.ts` 里的 `./browserDb`。
两条路解析出来的模块 id 形式不一致（分隔符、盘符大小写），Rollup 就当成了两个模块，
于是"打开数据库"写进 A 的变量、"取数据库"读的是 B 的 —— 运行起来是「库明明打开了，取的时候说没打开」。
更麻烦的是它在**构建期完全看不出来**，产物里也只是少了几行。

现在的做法是在 `vite.config.ts` 里，替换目标先走一次正常解析再返回（`canonical()`），
保证同一个文件只有一个 id。

**2. 摇树会把"看着像常量"的守卫折掉。** 上面那个 bug 的第一现场其实是这样的：
数据库句柄写成模块级 `let`、守卫写成 `if (handle === null) throw` 时，
Rollup 的摇树把赋值和 `return` 一并删掉，只留下那句 `throw` —— 因为在它看到的那个模块实例里，
这个变量确实从来没被写过，判断并不算错。**根因仍然是第 1 条。**

现在句柄放在一个 const 对象的属性里（`browserDb.ts` 的 `state`）：属性读写不参与这套常量折叠，
即使将来再冒出第二个模块实例，也不会退化成"永远打不开"这么难查的样子。

结论：**这个坑的第一症状是"构建成功、运行才报错"，所以改完 `vite.config.ts` 或
`browserDb.ts` 之后，务必真的打开页面点一遍**，不要只看构建是否通过。

## 本地跑一遍演示站

```bash
npm run demo:snapshot     # 需要本地有可用的 data/jobanalyzer.db
npm run build:demo        # 产物在 web/dist
npx serve web/dist        # 或者任何静态服务器
```

产物用的是带 `base` 的绝对路径（默认 `/JobAnalyzer/`）。要在根路径下看，
用 `JOBANALYZER_BASE=/ npm run build:demo` 再构建一次。
