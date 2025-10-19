// Simplified Agent base class without ADK dependency
export interface AgentContext {
  apiKey?: string;
  model?: string;
  [key: string]: any;
}

export interface Tool {
  name: string;
  description: string;
  parameters?: any;
  execute: (params: any) => Promise<any>;
}

export class Agent {
  protected name: string;
  protected description: string;
  protected tools: Tool[];

  constructor(config: any) {
    this.name = config.name || 'Agent';
    this.description = config.description || '';
    this.tools = config.tools || [];
  }

  async execute(toolName: string, params: any) {
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }
    return tool.execute(params);
  }
}

export class Memory {
  private storage: Map<string, any> = new Map();

  async store(data: any) {
    const key = `${data.type}_${Date.now()}`;
    this.storage.set(key, data);
    return key;
  }

  async retrieve(key: string) {
    return this.storage.get(key);
  }

  async search(type: string) {
    const results = [];
    for (const [key, value] of this.storage.entries()) {
      if (key.startsWith(type)) {
        results.push(value);
      }
    }
    return results;
  }
}