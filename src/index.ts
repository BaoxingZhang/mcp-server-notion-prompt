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
import { Client } from "@notionhq/client";

/**
 * 解析命令行参数
 * 
 * 示例：node index.js --notion_api_key=https://flomoapp.com/iwh/xxx/xxx/ --notion_database_id=https://flomoapp.com/iwh/xxx/xxx/
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

// Initialize Notion client
const notion = new Client({ auth: NOTION_API_KEY });

// Type definition for prompts
type Prompt = {
  id: string;
  name: string;
  content: string;
  description: string;
  category?: string;
};

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
 * Fetch all prompts from Notion database
 */
async function fetchPrompts(): Promise<Prompt[]> {
  process.stderr.write("[MCP] 从Notion获取提示词数据\n");
  
  try {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
    });
    
    const prompts: Prompt[] = [];
    
    for (const page of response.results) {
      try {
        // @ts-ignore - Property access needs to be more carefully typed
        const nameProperty = page.properties.Name?.title;
        // @ts-ignore
        const contentProperty = page.properties.Content?.rich_text;
        // @ts-ignore
        const descriptionProperty = page.properties.Description?.rich_text;
        // @ts-ignore
        const categoryProperty = page.properties.Category?.select;
        
        if (!nameProperty || nameProperty.length === 0) {
          continue;
        }
        
        const name = nameProperty[0].plain_text;
        const content = contentProperty?.map((text: any) => text.plain_text).join('') || '';
        const description = descriptionProperty?.map((text: any) => text.plain_text).join('') || '';
        const category = categoryProperty?.name || undefined;
        
        prompts.push({
          id: page.id,
          name,
          content,
          description,
          category,
        });
      } catch (error) {
        process.stderr.write(`[MCP] 处理提示词时出错: ${error}\n`);
      }
    }
    
    process.stderr.write(`[MCP] 已获取 ${prompts.length} 个提示词\n`);
    return prompts;
  } catch (error) {
    process.stderr.write(`[MCP] 获取Notion数据库时出错: ${error}\n`);
    throw new Error("无法从Notion获取提示词");
  }
}

/**
 * Find a prompt by name
 */
async function findPromptByName(name: string): Promise<Prompt | null> {
  process.stderr.write(`[MCP] 正在查找提示词: "${name}"\n`);
  
  const prompts = await fetchPrompts();
  const prompt = prompts.find(p => p.name === name);
  
  if (!prompt) {
    process.stderr.write(`[MCP] 未找到提示词: "${name}"\n`);
    return null;
  }
  
  process.stderr.write(`[MCP] 找到提示词: "${name}"\n`);
  return prompt;
}

/**
 * Handler for listing available prompts as resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const prompts = await fetchPrompts();
  
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
  
  process.stderr.write(`[MCP] 正在读取提示词 ID: ${id}\n`);
  
  const prompts = await fetchPrompts();
  const prompt = prompts.find(p => p.id === id);
  
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
      
      const prompt = await findPromptByName(name);
      
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
      
      if (!promptName || !userInput) {
        return {
          content: [{
            type: "text",
            text: "错误: 必须提供提示词名称和用户输入"
          }]
        };
      }
      
      const prompt = await findPromptByName(promptName);
      
      if (!prompt) {
        return {
          content: [{
            type: "text",
            text: `错误: 未找到名为 "${promptName}" 的提示词`
          }]
        };
      }
      
      // Replace placeholder with user input
      const finalPrompt = prompt.content.replace('{{USER_INPUT}}', userInput);
      
      process.stderr.write(`[MCP] 成功组合提示词，长度: ${finalPrompt.length}字符\n`);
      
      return {
        content: [{
          type: "text",
          text: finalPrompt
        }]
      };
    }
    
    case "refresh_prompts": {
      process.stderr.write(`[MCP] 工具调用: refresh_prompts\n`);
      return {
        content: [{
          type: "text",
          text: "提示词数据已刷新"
        }]
      };
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
