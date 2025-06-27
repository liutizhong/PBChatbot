/*
*  Power BI Visual CLI
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved.
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*
*  The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
*
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;

import { VisualFormattingSettingsModel } from "./settings";

interface ChatMessage {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: Date;
}

interface ApiSettings {
    apiUrl: string;
    apiKey: string;
    authType: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private chatContainer: HTMLElement;
    private messagesContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private messageInput: HTMLInputElement;
    private sendButton: HTMLButtonElement;
    private messages: ChatMessage[] = [];
    private apiSettings: ApiSettings = {
        apiUrl: "",
        apiKey: "",
        authType: "Bearer"
    };

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.createChatInterface();
    }

    private createChatInterface(): void {
        // 创建主容器
        this.chatContainer = document.createElement("div");
        this.chatContainer.className = "chat-container";
        
        // 创建消息显示区域
        this.messagesContainer = document.createElement("div");
        this.messagesContainer.className = "messages-container";
        
        // 创建输入区域
        this.inputContainer = document.createElement("div");
        this.inputContainer.className = "input-container";
        
        // 创建输入框
        this.messageInput = document.createElement("input");
        this.messageInput.type = "text";
        this.messageInput.className = "message-input";
        this.messageInput.placeholder = "请输入您的问题...";
        
        // 创建发送按钮
        this.sendButton = document.createElement("button");
        this.sendButton.className = "send-button";
        this.sendButton.textContent = "发送";
        
        // 绑定事件
        this.sendButton.addEventListener("click", () => this.sendMessage());
        this.messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.sendMessage();
            }
        });
        
        // 组装界面
        this.inputContainer.appendChild(this.messageInput);
        this.inputContainer.appendChild(this.sendButton);
        this.chatContainer.appendChild(this.messagesContainer);
        this.chatContainer.appendChild(this.inputContainer);
        this.target.appendChild(this.chatContainer);
    }

    private async handleStreamResponse(response: Response, messageId?: string): Promise<string> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("无法读取流式响应");
        }

        // 移除加载动画，开始流式处理
        if (messageId) {
            this.removeStreamingEffect(messageId);
            this.updateMessage(messageId, ""); // 清空占位文本
        }

        const decoder = new TextDecoder();
        let fullResponse = "";
        let buffer = "";
        let isFirstChunk = true;

        try {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }

                // 解码数据块
                buffer += decoder.decode(value, { stream: true });
                
                // 处理完整的事件行
                const lines = buffer.split('\n');
                buffer = lines.pop() || ""; // 保留不完整的行

                for (const line of lines) {
                    if (line.trim() === "") continue;
                    
                    // 处理Server-Sent Events格式
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6); // 移除"data: "前缀
                        
                        if (data === "[DONE]") {
                            // 流结束标记
                            break;
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content || 
                                          parsed.content || 
                                          parsed.text || 
                                          parsed.message || "";
                            
                            if (content) {
                                 fullResponse += content;
                                 
                                 // 实时更新UI（如果提供了messageId）
                                 if (messageId) {
                                     // 第一次收到内容时开始打字效果
                                     if (isFirstChunk) {
                                         isFirstChunk = false;
                                     }
                                     this.updateMessageWithTyping(messageId, fullResponse);
                                 }
                             }
                        } catch (parseError) {
                            // 如果不是JSON格式，直接作为文本处理
                             if (data.trim()) {
                                 fullResponse += data;
                                 if (messageId) {
                                     this.updateMessageWithTyping(messageId, fullResponse);
                                 }
                             }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
            
            // 完成打字效果
            if (messageId && fullResponse) {
                this.finishTyping(messageId, fullResponse);
            }
        }

        return fullResponse || "收到空响应";
    }

    private async sendMessage(): Promise<void> {
        const messageText = this.messageInput.value.trim();
        if (!messageText) return;
        
        // 添加用户消息
        this.addMessage(messageText, true);
        this.messageInput.value = "";
        
        // 创建AI回复消息占位符，添加流式加载动画
        const responseId = this.addMessage("正在连接...", false);
        this.addStreamingEffect(responseId);
        
        try {
            // 直接调用API，支持流式处理
            const response = await this.callApi(messageText, responseId);
            
            // 如果没有通过流式更新，则更新最终响应
            if (response && response !== "收到空响应") {
                this.updateMessage(responseId, response);
            } else if (response === "收到空响应") {
                this.updateMessage(responseId, "抱歉，没有收到有效回复，请重试。");
            }
        } catch (error) {
            // 显示错误信息
            if (error.message.includes("网络连接失败")) {
                this.updateMessage(responseId, "❌ 网络连接失败\n\n" + error.message + "\n\n💡 建议：检查网络连接和API配置");
            } else if (error.message.includes("请求超时")) {
                this.updateMessage(responseId, "⏰ 请求超时\n\n" + error.message + "\n\n💡 建议：检查网络连接或稍后重试");
            } else {
                this.updateMessage(responseId, "❌ 发生错误：" + error.message + "\n\n💡 请检查API配置和网络连接");
            }
        }
    }





    private performNetworkDiagnostics(): string {
        const diagnostics: string[] = [];
        
        // URL格式检查
        try {
            const url = new URL(this.apiSettings.apiUrl);
            diagnostics.push(`✓ URL格式正确: ${url.protocol}//${url.host}`);
            
            if (url.protocol !== 'https:') {
                diagnostics.push(`⚠️ 协议警告: 使用${url.protocol}，PowerBI要求HTTPS`);
            }
            
            if (url.port && url.port !== '443') {
                diagnostics.push(`ℹ️ 端口信息: ${url.port}`);
            }
        } catch (e) {
            diagnostics.push(`❌ URL格式错误: ${this.apiSettings.apiUrl}`);
        }
        
        // 网络环境检查
        diagnostics.push(`🌐 运行环境: PowerBI Desktop/Service`);
        diagnostics.push(`🔒 安全模式: 沙箱环境`);
        
        // 认证信息检查
        if (this.apiSettings.authType === "None") {
            diagnostics.push(`🔓 认证方式: 无认证`);
        } else {
            const hasKey = this.apiSettings.apiKey && this.apiSettings.apiKey.length > 0;
            diagnostics.push(`🔐 认证方式: ${this.apiSettings.authType} ${hasKey ? '(已配置)' : '(未配置密钥)'}`);
        }
        
        // 时间戳
        diagnostics.push(`⏰ 诊断时间: ${new Date().toLocaleString()}`);
        
        return diagnostics.join('\n');
    }



    private async callApiWithRetry(message: string, maxRetries: number = 3, loadingId?: string): Promise<string> {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (loadingId && attempt > 1) {
                    this.updateMessage(loadingId, "正在重试连接... (" + attempt + "/" + maxRetries + ")");
                }
                return await this.callApi(message);
            } catch (error) {
                lastError = error;
                
                // 如果是网络连接失败，进行重试
                if (error.message.includes("Failed to fetch") || error.message.includes("网络连接失败")) {
                    if (attempt < maxRetries) {
                        if (loadingId) {
                            this.updateMessage(loadingId, "连接失败，" + Math.ceil((Math.min(1000 * Math.pow(2, attempt - 1), 5000)) / 1000) + "秒后重试...");
                        }
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 指数退避，最大5秒
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
                
                // 其他错误直接抛出，不重试
                throw error;
            }
        }
        
        throw lastError;
    }

    private async callApi(message: string, messageId?: string): Promise<string> {
        if (!this.apiSettings.apiUrl) {
            throw new Error("请先配置API URL");
        }
        
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json"
        };
        
        // 添加鉴权头
        if (this.apiSettings.authType !== "None" && this.apiSettings.apiKey) {
            if (this.apiSettings.authType === "Bearer") {
                headers["Authorization"] = `Bearer ${this.apiSettings.apiKey}`;
            } else if (this.apiSettings.authType === "ApiKey") {
                headers["X-API-Key"] = this.apiSettings.apiKey;
            }
        }
        
        const requestBody = {
            message: message,
            timestamp: new Date().toISOString(),
            stream: true // 请求流式响应
        };
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 增加到60秒超时
            
            const response = await fetch(this.apiSettings.apiUrl, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(requestBody),
                mode: "cors",
                credentials: "omit",
                signal: controller.signal,
                cache: "no-cache",
                redirect: "follow"
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => "未知错误");
                throw new Error(`API调用失败 (${response.status}): ${response.statusText}. ${errorText}`);
            }
            
            const contentType = response.headers.get("content-type");
            console.log("API响应Content-Type:", contentType);
            
            // 先获取响应文本进行调试
            const responseText = await response.text();
            console.log("API响应内容:", responseText);
            
            // 检查是否为流式响应
            if (contentType && contentType.includes("text/event-stream")) {
                // 重新创建Response对象用于流式处理
                const newResponse = new Response(responseText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers
                });
                return await this.handleStreamResponse(newResponse, messageId);
            } else if (contentType && (contentType.includes("application/json") || contentType.includes("text/plain"))) {
                // 处理JSON或纯文本响应
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (parseError) {
                    // 如果不是JSON格式，直接作为文本处理
                    console.log("响应不是JSON格式，作为纯文本处理:", responseText);
                    
                    if (messageId) {
                        this.removeStreamingEffect(messageId);
                        this.updateMessage(messageId, "");
                        await this.simulateTypingEffect(messageId, responseText);
                    }
                    
                    return responseText;
                }
                
                // 处理JSON响应
                console.log("解析后的JSON数据:", data);
                
                // 检查多种可能的响应格式
                if (data.statusCode === 200 || data.status === 200 || data.success === true) {
                    const responseContent = data.response || data.message || data.reply || data.content || data.text || "收到回复，但内容为空";
                    
                    if (messageId) {
                        this.removeStreamingEffect(messageId);
                        this.updateMessage(messageId, "");
                        await this.simulateTypingEffect(messageId, responseContent);
                    }
                    
                    return responseContent;
                } else if (data.error || data.statusCode !== 200) {
                    // 处理错误响应
                    const errorMessage = data.error || data.message || `API返回错误状态: ${data.statusCode || data.status}`;
                    throw new Error(errorMessage);
                } else {
                    // 尝试直接使用响应内容
                    const responseContent = data.response || data.message || data.reply || data.content || data.text || JSON.stringify(data);
                    
                    if (messageId) {
                        this.removeStreamingEffect(messageId);
                        this.updateMessage(messageId, "");
                        await this.simulateTypingEffect(messageId, responseContent);
                    }
                    
                    return responseContent;
                }
            } else {
                // 未知格式，尝试作为纯文本处理
                console.log("未知Content-Type，作为纯文本处理:", responseText);
                
                if (messageId) {
                    this.removeStreamingEffect(messageId);
                    this.updateMessage(messageId, "");
                    await this.simulateTypingEffect(messageId, responseText);
                }
                
                return responseText || "收到响应，但内容为空";
            }
            
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("请求超时，请检查网络连接或API响应速度");
            } else if (error.message.includes("Failed to fetch")) {
                const diagnosticInfo = this.performNetworkDiagnostics();
                throw new Error("网络连接失败\n\n诊断信息：\n" + diagnosticInfo + "\n\n请检查：\n1. API URL是否正确\n2. 网络连接是否正常\n3. API是否支持CORS跨域请求\n4. PowerBI网络策略设置");
            } else if (error.message.includes("CORS")) {
                throw new Error("跨域请求被阻止，请确保API Gateway配置了正确的CORS策略");
            } else if (error.message.includes("TypeError")) {
                throw new Error("请求配置错误，请检查API URL格式和请求参数");
            }
            throw error;
        }
    }

    private parseMarkdown(text: string): string {
        if (!text) return "";
        
        // 转义HTML特殊字符
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // 代码块 (```)
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // 行内代码 (`)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // 粗体 (**text** 或 __text__)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // 斜体 (*text* 或 _text_)
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
        
        // 链接 [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // 标题 (# ## ###)
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // 无序列表 (- 或 *)
        html = html.replace(/^[\s]*[-*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        // 有序列表 (1. 2. 3.)
        html = html.replace(/^[\s]*\d+\. (.+)$/gm, '<li>$1</li>');
        
        // 换行处理
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        
        // 包装段落
        if (html && !html.startsWith('<')) {
            html = '<p>' + html + '</p>';
        }
        
        return html;
    }

    private addMessage(text: string, isUser: boolean): string {
        const messageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const message: ChatMessage = {
            id: messageId,
            text: text,
            isUser: isUser,
            timestamp: new Date()
        };
        
        this.messages.push(message);
        
        const messageElement = document.createElement("div");
        messageElement.className = 'message ' + (isUser ? 'user-message' : 'bot-message');
        messageElement.setAttribute("data-id", messageId);
        
        const messageContent = document.createElement("div");
        messageContent.className = "message-content";
        
        // 对于用户消息使用纯文本，对于AI消息使用Markdown解析
        if (isUser) {
            messageContent.textContent = text;
        } else {
            messageContent.innerHTML = this.parseMarkdown(text);
        }
        
        const messageTime = document.createElement("div");
        messageTime.className = "message-time";
        messageTime.textContent = message.timestamp.toLocaleTimeString();
        
        messageElement.appendChild(messageContent);
        messageElement.appendChild(messageTime);
        this.messagesContainer.appendChild(messageElement);
        
        // 滚动到底部
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        return messageId;
    }



    private updateMessage(messageId: string, newText: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            const messageContent = messageElement.querySelector('.message-content');
            if (messageContent) {
                // 检查是否为AI消息（bot-message类）
                const isAIMessage = messageElement.classList.contains('bot-message');
                if (isAIMessage) {
                    messageContent.innerHTML = this.parseMarkdown(newText);
                } else {
                    messageContent.textContent = newText;
                }
            }
        }
        
        // 更新内存中的消息
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            message.text = newText;
        }
    }

    private updateMessageWithTyping(messageId: string, newText: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            const messageContent = messageElement.querySelector('.message-content');
            if (messageContent) {
                // 检查是否为AI消息
                const isAIMessage = messageElement.classList.contains('bot-message');
                if (isAIMessage) {
                    // 对于AI消息，解析Markdown并添加光标
                    const parsedContent = this.parseMarkdown(newText);
                    messageContent.innerHTML = parsedContent + '<span class="typing-cursor">▋</span>';
                } else {
                    // 对于用户消息，使用纯文本
                    messageContent.textContent = newText + "▋";
                }
                
                // 添加打字动画类
                messageElement.classList.add('typing');
                
                // 自动滚动到底部
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }
        }
        
        // 更新内存中的消息
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            message.text = newText;
        }
    }

    private finishTyping(messageId: string, finalText: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            const messageContent = messageElement.querySelector('.message-content');
            if (messageContent) {
                // 检查是否为AI消息
                const isAIMessage = messageElement.classList.contains('bot-message');
                if (isAIMessage) {
                    // 移除光标，显示最终Markdown解析后的文本
                    messageContent.innerHTML = this.parseMarkdown(finalText);
                } else {
                    // 对于用户消息，使用纯文本
                    messageContent.textContent = finalText;
                }
                
                // 移除所有动画类
                messageElement.classList.remove('typing', 'streaming');
            }
        }
        
        // 更新内存中的消息
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            message.text = finalText;
        }
    }

    private addStreamingEffect(messageId: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            messageElement.classList.add('streaming');
        }
    }

    private removeStreamingEffect(messageId: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            messageElement.classList.remove('streaming');
        }
    }

    private async simulateTypingEffect(messageId: string, text: string): Promise<void> {
        const words = text.split(' ');
        let currentText = '';
        
        for (let i = 0; i < words.length; i++) {
            currentText += (i > 0 ? ' ' : '') + words[i];
            this.updateMessageWithTyping(messageId, currentText);
            
            // 控制打字速度，每个词之间延迟50-150ms
            const delay = Math.random() * 100 + 50;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // 完成打字效果
        this.finishTyping(messageId, text);
    }



    private removeMessage(messageId: string): void {
        const messageElement = this.messagesContainer.querySelector('[data-id="' + messageId + '"]');
        if (messageElement) {
            messageElement.remove();
        }
        this.messages = this.messages.filter(m => m.id !== messageId);
    }

    public update(options: VisualUpdateOptions) {
        const objects = options.dataViews[0]?.metadata.objects;
        
        // 更新API设置
        if (objects?.apiSettings) {
            this.apiSettings.apiUrl = objects.apiSettings.apiUrl as string || "";
            this.apiSettings.apiKey = objects.apiSettings.apiKey as string || "";
            this.apiSettings.authType = objects.apiSettings.authType as string || "Bearer";
        }
    }

    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
        return [{
            objectName: "apiSettings",
            properties: {
                apiUrl: this.apiSettings?.apiUrl ?? "",
                apiKey: this.apiSettings?.apiKey ?? "",
                authType: this.apiSettings?.authType ?? "Bearer"
            },
            validValues: {},
            selector: null
        }];
    }
}