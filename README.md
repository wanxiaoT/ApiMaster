# ApiMaster

一个面向 AI API 中转站 / 兼容接口的本地测试工作台，主要提供两类能力：

1. **API 真实性 / 兼容性检测**
   - 检查模型返回是否像真实目标接口
   - 关注知识截止、SSE 事件结构、thinking block、usage 字段等信息
   - 支持 OpenAI / Anthropic 两种请求格式
   - 支持流式 / 非流式调用切换

2. **大海捞针（Needle in a Haystack）长上下文检索测试**
   - 按“上下文长度 × 插入深度”生成测试矩阵
   - 评估模型在长上下文中的真实检索能力
   - 支持热力图展示
   - 支持导出 PNG / CSV

---

## 项目定位

ApiMaster 的目标不是做通用聊天 UI，而是做一个更偏工程验证的测试台：

- 验证接口是否**真实兼容**
- 验证返回结构是否**像真实上游模型**
- 验证长上下文下是否真的具备**信息召回能力**

因此它更适合：

- 测中转站
- 测代理接口
- 测模型名映射
- 测返回协议
- 测长上下文检索退化

---

## 当前功能

### 1. API 检测

- API 地址 / Key / 模型名配置
- OpenAI / Anthropic 格式切换
- 流式 / 非流式调用切换
- Thinking 开关（Anthropic）
- 检测结果评分
- 响应内容预览
- 历史记录缓存
- 流式检测实时预览

### 2. 大海捞针测试

- 自定义 Needle 与问题
- 自定义最小 / 最大上下文长度
- 自定义最小 / 最大插入深度
- 自动生成测试矩阵
- 开始 / 暂停 / 继续 / 停止测试
- 热力图展示
- 结果表展示
- 导出热力图 PNG
- 导出结果 CSV

---

## 本地运行

### 环境要求

- Node.js 18+

### 启动方式

```bash
npm start
```

默认启动地址：

```text
http://127.0.0.1:6722/
```

---

## 参考 / 引用项目

本项目当前的检测与测试能力，主要参考了下面几个项目的思路与方法。这里记录来源，便于后续维护、追溯和致谢。

### 1) API 真实性鉴别 / 中转站检测参考

- **项目名**：relayAPI
- **用途**：参考其“接口真实性 / Claude 兼容性 / 返回结构检测”相关思路
- **本地参考目录**：`_ref/relayAPI`
- **GitHub 仓库**：<https://github.com/zzsting88/relayAPI>

本项目主要借鉴了其中与以下方向相关的思路：

- Claude / Anthropic 风格接口检测
- knowledge cutoff 判断
- thinking / usage / SSE 结构检查
- 中转站真实性验证方向

---

### 2) 大海捞针（Needle in a Haystack）测试参考

- **项目名**：LLMTest_NeedleInAHaystack
- **用途**：参考其长上下文检索测试方法、矩阵化评估方式与可视化思路
- **本地参考目录**：`_ref/LLMTest_NeedleInAHaystack`
- **GitHub 仓库**：<https://github.com/gkamradt/LLMTest_NeedleInAHaystack>

本项目主要借鉴了其中与以下方向相关的思路：

- Needle in a Haystack 测试范式
- 上下文长度 × 插入深度矩阵
- 检索能力热力图表达
- 长上下文召回能力评估

---

### 3) Claude Code 中转来源检测参考

- **项目名**：cc-proxy-detector
- **用途**：参考其更细粒度的 Claude Code / Claude 兼容中转来源判定思路
- **本地参考目录**：`_ref/cc-proxy-detector`
- **GitHub 仓库**：<https://github.com/zxc123aa/cc-proxy-detector>

这个项目相比当前 ApiMaster，在“Claude 中转来源识别”这一条线上做得更深，尤其值得借鉴的点包括：

- **三源判定**：
  - Anthropic 官方
  - AWS Bedrock / Kiro
  - Google Vertex / Antigravity
- **混合渠道扫描**：
  - 同一个中转站，不同模型可能路由到不同后端
- **负面证据机制**：
  - 不只看“命中了什么字段”
  - 还看“哪些本该出现的字段缺失了”
- **ratelimit 动态验证**：
  - 连续多次请求，判断 ratelimit remaining 是否真实递减
- **平台 / 来源指纹矩阵**：
  - tool_use id
  - message id
  - thinking signature
  - headers
  - usage 风格
  - cache / service_tier / inference_geo 等字段

---

## 与 cc-proxy-detector 的对比结论

2026-03-31 本地拉取并审查了：

- 本地目录：`_ref/cc-proxy-detector`
- 仓库链接：<https://github.com/zxc123aa/cc-proxy-detector>

对比后，可以概括为：

### ApiMaster 当前更强的部分

- 有完整的前端工作台界面
- 有 API 检测 + Needle 测试两个工作区
- 有热力图展示、导出、暂停/继续/停止等交互
- 更适合日常可视化测试

### cc-proxy-detector 当前更强的部分

- 在 Claude Code / Claude 中转来源判定上更细
- 明确区分 Anthropic / Bedrock / Vertex 三类来源
- 有“混合渠道”扫描思路
- 有“负面证据”与“防伪装”逻辑
- 有 ratelimit 动态真伪验证

---

## 后续可借鉴方向（来自 cc-proxy-detector）

结合当前 ApiMaster 的目标，后续最值得吸收的方向是：

1. **三源来源判定**
   - 不只输出“像不像 Anthropic”
   - 进一步输出更明确的来源判断：
     - Anthropic
     - Bedrock / Kiro
     - Vertex / Antigravity

2. **多模型扫描模式**
   - 针对同一个中转站，一次性扫描多个模型
   - 检查是否存在“不同模型走不同后端”的混合渠道

3. **负面证据评分**
   - 当前 ApiMaster 已经会检查若干正向特征
   - 后续可以加入“缺失字段扣分”：
     - 例如本该出现但缺失的 inference_geo / cache_creation / thinking signature / ratelimit headers

4. **ratelimit 动态验证**
   - 不只展示 ratelimit header
   - 还验证 remaining 是否真的变化
   - 用于判断 header 是真实上游透传还是伪造注入

5. **更明确的指纹解释区**
   - 将 tool_use id / message id / thinking signature / usage 风格等判据做成更清晰的证据面板

---

## 说明

ApiMaster 是基于上述几个方向做的**整合型本地测试工具**：

- 不等同于原项目功能全集
- 不是对原仓库页面与结构的直接复刻
- 主要吸收了：
  - 检测方法
  - 测试思路
  - 产品目标

然后结合当前项目自己的前端结构、交互方式与本地代理实现，整理成一个更适合日常测试的工作台。

---

## 目录说明

```text
public/      前端页面与静态资源
server/      本地代理与检测 / 测试接口
_ref/        参考项目存档
```

---

## 后续可扩展方向

- 更多上游协议兼容检测
- 更精细的评分策略
- 更多 Needle 数据集
- 更多导出格式
- 批量测试与报告生成
