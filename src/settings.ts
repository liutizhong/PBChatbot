/*
 *  Power BI Visualizations
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

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/**
 * API Settings Card
 */
class ApiSettingsCard extends FormattingSettingsCard {
    apiUrl = new formattingSettings.TextInput({
        name: "apiUrl",
        displayName: "API Gateway URL",
        value: "",
        placeholder: "https://your-api-gateway.amazonaws.com/prod/chat"
    });

    apiKey = new formattingSettings.TextInput({
        name: "apiKey",
        displayName: "API 密钥",
        value: "",
        placeholder: "输入您的API密钥"
    });

    authType = new formattingSettings.ItemDropdown({
        name: "authType",
        displayName: "认证类型",
        items: [
            { displayName: "无认证", value: "None" },
            { displayName: "Bearer Token", value: "Bearer" },
            { displayName: "API Key", value: "ApiKey" }
        ],
        value: { displayName: "无认证", value: "None" }
    });

    name: string = "apiSettings";
    displayName: string = "API 设置";
    slices: Array<FormattingSettingsSlice> = [this.apiUrl, this.apiKey, this.authType];
}

/**
 * Chat UI Settings Card
 */
class ChatUISettingsCard extends FormattingSettingsCard {
    primaryColor = new formattingSettings.ColorPicker({
        name: "primaryColor",
        displayName: "主题颜色",
        value: { value: "#0078d4" }
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "字体大小",
        value: 14
    });

    showTimestamp = new formattingSettings.ToggleSwitch({
        name: "showTimestamp",
        displayName: "显示时间戳",
        value: true
    });

    name: string = "chatUI";
    displayName: string = "聊天界面";
    slices: Array<FormattingSettingsSlice> = [this.primaryColor, this.fontSize, this.showTimestamp];
}

/**
* visual settings model class
*
*/
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    // Create formatting settings model formatting cards
    apiSettingsCard = new ApiSettingsCard();
    chatUICard = new ChatUISettingsCard();

    cards = [this.apiSettingsCard, this.chatUICard];
}
