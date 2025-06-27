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
        
        // 创建测试连接按钮
        const testButton = document.createElement("button");
        testButton.className = "test-button";
        testButton.textContent = "测试连接";
        testButton.title = "测试API连接";
        
        // 绑定事件
        this.sendButton.addEventListener("click", () => this.sendMessage());
        testButton.addEventListener("click", () => this.testConnection());
        this.messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.sendMessage();
            }
        });
        
        // 组装界面
        this.inputContainer.appendChild(this.messageInput);
        this.inputContainer.appendChild(testButton);
        this.inputContainer.appendChild(this.sendButton);
        this.chatContainer.appendChild(this.messagesContainer);
        this.chatContainer.appendChild(this.inputContainer);
        this.target.appendChild(this.chatContainer);
        
        // 添加欢迎消息
        this.addMessage("您好！我是您的AI助手，有什么可以帮助您的吗？", false);
        this.addMessage("💡 提示：如果遇到连接问题，请点击'测试连接'按钮进行诊断。", false);
        this.addMessage("🔧 配置提示：支持无认证、Bearer Token和API Key三种认证方式。", false);
    }

    private async sendMessage(): Promise<void> {
        const messageText = this.messageInput.value.trim();
        if (!messageText) return;
        
        // 添加用户消息
        this.addMessage(messageText, true);
        this.messageInput.value = "";
        
        // 显示加载状态
        const loadingId = this.addMessage("正在思考中...", false);
        
        try {
            // 使用重试机制调用API
            const response = await this.callApiWithRetry(messageText, 3, loadingId);
            
            // 移除加载消息并添加回复
            this.removeMessage(loadingId);
            this.addMessage(response, false);
        } catch (error) {
            // 移除加载消息并显示错误
            this.removeMessage(loadingId);
            
            // 根据错误类型提供不同的提示
            if (error.message.includes("网络连接失败")) {
                this.addMessage(`❌ 网络连接失败\n\n${error.message}\n\n💡 建议：点击'测试连接'按钮进行详细诊断`, false);
            } else if (error.message.includes("请求超时")) {
                this.addMessage(`⏰ 请求超时\n\n${error.message}\n\n💡 建议：检查网络连接或稍后重试`, false);
            } else {
                this.addMessage(`❌ 发生错误：${error.message}\n\n💡 如需帮助，请点击'测试连接'进行诊断`, false);
            }
        }
    }

    private async testPreflightRequest(): Promise<void> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            await fetch(this.apiSettings.apiUrl, {
                method: "OPTIONS",
                headers: {
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "Content-Type, Authorization, X-API-Key"
                },
                mode: "cors",
                credentials: "omit",
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
        } catch (error) {
            // 预检请求失败，但不阻止主请求
            console.warn("预检请求失败:", error.message);
        }
    }

    private getResponseHeadersInfo(response: Response): string {
        const headers: string[] = [];
        
        // 检查重要的CORS头
        const corsHeaders = [
            'access-control-allow-origin',
            'access-control-allow-methods',
            'access-control-allow-headers',
            'access-control-allow-credentials'
        ];
        
        corsHeaders.forEach(header => {
            const value = response.headers.get(header);
            if (value) {
                headers.push(`  ${header}: ${value}`);
            }
        });
        
        // 检查内容类型
        const contentType = response.headers.get('content-type');
        if (contentType) {
            headers.push(`  content-type: ${contentType}`);
        }
        
        // 检查服务器信息
        const server = response.headers.get('server');
        if (server) {
            headers.push(`  server: ${server}`);
        }
        
        return headers.length > 0 ? headers.join('\n') : '  无关键响应头信息';
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

    private async testConnection(): Promise<void> {
        if (!this.apiSettings.apiUrl) {
            this.addMessage("❌ 请先在设置中配置API URL", false);
            return;
        }

        const testId = this.addMessage("🔍 正在测试API连接...", false);

        try {
            // 首先进行预检请求测试（如果需要）
            const needsPreflight = this.apiSettings.authType !== "None";
            if (needsPreflight) {
                await this.testPreflightRequest();
            }

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            };

            // 添加鉴权头
            if (this.apiSettings.authType !== "None" && this.apiSettings.apiKey) {
                if (this.apiSettings.authType === "Bearer") {
                    headers["Authorization"] = `Bearer ${this.apiSettings.apiKey}`;
                } else if (this.apiSettings.authType === "ApiKey") {
                    headers["X-API-Key"] = this.apiSettings.apiKey;
                }
            }

            const testBody = {
                message: "连接测试",
                timestamp: new Date().toISOString(),
                test: true
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 增加到15秒超时

            const response = await fetch(this.apiSettings.apiUrl, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(testBody),
                mode: "cors",
                credentials: "omit",
                signal: controller.signal,
                cache: "no-cache",
                redirect: "follow"
            });

            clearTimeout(timeoutId);
            this.removeMessage(testId);

            if (response.ok) {
                const authDisplay = this.apiSettings.authType === "None" ? "无认证" : this.apiSettings.authType;
                const responseHeaders = this.getResponseHeadersInfo(response);
                this.addMessage(`✅ 连接测试成功！\n- 状态码: ${response.status}\n- API URL: ${this.apiSettings.apiUrl}\n- 认证方式: ${authDisplay}\n- 响应头信息:\n${responseHeaders}`, false);
            } else {
                const errorText = await response.text().catch(() => "无法读取错误信息");
                const responseHeaders = this.getResponseHeadersInfo(response);
                this.addMessage(`⚠️ API返回错误:\n- 状态码: ${response.status}\n- 错误信息: ${response.statusText}\n- 详细: ${errorText}\n- 响应头信息:\n${responseHeaders}`, false);
            }

        } catch (error) {
            this.removeMessage(testId);
            
            if (error.name === "AbortError") {
                this.addMessage("⏰ 连接超时\n请检查：\n1. API URL是否正确\n2. 网络连接是否正常\n3. API服务是否运行\n4. 服务器响应时间过长", false);
            } else if (error.message.includes("Failed to fetch")) {
                // 增强的网络诊断
                const diagnosticInfo = this.performNetworkDiagnostics();
                this.addMessage("❌ 网络连接失败\n\n🔍 诊断信息：\n" + diagnosticInfo + "\n\n💡 解决建议：\n1. 检查API URL格式 (必须以https://开头)\n2. 验证API Gateway的CORS配置\n3. 确认PowerBI网络策略允许访问\n4. 检查防火墙和代理设置\n5. 联系API管理员确认服务状态", false);
            } else if (error.message.includes("CORS")) {
                this.addMessage("🚫 跨域请求被阻止\n\n解决方案：\n1. 在AWS API Gateway中启用CORS\n2. 添加以下响应头：\n   - Access-Control-Allow-Origin: *\n   - Access-Control-Allow-Methods: POST, OPTIONS\n   - Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key\n3. 确保处理OPTIONS预检请求\n4. 检查Lambda函数的CORS配置", false);
            } else if (error.message.includes("TypeError")) {
                this.addMessage("🔧 请求配置错误\n\n可能原因：\n1. URL格式不正确\n2. 请求头配置问题\n3. 请求体格式错误\n\n请检查API配置", false);
            } else {
                this.addMessage("❌ 连接测试失败\n\n错误详情：" + error.message + "\n\n请检查网络连接和API配置", false);
            }
        }
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

    private async callApi(message: string): Promise<string> {
        if (!this.apiSettings.apiUrl) {
            throw new Error("请先配置API URL");
        }
        
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json"
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
            timestamp: new Date().toISOString()
        };
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
            
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
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("API返回的不是JSON格式");
            }
            
            const data = await response.json();
            return data.response || data.message || data.reply || "收到回复，但格式不正确";
            
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
        messageContent.textContent = text;
        
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
                messageContent.textContent = newText;
            }
        }
        
        // 更新内存中的消息
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            message.text = newText;
        }
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
                apiUrl: this.apiSettings.apiUrl,
                apiKey: this.apiSettings.apiKey,
                authType: this.apiSettings.authType
            },
            validValues: {},
            selector: null
        }];
    }
}