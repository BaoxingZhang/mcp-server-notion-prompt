import { Client } from "@notionhq/client";

// Type definition for prompts
export type Prompt = {
  id: string;
  name: string;
  content: string;
  description: string;
  category?: string;
};

// 简化的提示词信息，用于列表展示
export type PromptInfo = {
  id: string;
  name: string;
  description: string;
  category?: string;
};

export class NotionService {
  private notion: Client;
  private databaseId: string;
  private promptsCache: Prompt[] | null = null;
  private lastCacheTime: number = 0;
  private readonly cacheExpiryTime: number = 5 * 60 * 1000; // 5分钟的缓存过期时间

  constructor(apiKey: string, databaseId: string) {
    this.notion = new Client({ auth: apiKey });
    this.databaseId = databaseId;
  }

  /**
   * 检查缓存是否可用
   */
  private isCacheValid(): boolean {
    return (
      this.promptsCache !== null && 
      Date.now() - this.lastCacheTime < this.cacheExpiryTime
    );
  }

  /**
   * 清除缓存，强制下次请求重新获取数据
   */
  public clearCache(): void {
    process.stderr.write("[MCP] 正在清除提示词缓存\n");
    this.promptsCache = null;
    this.lastCacheTime = 0;
  }

  /**
   * 刷新缓存，立即从Notion获取最新数据
   */
  public async refreshCache(): Promise<Prompt[]> {
    process.stderr.write("[MCP] 正在刷新提示词缓存\n");
    this.promptsCache = null;
    return this.getPrompts();
  }

  /**
   * 获取提示词，优先使用缓存
   */
  public async getPrompts(): Promise<Prompt[]> {
    if (this.isCacheValid()) {
      process.stderr.write(`[MCP] 使用缓存的提示词数据 (${this.promptsCache!.length}个)\n`);
      return this.promptsCache!;
    }
    
    return this.fetchPrompts();
  }

  /**
   * Fetch all prompts from Notion database
   */
  async fetchPrompts(): Promise<Prompt[]> {
    process.stderr.write("[MCP] 从Notion获取提示词数据\n");
    
    try {
      const response = await this.notion.databases.query({
        database_id: this.databaseId,
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
      
      // 更新缓存
      this.promptsCache = prompts;
      this.lastCacheTime = Date.now();
      
      process.stderr.write(`[MCP] 已获取 ${prompts.length} 个提示词并更新缓存\n`);
      return prompts;
    } catch (error) {
      process.stderr.write(`[MCP] 获取Notion数据库时出错: ${error}\n`);
      throw new Error("无法从Notion获取提示词");
    }
  }

  /**
   * 通过名称查找提示词
   */
  async findPromptByName(name: string): Promise<Prompt | null> {
    process.stderr.write(`[MCP] 正在查找提示词: "${name}"\n`);
    
    const prompts = await this.getPrompts();
    const prompt = prompts.find(p => p.name === name);
    
    if (!prompt) {
      process.stderr.write(`[MCP] 未找到提示词: "${name}"\n`);
      return null;
    }
    
    process.stderr.write(`[MCP] 找到提示词: "${name}"\n`);
    return prompt;
  }
  
  /**
   * 通过ID查找提示词
   */
  async findPromptById(id: string): Promise<Prompt | null> {
    process.stderr.write(`[MCP] 正在查找提示词 ID: ${id}\n`);
    
    const prompts = await this.getPrompts();
    const prompt = prompts.find(p => p.id === id);
    
    if (!prompt) {
      process.stderr.write(`[MCP] 未找到ID为 ${id} 的提示词\n`);
      return null;
    }
    
    return prompt;
  }
  
  /**
   * 将用户输入与提示词模板组合
   */
  async composePrompt(promptName: string, userInput: string): Promise<string | null> {
    if (!promptName || !userInput) {
      process.stderr.write(`[MCP] 错误: 必须提供提示词名称和用户输入\n`);
      return null;
    }
    
    const prompt = await this.findPromptByName(promptName);
    
    if (!prompt) {
      return null;
    }
    
    // 替换用户输入到模板中
    const finalPrompt = prompt.content.replace('{{USER_INPUT}}', userInput);
    
    process.stderr.write(`[MCP] 成功组合提示词，长度: ${finalPrompt.length}字符\n`);
    return finalPrompt;
  }
  
  /**
   * 获取简化的提示词列表信息
   */
  async getPromptList(): Promise<PromptInfo[]> {
    try {
      const prompts = await this.getPrompts();
      return prompts.map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        category: prompt.category
      }));
    } catch (error) {
      process.stderr.write(`[MCP] 获取提示词列表时出错: ${error}\n`);
      throw error;
    }
  }
} 