import { Client } from "@notionhq/client";

// 日志级别枚举
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

// Type definition for prompts
export type Prompt = {
  id: string;
  name: string;
  content: string;
  description: string;
  category: string[];
};

// 简化的提示词信息，用于列表展示
export type PromptInfo = {
  id: string;
  name: string;
  description: string;
  category: string[];
};

export interface PromptResponseOptions {
  processingInstruction?: "NO_FURTHER_PROCESSING_REQUIRED" | "PROCESS_WITH_CURRENT_LLM";
  description?: string;
}

export interface PromptHandlingResult {
  text: string;
  metadata?: {
    processingInstruction?: string;
    description?: string;
  };
}

export type PromptHandlingMode = "return_only" | "process_locally" | "call_external_api";

export class NotionService {
  private notion: Client;
  private databaseId: string;
  private promptsCache: Prompt[] | null = null;
  private lastCacheTime: number = 0;
  private cacheExpiryTime: number = 5 * 60 * 1000; // 5分钟的缓存过期时间
  private logLevel: LogLevel = LogLevel.INFO;
  private promptHandlingMode: PromptHandlingMode = "return_only";

  constructor(apiKey: string, databaseId: string, logLevel?: LogLevel, promptHandlingMode?: PromptHandlingMode) {
    this.notion = new Client({ auth: apiKey });
    this.databaseId = databaseId;
    if (logLevel) this.logLevel = logLevel;
    if (promptHandlingMode) this.promptHandlingMode = promptHandlingMode;
  }

  /**
   * 日志记录函数
   */
  private log(level: LogLevel, message: string): void {
    if (this.getLogLevelValue(level) <= this.getLogLevelValue(this.logLevel)) {
      process.stderr.write(`[MCP] ${level}: ${message}\n`);
    }
  }

  /**
   * 静态日志记录函数，可在其他文件使用
   */
  public static log(level: LogLevel, message: string): void {
    process.stderr.write(`[MCP] ${level}: ${message}\n`);
  }

  /**
   * 获取日志级别的数值表示
   */
  private getLogLevelValue(level: LogLevel): number {
    switch (level) {
      case LogLevel.ERROR: return 0;
      case LogLevel.WARN: return 1;
      case LogLevel.INFO: return 2;
      case LogLevel.DEBUG: return 3;
      default: return 2;
    }
  }

  /**
   * 设置日志级别
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
    this.log(LogLevel.INFO, `日志级别已设置为: ${level}`);
  }

  /**
   * 统一错误处理
   */
  private handleError(operation: string, error: any): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log(LogLevel.ERROR, `${operation}失败: ${errorMessage}`);
    throw new Error(`${operation}失败: ${errorMessage}`);
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
    this.log(LogLevel.INFO, "正在清除提示词缓存");
    this.promptsCache = null;
    this.lastCacheTime = 0;
  }

  /**
   * 刷新缓存，立即从Notion获取最新数据
   */
  public async refreshCache(): Promise<Prompt[]> {
    this.log(LogLevel.INFO, "正在刷新提示词缓存");
    this.promptsCache = null;
    return this.getPrompts();
  }

  /**
   * 获取提示词，优先使用缓存
   */
  public async getPrompts(): Promise<Prompt[]> {
    if (this.isCacheValid()) {
      this.log(LogLevel.DEBUG, `使用缓存的提示词数据 (${this.promptsCache!.length}个)`);
      return this.promptsCache!;
    }
    
    return this.fetchPrompts();
  }

  /**
   * Fetch all prompts from Notion database
   */
  async fetchPrompts(): Promise<Prompt[]> {
    this.log(LogLevel.INFO, "从Notion获取提示词数据");
    
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
          const categoryProperty = page.properties.Category?.multi_select;
          
          if (!nameProperty || nameProperty.length === 0) {
            this.log(LogLevel.WARN, `跳过无名称的提示词 (ID: ${page.id})`);
            continue;
          }
          
          const name = nameProperty[0].plain_text;
          const content = contentProperty?.map((text: any) => text.plain_text).join('') || '';
          const description = descriptionProperty?.map((text: any) => text.plain_text).join('') || '';
          
          // 处理多选类别
          let categories: string[] = [];
          if (categoryProperty && Array.isArray(categoryProperty)) {
            categories = categoryProperty.map((item: any) => item.name);
          }
          
          // 如果没有类别，添加默认类别
          if (categories.length === 0) {
            categories = ["未分类"];
          }
          
          prompts.push({
            id: page.id,
            name,
            content,
            description,
            category: categories,
          });
        } catch (error) {
          this.log(LogLevel.ERROR, `处理提示词时出错: ${error}`);
        }
      }
      
      // 更新缓存
      this.promptsCache = prompts;
      this.lastCacheTime = Date.now();
      
      this.log(LogLevel.INFO, `已获取 ${prompts.length} 个提示词并更新缓存`);
      return prompts;
    } catch (error) {
      return this.handleError("获取Notion数据库", error);
    }
  }

  /**
   * 通过名称查找提示词
   */
  async findPromptByName(name: string): Promise<Prompt | null> {
    this.log(LogLevel.INFO, `正在查找提示词: "${name}"`);
    
    const prompts = await this.getPrompts();
    const prompt = prompts.find(p => p.name === name);
    
    if (!prompt) {
      this.log(LogLevel.WARN, `未找到提示词: "${name}"`);
      return null;
    }
    
    this.log(LogLevel.DEBUG, `找到提示词: "${name}"`);
    return prompt;
  }
  
  /**
   * 通过ID查找提示词
   */
  async findPromptById(id: string): Promise<Prompt | null> {
    this.log(LogLevel.INFO, `正在查找提示词 ID: ${id}`);
    
    const prompts = await this.getPrompts();
    const prompt = prompts.find(p => p.id === id);
    
    if (!prompt) {
      this.log(LogLevel.WARN, `未找到ID为 ${id} 的提示词`);
      return null;
    }
    
    return prompt;
  }
  
  /**
   * 将用户输入与提示词模板组合
   */
  async composePrompt(promptName: string, userInput: string): Promise<string | null> {
    if (!promptName || !userInput) {
      this.log(LogLevel.ERROR, `错误: 必须提供提示词名称和用户输入`);
      return null;
    }
    
    const prompt = await this.findPromptByName(promptName);
    
    if (!prompt) {
      return null;
    }
    
    // 替换多个变量
    let finalPrompt = prompt.content;
    
    // 替换主要的用户输入变量
    finalPrompt = finalPrompt.replace(/\{\{USER_INPUT\}\}/g, userInput);
    
    // 替换其他可能的变量
    const now = new Date();
    const variables = {
      'CURRENT_DATE': now.toLocaleDateString(),
      'CURRENT_TIME': now.toLocaleTimeString(),
      'CURRENT_DATETIME': now.toLocaleString(),
      'PROMPT_NAME': promptName,
    };
    
    for (const [key, value] of Object.entries(variables)) {
      finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    this.log(LogLevel.INFO, `成功组合提示词，长度: ${finalPrompt.length}字符`);
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
      return this.handleError("获取提示词列表", error);
    }
  }

  /**
   * 设置缓存过期时间（毫秒）
   */
  public setCacheExpiryTime(timeMs: number): void {
    if (timeMs < 1000) {
      this.log(LogLevel.WARN, `缓存过期时间太短 (${timeMs}ms)，使用默认的最小值1000ms`);
      timeMs = 1000;
    }
    
    this.cacheExpiryTime = timeMs;
    this.log(LogLevel.INFO, `缓存过期时间已设置为 ${timeMs}ms`);
  }

  /**
   * 获取当前缓存过期时间（毫秒）
   */
  public getCacheExpiryTime(): number {
    return this.cacheExpiryTime;
  }

  /**
   * 设置提示词处理模式
   */
  public setPromptHandlingMode(mode: PromptHandlingMode): void {
    this.promptHandlingMode = mode;
    this.log(LogLevel.INFO, `提示词处理模式已设置为: ${mode}`);
  }

  /**
   * 获取当前提示词处理模式
   */
  public getPromptHandlingMode(): PromptHandlingMode {
    return this.promptHandlingMode;
  }

  /**
   * 处理组合后的提示词，根据不同的处理模式返回相应结果
   */
  public handleComposedPrompt(
    finalPrompt: string, 
    promptName: string, 
    mode?: PromptHandlingMode
  ): PromptHandlingResult {
    // 使用传入的模式或默认模式
    const handlingMode = mode || this.promptHandlingMode;
    
    if (handlingMode === "return_only") {
      // 仅返回组合后的提示词文本，不做额外处理
      return {
        text: finalPrompt,
        metadata: {
          processingInstruction: "NO_FURTHER_PROCESSING_REQUIRED",
          description: "此提示词仅供返回，LLM应避免直接处理它"
        }
      };
    } 
    else if (handlingMode === "process_locally") {
      // 在日志中记录这是本地处理模式
      this.log(LogLevel.INFO, `使用本地处理模式处理提示词: ${promptName}`);
      
      // 仅返回提示词，由客户端自己调用当前LLM处理
      return {
        text: finalPrompt,
        metadata: {
          processingInstruction: "PROCESS_WITH_CURRENT_LLM",
          description: "请使用当前LLM上下文处理此提示词"
        }
      };
    }
    else if (handlingMode === "call_external_api") {
      // 这里可以实现调用外部API的逻辑
      this.log(LogLevel.INFO, `调用外部API处理提示词: ${promptName}`);
      
      // TODO: 实现调用外部API的逻辑
      // 例如：const response = await callExternalLLMAPI(finalPrompt);
      
      return {
        text: `未实现的功能: 调用外部API处理提示词`
      };
    }
    
    // 默认行为：返回组合后的提示词
    return {
      text: finalPrompt
    };
  }

  /**
   * 合并提示词并根据处理模式处理结果
   */
  public async composeAndHandlePrompt(
    promptName: string, 
    userInput: string, 
    mode?: PromptHandlingMode
  ): Promise<PromptHandlingResult | null> {
    const finalPrompt = await this.composePrompt(promptName, userInput);
    
    if (!finalPrompt) {
      return null;
    }
    
    return this.handleComposedPrompt(finalPrompt, promptName, mode);
  }
} 