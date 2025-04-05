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
import { NotionService, Prompt, PromptInfo } from "./notion.js";

/**
 * 解析命令行参数
 * 
 * 示例：node index.js --notion_api_key=ntn_2966754545xxx --notion_database_id=1cc6e852d16e80218xxx
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

const args = parseArgs();
const NOTION_API_KEY = args.notion_api_key || process.env.NOTION_API_KEY || "";
const NOTION_DATABASE_ID = args.notion_database_id || process.env.NOTION_DATABASE_ID || "";

// Initialize Notion service
const notionService = new NotionService(NOTION_API_KEY, NOTION_DATABASE_ID);

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
    
    default:
      throw new Error("未知工具");
  }
});

/**
 * Start the server using stdio transport
 */
async function main() {
  process.stderr.write("[MCP] Notion提示词MCP服务器正在启动...\n");
  
  try {
    // 启动时预热缓存
    await notionService.getPrompts();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    process.stderr.write("[MCP] Notion提示词MCP服务器已启动并连接\n");
  } catch (error) {
    process.stderr.write(`[MCP] 服务器启动失败: ${error}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`服务器错误: ${error}\n`);
  process.exit(1);
});
