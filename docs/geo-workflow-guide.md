# 🦐 GEO 優化工作流 — AI Agent 部署指南

> **用途：** 讓 AI Agent（如 QwenPaw、ChatGPT、Claude）自動幫你優化網站 GEO
> **適用對象：** 任何有網站的個人或企業
> **所需工具：** AI Agent + 網站存取權限
> **預估時間：** 2-4 小時（首次），後續自動化

---

## 📋 使用方式

### 方法 1：直接貼給 AI Agent
將本文件內容完整複製，貼給你的 AI Agent，然後說：
> 「請根據這份工作流，幫我的網站 [你的網址] 進行 GEO 優化」

### 方法 2：搭配小龍蝦碟使用
1. 將本檔案放入小龍蝦碟的工作流資料夾
2. 在儀表板中載入工作流
3. 輸入你的網址，一鍵執行

---

## 🔍 階段 0：網站現狀診斷（10 分鐘）

### 任務：了解你的網站目前的 GEO 狀態

```markdown
## 診斷指令

請幫我分析網站 [網址] 的 GEO 現狀，執行以下檢查：

### 1. Schema 標記檢查
- 檢查是否有 JSON-LD Schema 標記
- 驗證 Schema 語法是否正確
- 列出缺少的 Schema 類型（FAQ、HowTo、Product、Organization）

### 2. llms.txt 檢查
- 檢查網站根目錄是否有 /llms.txt
- 如果沒有，根據網站內容生成一份

### 3. 內容結構分析
- 檢查是否有 H2 標題（問題型）
- 檢查每個段落是否有「答案膠囊」（前 40-60 字直接回答）
- 檢查是否有統計數據、引用來源、引文

### 4. AI 引用測試
- 用 5 個相關關鍵字測試 ChatGPT/Perplexity/Gemini
- 記錄網站是否被提及
- 記錄提及位置和描述準確度

### 輸出格式
請生成一份診斷報告，包含：
- 現狀評分（0-100）
- 優先改善項目（前 3 名）
- 預估改善效果
```

---

## ⚡ 階段 1：立即優化（30 分鐘）

### 任務：部署最基礎的 GEO 元素

#### 1.1 生成 Schema Markup（JSON-LD）

```markdown
## Schema 生成指令

請為我的網站 [網址] 生成完整的 Schema Markup：

### 網站資訊
- 網站名稱：[填入]
- 網站描述：[填入]
- 主要產品/服務：[填入]
- 目標用戶：[填入]
- 聯絡方式：[填入]

### 需要的 Schema 類型
1. **Organization**（組織資訊）
2. **WebSite**（網站資訊）
3. **Product** 或 **SoftwareApplication**（產品資訊）
4. **FAQPage**（常見問題）
5. **HowTo**（使用教學）
6. **BreadcrumbList**（麵包屑導航）

### 輸出要求
- 生成可直接貼入 HTML 的 `<script type="application/ld+json">` 標籤
- 確保語法正確，可用 Google Rich Results Test 驗證
- 提供安裝位置建議（首頁、產品頁、FAQ 頁）
```

#### 1.2 生成 llms.txt

```markdown
## llms.txt 生成指令

請為我的網站生成 llms.txt 檔案：

### 網站資訊
- 網站名稱：[填入]
- 網站網址：[填入]
- 主要產品/服務：[填入]
- 核心優勢（3-5 點）：[填入]
- 目標用戶：[填入]
- 重要頁面連結：[填入]

### 格式要求
- 使用 Markdown 格式
- 包含「關於」、「核心優勢」、「重要文件」、「使用場景」、「授權」區塊
- 語言：繁體中文 + 英文雙語
- 長度：控制在 50 行以內

### 範例結構
```markdown
# 網站名稱

> 一句話描述

## 關於
- 產品類型：
- 目標用戶：
- 核心功能：

## 核心優勢
1. 
2. 
3. 

## 重要文件
- [產品介紹](網址)
- [使用教學](網址)
- [常見問題](網址)

## 使用場景
- 

## 授權
- 
```
```

#### 1.3 優化首頁內容（四件套）

```markdown
## 內容優化指令

請優化我網站首頁 [網址] 的內容，套用「GEO 四件套」：

### 原始內容
[貼上首頁主要內容]

### 優化規則

#### 1. 答案膠囊（Answer Capsule）
- 每個 H2 段落的前 40-60 字直接回答問題
- 禁止用「在當今這個...」開頭
- 第一句就要有具體資訊

#### 2. 統計數據（Statistics Addition）
- 每個段落至少一個數字
- 使用具體數據（不是「很多」「大量」）
- 標示數據來源

#### 3. 引用權威來源（Cite Sources）
- 引用學術論文、產業報告、權威媒體
- 使用「根據 X 研究...」「X 報告顯示...」格式
- 附上連結

#### 4. 引文（Quotation Addition）
- 引用業界專家的話
- 使用「X 表示：『...』」格式
- 標示出處

### 輸出要求
- 保留原始語意，優化表達方式
- 維持繁體中文
- 長度與原文相近
- 標示修改處
```

---

## 📈 階段 2：內容重構（1-2 小時）

### 任務：建立 Pillar + Cluster 內容架構

#### 2.1 規劃內容架構

```markdown
## 內容架構規劃指令

請為我的網站規劃 Pillar + Cluster 內容架構：

### 核心主題
[你的產品/服務的核心主題]

### 目標關鍵字
[列出 10-15 個相關關鍵字]

### 規劃要求

#### Pillar 頁面
- 1 篇 comprehensive 指南（3000-5000 字）
- 涵蓋主題的所有面向
- 連結到所有 Cluster 頁面

#### Cluster 頁面
- 5-8 篇深入文章（1500-2500 字）
- 每篇專注一個子主題
- 用描述性 anchor text 連回 Pillar

#### 內容大綱
為每篇文章提供：
- 標題（問題型，含關鍵字）
- H2 大綱（3-5 個）
- 每個 H2 的「答案膠囊」範例
- 需要的統計數據
- 需要引用的來源

### 輸出格式
```
Pillar: /主題指南
├─ Cluster: /子主題1
│  - 標題：
│  - 大綱：
│  - 關鍵數據：
│  - 引用來源：
├─ Cluster: /子主題2
│  ...
└─ Cluster: /子主題N
```
```

#### 2.2 撰寫 Cluster 文章

```markdown
## Cluster 文章撰寫指令

請根據以下大綱，撰寫一篇符合 GEO 優化的 Cluster 文章：

### 文章資訊
- 標題：[填入]
- 目標關鍵字：[填入]
- 字數：1500-2500 字
- 語言：繁體中文

### 大綱
[貼上大綱]

### GEO 優化規則

#### 結構規則
1. 第一段直接回答文章主題（答案膠囊）
2. 每個 H2 段落前 40-60 字直接回答該段問題
3. 每個段落至少一個統計數據
4. 每篇文章至少引用 3 個權威來源
5. 至少 1 處引文

#### 技術規則
1. 使用 H2、H3 標題層級
2. 加入 FAQ 區塊（3-5 個常見問題）
3. 加入 HowTo 區塊（如果有教學內容）
4. 使用列表、表格增加結構化

#### 連結規則
1. Cluster 文章內文連結到 Pillar 頁面
2. 使用描述性 anchor text（非「點這裡」）
3. 加入 2-3 個外部權威連結

### 輸出格式
- Markdown 格式
- 包含 YAML front matter（title、description、keywords）
- 標示需要手動填入的連結和數據
```

---

## 🔗 階段 3：平台佈局（1-2 小時）

### 任務：在各 AI 平台建立存在感

#### 3.1 Reddit 策略

```markdown
## Reddit 內容生成指令

請為我生成 5 篇 Reddit 貼文，用於提升 GEO：

### 產品資訊
- 產品名稱：[填入]
- 產品描述：[填入]
- 目標用戶：[填入]

### 目標 subreddit
- r/socialmedia
- r/marketing
- r/SideProject
- r/Entrepreneur
- r/[你的產業]

### 貼文規則
1. **價值優先**：提供實用資訊，不是廣告
2. **自然提及**：產品名稱出現在「解決方案」部分
3. **數據支撐**：每篇至少一個具體數據
4. **互動設計**：結尾問問題，引發討論

### 貼文類型
1. **經驗分享**：「我如何用 AI 工具提升 XX 效率」
2. **教學指南**：「XX 的完整教學（含數據）」
3. **問題討論**：「大家怎麼解決 XX 問題？」
4. **案例研究**：「我用 XX 工具的真實效果」
5. **資源整理**：「XX 領域的最佳工具推薦」

### 輸出要求
- 每篇 300-500 字
- 英文撰寫
- 自然口語化
- 包含 1-2 個連結（產品頁、部落格文章）
```

#### 3.2 LinkedIn 策略

```markdown
## LinkedIn 文章生成指令

請為我生成 2 篇 LinkedIn 長文章：

### 文章主題
1. 「從 SEO 到 GEO：為什麼你的網站需要新策略」
2. 「我用 AI 工作流提升 300% 社群效率的實戰經驗」

### 文章規則
1. **專業 tone**：適合 B2B 受眾
2. **數據驅動**：每段至少一個數據
3. **個人經驗**：加入真實案例
4. **行動呼籲**：結尾引導互動

### 結構
- 鉤子開頭（數據或問題）
- 3-5 個重點
- 每個重點有數據支撐
- 個人經驗/案例
- 結論 + 行動呼籲

### 輸出要求
- 每篇 1500-2000 字
- 繁體中文
- 專業但不學術
- 包含 2-3 個連結
```

---

## 📊 階段 4：監控與迭代（持續）

### 任務：建立 GEO 效果監控機制

#### 4.1 AI 平台引用監測（核心功能）

**為什麼重要？** 你需要知道 AI 搜尋引擎是否引用了你的網站，才能評估優化效果。

##### 平台能力對照

| 平台 | API 支援 | 引用回傳 | 自動化程度 | 測試方式 |
|------|----------|----------|------------|----------|
| **Perplexity** | ✅ 有 API | ✅ 回傳引用 URL | 🟢 **全自動** | API 呼叫 |
| **ChatGPT** | ❌ 無 API | ❌ 需人工檢查 | 🟡 **半自動** | 瀏覽器自動化 |
| **Gemini** | ❌ 無 API | ❌ 需人工檢查 | 🟡 **半自動** | 瀏覽器自動化 |

---

##### 🟢 Perplexity：全自動測試（推薦）

**原理：** Perplexity 的 Agent API 會回傳 `annotations`，其中包含引用來源的 URL。AI Agent 可以直接分析這些引用，判斷目標網站是否被提及。

**API 呼叫方式：**
```bash
curl --request POST \
  --url https://api.perplexity.ai/v1/agent \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "input": "推薦社群小編工具",
    "model": "perplexity/sonar",
    "language_preference": "zh-TW"
  }'
```

**回傳格式：**
```json
{
  "output": [
    {
      "content": [
        {
          "text": "根據多個來源，以下是推薦的社群小編工具...",
          "type": "output_text",
          "annotations": [
            {
              "type": "citation",
              "url": "https://example.com/article1",
              "title": "推薦文章標題",
              "start_index": 10,
              "end_index": 20
            }
          ]
        }
      ]
    }
  ]
}
```

**AI Agent 自動測試指令：**
```markdown
## Perplexity 引用監測指令

請幫我用 Perplexity API 測試網站 [網址] 的引用情況：

### 測試 prompts（至少 10 個）
1. "推薦社群小編工具"
2. "AI 影片生成工具推薦"
3. "自動化社群發布工具"
4. "工作流引擎比較"
5. "台灣社群管理工具"
6. "免費 AI 工具推薦"
7. "一人公司必備工具"
8. "社群行銷自動化"
9. "數位行銷工具 2026"
10. "內容創作 AI 工具"

### API 呼叫
對每個 prompt：
1. 呼叫 Perplexity API
2. 解析 response.output[].content[].annotations
3. 檢查是否有 url 包含 [你的網址]
4. 記錄引用位置（第幾個結果）

### 輸出報告
- 總測試數：X
- 被引用數：X
- 引用率：X%
- 平均引用位置：第 X 名
- 詳細記錄：每個 prompt 的結果

### 範例程式碼（Python）
```python
import requests

def test_perplexity(query, target_domain, api_key):
    url = "https://api.perplexity.ai/v1/agent"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "input": query,
        "model": "perplexity/sonar",
        "language_preference": "zh-TW"
    }
    
    response = requests.post(url, headers=headers, json=data)
    result = response.json()
    
    # 檢查引用
    cited = False
    for output in result.get("output", []):
        for content in output.get("content", []):
            for annotation in content.get("annotations", []):
                if annotation.get("type") == "citation":
                    if target_domain in annotation.get("url", ""):
                        cited = True
    
    return {"cited": cited}

# 批量測試
prompts = ["推薦社群小編工具", "AI 影片生成工具", ...]
results = []
for prompt in prompts:
    result = test_perplexity(prompt, "your-domain.com", "YOUR_API_KEY")
    results.append({"prompt": prompt, **result})

# 生成報告
cited_count = sum(1 for r in results if r["cited"])
print(f"引用率: {cited_count}/{len(results)} = {cited_count/len(results)*100:.1f}%")
```
```

---

##### 🟡 ChatGPT：半自動測試（瀏覽器自動化）

**原理：** ChatGPT 沒有公開 API 可以查詢引用，但 AI Agent 可以使用瀏覽器自動化工具（如 browser_use）來測試。

**AI Agent 自動測試指令：**
```markdown
## ChatGPT 引用監測指令

請幫我用瀏覽器自動化測試網站 [網址] 在 ChatGPT 的引用情況：

### 測試流程
1. 開啟 ChatGPT（https://chat.openai.com）
2. 等待頁面載入
3. 對每個測試 prompt：
   a. 在輸入框輸入 prompt
   b. 等待回應完成
   c. 截圖回應
   d. 分析回應文字是否包含目標網址
   e. 記錄結果

### 測試 prompts（至少 5 個）
1. "推薦社群小編工具"
2. "AI 影片生成工具推薦"
3. "自動化社群發布工具"
4. "工作流引擎比較"
5. "台灣社群管理工具"

### 瀏覽器自動化程式碼（browser_use）
```python
from browser_use import Browser

async def test_chatgpt(prompt, target_domain):
    browser = Browser()
    await browser.start()
    
    # 開啟 ChatGPT
    await browser.open("https://chat.openai.com")
    await browser.wait_for("textarea")
    
    # 輸入 prompt
    await browser.type("textarea", prompt)
    await browser.press_key("Enter")
    
    # 等待回應
    await browser.wait_for(".markdown", timeout=30000)
    
    # 截圖
    await browser.screenshot("chatgpt_response.png")
    
    # 取得回應文字
    response_text = await browser.evaluate("""
        document.querySelector('.markdown').innerText
    """)
    
    # 檢查引用
    cited = target_domain in response_text
    
    await browser.stop()
    return {"cited": cited, "response": response_text}

# 批量測試
prompts = ["推薦社群小編工具", "AI 影片生成工具", ...]
results = []
for prompt in prompts:
    result = await test_chatgpt(prompt, "your-domain.com")
    results.append({"prompt": prompt, **result})

# 生成報告
cited_count = sum(1 for r in results if r["cited"])
print(f"引用率: {cited_count}/{len(results)} = {cited_count/len(results)*100:.1f}%")
```

### 注意事項
- ⚠️ ChatGPT 可能需要登入
- ⚠️ 可能遇到 CAPTCHA 驗證
- ⚠️ 回應格式可能變化
- 💡 建議使用 headed 模式，讓使用者處理驗證
```

---

##### 🟡 Gemini：半自動測試（瀏覽器自動化）

**原理：** Gemini 同樣沒有公開 API，但可以透過瀏覽器自動化測試。

**AI Agent 自動測試指令：**
```markdown
## Gemini 引用監測指令

請幫我用瀏覽器自動化測試網站 [網址] 在 Gemini 的引用情況：

### 測試流程
1. 開啟 Gemini（https://gemini.google.com）
2. 等待頁面載入
3. 對每個測試 prompt：
   a. 在輸入框輸入 prompt
   b. 等待回應完成
   c. 截圖回應
   d. 點擊「搜尋相關內容」查看引用來源
   e. 分析引用來源是否包含目標網址
   f. 記錄結果

### 測試 prompts（至少 5 個）
1. "推薦社群小編工具"
2. "AI 影片生成工具推薦"
3. "自動化社群發布工具"
4. "工作流引擎比較"
5. "台灣社群管理工具"

### 瀏覽器自動化程式碼（browser_use）
```python
from browser_use import Browser

async def test_gemini(prompt, target_domain):
    browser = Browser()
    await browser.start()
    
    # 開啟 Gemini
    await browser.open("https://gemini.google.com")
    await browser.wait_for("textarea")
    
    # 輸入 prompt
    await browser.type("textarea", prompt)
    await browser.press_key("Enter")
    
    # 等待回應
    await browser.wait_for(".response-container", timeout=30000)
    
    # 截圖
    await browser.screenshot("gemini_response.png")
    
    # 取得回應文字
    response_text = await browser.evaluate("""
        document.querySelector('.response-container').innerText
    """)
    
    # 嘗試點擊引用來源按鈕
    try:
        await browser.click("button:has-text('搜尋相關內容')")
        await browser.wait_for(".sources-list", timeout=5000)
        
        # 取得引用來源
        sources = await browser.evaluate("""
            Array.from(document.querySelectorAll('.sources-list a'))
                .map(a => a.href)
        """)
        
        cited = any(target_domain in url for url in sources)
    except:
        cited = target_domain in response_text
    
    await browser.stop()
    return {"cited": cited, "response": response_text}

# 批量測試
prompts = ["推薦社群小編工具", "AI 影片生成工具", ...]
results = []
for prompt in prompts:
    result = await test_gemini(prompt, "your-domain.com")
    results.append({"prompt": prompt, **result})

# 生成報告
cited_count = sum(1 for r in results if r["cited"])
print(f"引用率: {cited_count}/{len(results)} = {cited_count/len(results)*100:.1f}%")
```
```

---

##### 📋 手動測試模板（備用方案）

**當自動化不可行時：**
```markdown
## 手動測試記錄表

### 測試資訊
- 測試日期：____
- 測試網站：____
- 測試者：____

### 測試 prompts
請在每個平台測試以下 prompts，記錄結果：

| # | Prompt | ChatGPT | Perplexity | Gemini |
|---|--------|---------|------------|--------|
| 1 | 推薦社群小編工具 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 2 | AI 影片生成工具推薦 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 3 | 自動化社群發布工具 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 4 | 工作流引擎比較 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 5 | 台灣社群管理工具 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 6 | 免費 AI 工具推薦 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 7 | 一人公司必備工具 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 8 | 社群行銷自動化 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 9 | 數位行銷工具 2026 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |
| 10 | 內容創作 AI 工具 | ❌/✅ 第X名 | ❌/✅ 第X名 | ❌/✅ 第X名 |

### 統計
- ChatGPT 引用率：____% (____/10)
- Perplexity 引用率：____% (____/10)
- Gemini 引用率：____% (____/10)
- 平均引用位置：第____名

### 備註
- 特別記錄：____
- 改善建議：____
```

---

##### 🤖 AI Agent 完整自動化指令

```markdown
## GEO 引用監測 — 完整自動化指令

請幫我執行完整的 GEO 引用監測：

### 1. Perplexity 測試（全自動）
- 使用 API 測試 10 個 prompts
- 分析引用來源 URL
- 記錄引用位置

### 2. ChatGPT 測試（半自動）
- 使用瀏覽器自動化測試 5 個 prompts
- 截圖每個回應
- 分析回應文字

### 3. Gemini 測試（半自動）
- 使用瀏覽器自動化測試 5 個 prompts
- 截圖每個回應
- 嘗試取得引用來源

### 4. 生成報告
- 計算每個平台的引用率
- 計算平均引用位置
- 生成視覺化圖表
- 提供改善建議

### 5. 週期性監測
- 建立每週自動測試機制
- 追蹤引用率變化趨勢
- 發送週報通知

### 輸出格式
```
📊 GEO 引用監測報告

測試日期：2026-06-21
測試網站：your-domain.com

═══════════════════════════════════════
平台引用率
═══════════════════════════════════════
Perplexity:  40% (4/10)  平均位置: 第2名
ChatGPT:     20% (2/10)  平均位置: 第3名
Gemini:      10% (1/10)  平均位置: 第5名

═══════════════════════════════════════
詳細記錄
═══════════════════════════════════════
[每個 prompt 的詳細結果]

═══════════════════════════════════════
改善建議
═══════════════════════════════════════
1. 加強 Perplexity 優化（已有基礎）
2. 針對 ChatGPT 增加權威引用
3. 針對 Gemini 強化 E-E-A-T 信號
```
```

---

##### ⚠️ 監測注意事項

**技術限制：**
1. **ChatGPT/Gemini 無 API**：只能透過瀏覽器自動化，可能遇到驗證
2. **回應隨機性**：同一個 prompt 多次測試可能得到不同結果
3. **地區差異**：不同地區的 AI 模型可能有不同的訓練資料

**最佳實踐：**
1. **多次測試**：每個 prompt 至少測試 3 次，取平均
2. **控制變數**：同一時間、同一網路環境測試
3. **記錄完整**：保留截圖和原始回應
4. **定期追蹤**：每週測試，追蹤趨勢

**倫理考量：**
1. **不要濫用**：測試頻率不要太高，避免被封鎖
2. **尊重條款**：遵守各平台的使用條款
3. **真實優化**：測試是為了優化內容，不是為了操縱

---

##### 🔗 監測相關資源

**API 文件：**
- [Perplexity Agent API](https://docs.perplexity.ai/api-reference/)
- [Perplexity API Key 申請](https://www.perplexity.ai/settings/api)

**工具：**
- [browser_use](https://github.com/browser-use/browser-use)
- [Playwright](https://playwright.dev/)
- [Selenium](https://www.selenium.dev/)

---

#### 4.2 建立監控儀表板

```markdown
## 監控儀表板指令

請幫我建立一個 GEO 監控儀表板：

### 監控項目

#### 1. AI 引用監控（見 4.1 詳細說明）
- 每週測試 10 個關鍵字
- 記錄在 ChatGPT、Perplexity、Gemini 的提及情況
- 計算 AI Share of Voice

#### 2. Schema 狀態監控
- 每週檢查 Schema 語法
- 監控 Rich Results 狀態
- 記錄錯誤和警告

#### 3. 內容表現監控
- 追蹤各頁面流量變化
- 監控 AI 來源流量
- 記錄跳出率變化

### 監控工具
- Google Search Console（免費）
- Google Analytics（免費）
- Schema Validator（免費）
- Perplexity API（自動測試）
- browser_use（半自動測試）

### 報告格式
請生成一份週報模板，包含：
- 本週數據摘要
- 變化趨勢（與上週比較）
- 改善建議
- 下週行動計畫

### 自動化建議
- 建議設定 cron job 自動執行監控
- 建議使用小龍蝦碟的工作流功能自動化
- 建議建立 Google Sheets 追蹤表
```

#### 4.2 A/B 測試指令

```markdown
## A/B 測試指令

請幫我設計 GEO A/B 測試：

### 測試目標
- 測試哪種內容結構更容易被 AI 引用
- 測試哪種 Schema 類型效果最好
- 測試哪種平台策略最有效

### 測試設計

#### 測試 1：內容結構
- A 組：傳統寫法（故事開頭）
- B 組：GEO 寫法（答案膠囊開頭）
- 指標：AI 引用率、跳出率

#### 測試 2：Schema 類型
- A 組：只有 Product Schema
- B 組：Product + FAQ + HowTo Schema
- 指標：Rich Results 出現率、點擊率

#### 測試 3：平台策略
- A 組：只優化網站
- B 組：網站 + Reddit + LinkedIn
- 指標：AI Share of Voice

### 測試週期
- 每組測試 4 週
- 記錄每週數據
- 4 週後比較結果

### 輸出
- 測試計劃表
- 數據記錄模板
- 結果分析框架
```

---

## 🚀 進階：自動化工作流

### 小龍蝦碟工作流整合

```markdown
## 工作流整合指令

請幫我建立一個小龍蝦碟工作流，自動執行 GEO 優化：

### 工作流名稱
GEO 自動優化工作流

### 工作流節點

#### 觸發器
- 類型：定時觸發
- 頻率：每週一次

#### 處理器 1：網站掃描
- 抓取網站所有頁面
- 檢查 Schema 標記
- 分析內容結構
- 生成診斷報告

#### 處理器 2：內容優化
- 根據診斷結果自動優化
- 加入缺失的 Schema
- 優化段落結構
- 生成優化建議

#### 處理器 3：AI 測試
- 自動測試 10 個關鍵字
- 記錄 AI 引用情況
- 計算 KPI 變化

#### 輸出器 1：報告生成
- 生成週報 PDF
- 包含數據圖表
- 包含改善建議

#### 輸出器 2：通知發送
- 發送報告到 Email
- 發送摘要到 LINE/Telegram
- 更新儀表板

### 工作流設定
- 自動重試：3 次
- 錯誤處理：發送通知
- 日誌記錄：完整記錄
```

---

## 📝 使用範例

### 範例 1：新網站 GEO 優化

```
使用者：請幫我的網站 https://example.com 進行 GEO 優化

AI Agent 執行：
1. 診斷網站現狀
2. 生成 Schema Markup
3. 建立 llms.txt
4. 優化首頁內容
5. 規劃內容架構
6. 撰寫 Cluster 文章
7. 生成 Reddit/LinkedIn 內容
8. 建立監控機制

輸出：
- Schema Markup 程式碼
- llms.txt 檔案
- 優化後的首頁內容
- 內容架構圖
- 5 篇 Cluster 文章
- 5 篇 Reddit 貼文
- 2 篇 LinkedIn 文章
- 監控儀表板
```

### 範例 2：現有網站 GEO 改善

```
使用者：我的網站已經有 SEO，但 AI 不引用，怎麼辦？

AI Agent 執行：
1. 分析現有內容結構
2. 找出不符合 GEO 的部分
3. 逐頁優化（四件套）
4. 補充 Schema 標記
5. 建立 llms.txt
6. 測試優化效果

輸出：
- 問題診斷報告
- 逐頁優化建議
- 優化後的內容
- 效果對比報告
```

---

## ⚠️ 注意事項

### 1. 內容品質優先
- GEO 優化不是「作弊」，是讓內容更容易被 AI 理解
- 優質內容永遠是基礎，技巧只是輔助

### 2. 平台偏好差異
- ChatGPT 愛權威來源
- Perplexity 愛社群內容
- Gemini 愛 E-E-A-T 信號
- 要分散投資，不要只優化一個平台

### 3. 持續迭代
- GEO 是持續過程，不是一次性優化
- 每週監控、每月調整、每季檢討

### 4. 避免過度優化
- 不要堆砌關鍵字
- 不要製造虚假數據
- 不要購買假評論

---

## 🔗 相關資源

### 學術研究
- [GEO: Generative Engine Optimization (Princeton)](https://arxiv.org/abs/2311.09735)
- [Manipulating LLMs to Increase Product Visibility](https://arxiv.org/abs/2404.07981)

### 工具
- [Schema.org](https://schema.org/)
- [Google Rich Results Test](https://search.google.com/test/rich-results)
- [Google Search Console](https://search.google.com/search-console)

### 參考文章
- [2026 從 SEO 做好 GEO 的工程師實戰指南](https://hackmd.io/@BASHCAT/seo-to-geo-2026)

---

*工作流建立：2026-06-21*
*建立者：戰蝦 🦐*
*版本：v1.0*
*適用：小龍蝦碟 + 任何 AI Agent*
