#!/usr/bin/env node

/**
 * Notion Prompts MCP Server
 * 
 * This server provides access to prompts stored in a Notion database.
 * It allows:
 * - Listing available prompts as resources
 * - Reading individual prompts
 * - Composing final prompts by combining templates with user input
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { NotionService, Prompt, PromptInfo, LogLevel } from "./notion.js";

/**
 * 配置接口定义
 */
interface ServerConfig {
  notionApiKey: string;
  notionDatabaseId: string;
  logLevel: LogLevel;
  cacheExpiryTime?: number;
}

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args: Record<string, string> = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      args[key] = value;
    }
  });
  return args;
}

/**
 * 获取服务器配置
 */
function getServerConfig(): ServerConfig {
  const args = parseArgs();
  
  // 从环境变量或命令行参数加载配置
  const config: ServerConfig = {
    notionApiKey: args.notion_api_key || process.env.NOTION_API_KEY || "",
    notionDatabaseId: args.notion_database_id || process.env.NOTION_DATABASE_ID || "",
    logLevel: (args.log_level || process.env.LOG_LEVEL || "INFO") as LogLevel,
  };
  
  // 可选配置项
  if (args.cache_expiry_time || process.env.CACHE_EXPIRY_TIME) {
    config.cacheExpiryTime = parseInt(args.cache_expiry_time || process.env.CACHE_EXPIRY_TIME || "300000", 10);
  }
  
  // 验证必要的配置
  if (!config.notionApiKey) {
    throw new Error("必须提供Notion API密钥 (通过 --notion_api_key 参数或 NOTION_API_KEY 环境变量)");
  }
  
  if (!config.notionDatabaseId) {
    throw new Error("必须提供Notion数据库ID (通过 --notion_database_id 参数或 NOTION_DATABASE_ID 环境变量)");
  }
  
  return config;
}

/**
 * 记录日志到stderr
 */
function log(level: string, message: string): void {
  process.stderr.write(`[MCP] ${level}: ${message}\n`);
}

// Initialize Notion service
let notionService: NotionService;

/**
 * Create an MCP server with capabilities for resources and tools
 */
const server = new Server(
  {
    name: "notion-prompts-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * 初始化服务器配置和服务
 */
function initializeServer() {
  try {
    const config = getServerConfig();
    
    // 初始化Notion服务
    notionService = new NotionService(
      config.notionApiKey, 
      config.notionDatabaseId, 
      config.logLevel
    );
    
    if (config.cacheExpiryTime) {
      // 设置缓存过期时间 (如果提供了)
      notionService.setCacheExpiryTime(config.cacheExpiryTime);
    }
    
    log("INFO", "服务初始化完成");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", `服务初始化失败: ${message}`);
    process.exit(1);
  }
}

/**
 * Handler for listing available prompts as resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const prompts = await notionService.getPrompts();
  
  return {
    resources: prompts.map(prompt => ({
      uri: `notion-prompt:///${prompt.id}`,
      mimeType: "text/plain",
      name: prompt.name,
      description: prompt.description || `提示词: ${prompt.name}`
    }))
  };
});

/**
 * Handler for reading a specific prompt
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, '');
  
  const prompt = await notionService.findPromptById(id);
  
  if (!prompt) {
    throw new Error(`未找到ID为 ${id} 的提示词`);
  }
  
  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: prompt.content
    }]
  };
});

/**
 * Handler that lists available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_prompts",
        description: "列出所有可用的提示词",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_prompt_by_name",
        description: "通过名称获取提示词",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "提示词名称"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "compose_prompt",
        description: "将用户输入整合到提示词模板中",
        inputSchema: {
          type: "object",
          properties: {
            promptName: {
              type: "string",
              description: "提示词名称"
            },
            userInput: {
              type: "string",
              description: "用户输入内容"
            }
          },
          required: ["promptName", "userInput"]
        }
      },
      {
        name: "refresh_prompts",
        description: "刷新提示词缓存",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_prompts_by_category",
        description: "获取特定类别的提示词",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "提示词类别"
            }
          },
          required: ["category"]
        }
      },
      {
        name: "search_prompts",
        description: "搜索提示词（名称、描述和内容）",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "list_categories",
        description: "列出所有可用的提示词类别",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_paginated_prompts",
        description: "获取分页的提示词列表",
        inputSchema: {
          type: "object",
          properties: {
            page: {
              type: "number",
              description: "页码（从1开始）"
            },
            pageSize: {
              type: "number",
              description: "每页数量"
            }
          },
          required: ["page", "pageSize"]
        }
      }
    ]
  };
});

/**
 * Handler for the tools
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "get_prompt_by_name": {
      const name = String(request.params.arguments?.name);
      process.stderr.write(`[MCP] 工具调用: get_prompt_by_name "${name}"\n`);
      
      const prompt = await notionService.findPromptByName(name);
      
      if (!prompt) {
        return {
          content: [{
            type: "text",
            text: `错误: 未找到名为 "${name}" 的提示词`
          }]
        };
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: prompt.id,
            name: prompt.name,
            content: prompt.content,
            description: prompt.description,
            category: prompt.category
          }, null, 2)
        }]
      };
    }
    
    case "compose_prompt": {
      const promptName = String(request.params.arguments?.promptName);
      const userInput = String(request.params.arguments?.userInput);
      
      process.stderr.write(`[MCP] 工具调用: compose_prompt "${promptName}", 用户输入: "${userInput.substring(0, 30)}${userInput.length > 30 ? '...' : ''}"\n`);
      
      const finalPrompt = await notionService.composePrompt(promptName, userInput);
      
      if (!finalPrompt) {
        return {
          content: [{
            type: "text",
            text: `错误: 未找到名为 "${promptName}" 的提示词`
          }]
        };
      }
      
      return {
        content: [{
          type: "text",
          text: finalPrompt
        }]
      };
    }
    
    case "refresh_prompts": {
      process.stderr.write(`[MCP] 工具调用: refresh_prompts\n`);
      
      try {
        const prompts = await notionService.refreshCache();
        return {
          content: [{
            type: "text",
            text: `提示词数据已刷新，共加载 ${prompts.length} 个提示词`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `刷新提示词时出错: ${error}`
          }]
        };
      }
    }
    
    case "list_prompts": {
      process.stderr.write(`[MCP] 工具调用: list_prompts\n`);
      
      try {
        const promptList = await notionService.getPromptList();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(promptList, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `获取提示词列表时出错: ${error}`
          }]
        };
      }
    }
    
    case "get_prompts_by_category": {
      const category = String(request.params.arguments?.category);
      log("INFO", `工具调用: get_prompts_by_category "${category}"`);
      
      try {
        const prompts = await notionService.getPrompts();
        const filteredPrompts = prompts
          .filter(p => p.category === category)
          .map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            category: p.category
          }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(filteredPrompts, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `获取类别提示词时出错: ${message}`
          }]
        };
      }
    }
    
    case "search_prompts": {
      const query = String(request.params.arguments?.query).toLowerCase();
      log("INFO", `工具调用: search_prompts "${query}"`);
      
      try {
        const prompts = await notionService.getPrompts();
        const searchResults = prompts
          .filter(p => 
            p.name.toLowerCase().includes(query) || 
            p.description.toLowerCase().includes(query) || 
            p.content.toLowerCase().includes(query)
          )
          .map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            category: p.category,
            matchType: p.name.toLowerCase().includes(query) 
              ? "name" 
              : p.description.toLowerCase().includes(query) 
                ? "description" 
                : "content"
          }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(searchResults, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `搜索提示词时出错: ${message}`
          }]
        };
      }
    }
    
    case "list_categories": {
      log("INFO", `工具调用: list_categories`);
      
      try {
        const prompts = await notionService.getPrompts();
        // 获取所有类别并去重
        const categories = [...new Set(prompts
          .map(p => p.category)
          .filter(c => c !== undefined && c !== null && c !== "")
        )];
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(categories, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `获取类别列表时出错: ${message}`
          }]
        };
      }
    }
    
    case "get_paginated_prompts": {
      const page = Number(request.params.arguments?.page) || 1;
      const pageSize = Number(request.params.arguments?.pageSize) || 10;
      
      log("INFO", `工具调用: get_paginated_prompts, 页码: ${page}, 每页数量: ${pageSize}`);
      
      try {
        const result = await notionService.getPaginatedPrompts({ page, pageSize });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text",
            text: `获取分页提示词时出错: ${message}`
          }]
        };
      }
    }
    
    default:
      throw new Error("未知工具");
  }
});

/**
 * Start the server using stdio transport
 */
async function main() {
  log("INFO", "Notion提示词MCP服务器正在启动...");
  
  try {
    // 初始化服务器
    initializeServer();
    
    // 启动时预热缓存
    await notionService.getPrompts();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    log("INFO", "Notion提示词MCP服务器已启动并连接");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log("ERROR", `服务器启动失败: ${errorMsg}`);
    process.exit(1);
  }
}

main().catch((error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  log("ERROR", `服务器错误: ${errorMsg}`);
  process.exit(1);
});
