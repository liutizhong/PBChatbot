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
        
        // 添加欢迎消息
        this.addMessage("您好！我是您的AI助手，有什么可以帮助您的吗？", false);
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
            // 调用API
            const response = await this.callApi(messageText);
            
            // 移除加载消息并添加回复
            this.removeMessage(loadingId);
            this.addMessage(response, false);
        } catch (error) {
            // 移除加载消息并显示错误
            this.removeMessage(loadingId);
            this.addMessage(`抱歉，发生了错误：${error.message}`, false);
        }
    }

    private async callApi(message: string): Promise<string> {
        if (!this.apiSettings.apiUrl) {
            throw new Error("请先配置API URL");
        }
        
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        
        // 添加鉴权头
        if (this.apiSettings.apiKey) {
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
        
        const response = await fetch(this.apiSettings.apiUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`API调用失败: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.response || data.message || "收到回复，但格式不正确";
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
        messageElement.className = `message ${isUser ? "user-message" : "bot-message"}`;
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

    private removeMessage(messageId: string): void {
        const messageElement = this.messagesContainer.querySelector(`[data-id="${messageId}"]`);
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