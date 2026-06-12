# Drillly · 408 考研做题本

面向 **408 / 考研刷题** 的本地练习工具：**PDF → LLM 解析 → 刷题 / 默写 → Markdown 导出**。可与 [Study](https://github.com/yhtttt050723) 工作台联动，也可单独克隆运行。

```
PDF 待导入 ──► LLM 拆题入库 ──► 练习页刷题 / 错题看板
                    │
                    ├── 默写单词（词林 · 随机 / 标签）
                    └── 导出 Markdown · 同步错题到 Reader
```

## 功能概览

| 模块 | 能力 |
|:---|:---|
| **刷题** | 单选 / 多选 / 代码题；PDF 批量导入；分类与标签筛选 |
| **错题** | 错题模式；错题看板；做错不自动跳题 |
| **单词** | 看中写英 / 看英写中；随机默写；词林侧边栏；Ollama 补词 |
| **统计** | 当日刷题 / 背词统计；时段会话统计（CLI，可写入学习日报） |
| **导出** | Markdown / ZIP；同步到 Study `学习资料/做题/` |

## 环境要求

- **Python** 3.11+
- **Node.js** 18+（前端）
- （可选）通义 / DeepSeek API Key；（可选）Ollama；（可选）MinGW 用于 C/C++ 代码题

## 快速开始

### 1. 克隆

```bash
git clone git@github.com:yhtttt050723/Drillly-for-11408.git
cd Drillly-for-11408
```

### 2. 启动 API

```powershell
cd api
copy .env.example .env   # 按需填写 Key
.\run.bat
```

`run.bat` 会自动创建 venv、安装依赖、写入示例题并启动服务。

### 3. 启动 Web

```powershell
cd web
npm install
npm run dev
```

| 服务 | 地址 |
|:---|:---|
| 练习页 | http://localhost:5212 |
| 导入题目 | http://localhost:5212/import |
| API 文档 | http://127.0.0.1:5213/docs |

## 目录结构

```
drillly/
├── api/                 FastAPI + SQLite
│   ├── app/             路由、服务、模型
│   ├── scripts/         种子数据、时段统计 CLI
│   ├── run.bat          一键启动 API
│   └── requirements.txt
└── web/                 Vite + React + TypeScript
    └── src/
        ├── pages/       练习、导入、设置
        └── components/  题目卡、词林、统计看板
```

## 配置

复制 `api/.env.example` → `api/.env`：

| 变量 | 说明 |
|:---|:---|
| `TONGYI_API_KEY` / `DEEPSEEK_API_KEY` | PDF 解析（不填则用 **mock**） |
| `STUDY_ROOT` | Study 工作区根目录（嵌在 Study 仓库内时可省略） |
| `LOCAL_BASE_URL` / `LOCAL_MODEL` | 本机 Ollama，用于默写中途 AI 补词 |
| `MINGW_BIN` | Windows 下 C/C++ 代码题运行路径 |

API Key 也可在 Web **设置** 页填写（持久化到 `api/data/settings.json`）。

## PDF 批量导入

1. 将 PDF 放入 Study 的 `学习资料/做题/PDF待导入/`（或自行配置 `STUDY_ROOT`）
2. 打开 **导入题目数据 → PDF 题目 → 一键处理全部**

## 默写单词 · Ollama

1. 安装 [Ollama](https://ollama.com)，拉取模型：`ollama pull qwen2.5:7b`
2. **设置** 页填写 API 地址（默认 `http://127.0.0.1:11434/v1`）与模型名
3. 练习页 **默写单词** → 随机 / 标签练习，或 **AI 中途补充** 导入新词

## 时段统计 CLI（日报附挂）

按学习时段查询 SQLite 提交记录：

```powershell
cd api
python scripts/query_session_stats.py --slot "22:10—01:07" --date 2026-06-09 --end-date 2026-06-10 --slot-label "段#1" --format both
```

## 与 Study 工作台联动

若 `drillly` 位于 Study 仓库内（`Study/drillly/`）：

```powershell
# 从 Study 根目录
.\Start-Drillly-API.bat
.\启动Study.ps1    # 一并启动 Reader / video-dash 等
```

- 导出目录：`学习资料/做题/export/`
- 错题同步：`学习资料/做题/同步错题/`
- PDF 收件箱：`学习资料/做题/PDF待导入/`

## 技术栈

- **后端**：FastAPI、SQLAlchemy、SQLite、PyMuPDF
- **前端**：React 19、Vite 6、TypeScript、KaTeX、Monaco Editor

## 许可证

个人学习项目，按需自用与二次开发。

## 仓库

https://github.com/yhtttt050723/Drillly-for-11408
