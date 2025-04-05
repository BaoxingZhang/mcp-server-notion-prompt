# Notion Prompts MCP Server

这是一个使用 Model Context Protocol (MCP) 标准的服务器，它提供对存储在 Notion 数据库中的提示词的访问。

## 功能特点

- **提示词资源列表**：以 MCP 资源形式提供所有可用提示词
- **提示词读取**：通过 ID 或名称读取单个提示词
- **提示词组合**：将用户输入与提示词模板组合
- **类别管理**：支持按类别分组和查询提示词
- **搜索功能**：支持在名称、描述和内容中搜索提示词
- **缓存系统**：内置缓存机制，优化性能，减少 API 调用
- **可配置**：支持通过环境变量或命令行参数进行配置

## 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/mcp-server-notion-prompt.git
cd mcp-server-notion-prompt

# 安装依赖
npm install

# 构建项目
npm run build
```

## 配置

服务器需要以下配置：

- **NOTION_API_KEY**: 你的 Notion API 密钥
- **NOTION_DATABASE_ID**: 存储提示词的 Notion 数据库 ID

可以通过环境变量或命令行参数提供：

```bash
# 使用环境变量
export NOTION_API_KEY="your_api_key_here"
export NOTION_DATABASE_ID="your_database_id_here"
export LOG_LEVEL="INFO"  # 可选，默认为 INFO
export CACHE_EXPIRY_TIME="300000"  # 可选，默认为 5 分钟 (300000ms)

# 启动服务器
npm start

# 或使用命令行参数
npm start -- --notion_api_key=your_api_key_here --notion_database_id=your_database_id_here --log_level=INFO
```

## Notion 数据库结构

Notion 数据库应包含以下属性：

- **Name** (标题): 提示词名称
- **Content** (富文本): 提示词内容，可以包含 `{{USER_INPUT}}` 占位符
- **Description** (富文本): 提示词描述
- **Category** (选择): 提示词类别

## 提示词变量

在提示词内容中，你可以使用以下变量：

- `{{USER_INPUT}}`: 将被用户输入替换
- `{{CURRENT_DATE}}`: 当前日期
- `{{CURRENT_TIME}}`: 当前时间
- `{{CURRENT_DATETIME}}`: 当前日期和时间
- `{{PROMPT_NAME}}`: 提示词名称

## MCP 工具

该服务器提供以下 MCP 工具：

1. **list_prompts**: 列出所有可用的提示词
2. **get_prompt_by_name**: 通过名称获取提示词
3. **compose_prompt**: 将用户输入整合到提示词模板中
4. **refresh_prompts**: 刷新提示词缓存
5. **get_prompts_by_category**: 获取特定类别的提示词
6. **search_prompts**: 搜索提示词（名称、描述和内容）
7. **list_categories**: 列出所有可用的提示词类别

## 开发

```bash
# 运行开发版本
npm run dev

# 构建
npm run build

# 运行测试
npm test
```

## 许可证

MIT