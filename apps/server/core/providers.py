# -*- coding: utf-8 -*-
"""多视觉模型供应商注册表 + 通用 OpenAI 兼容视觉调用。

V3 只从环境变量读密钥，本模块只定义“供应商长什么样”（base_url / 模型 / 所需密钥名），
具体 key 由 main.py 从环境变量注入（gen_env.py 从 data/secrets.json 打出 set 命令）。
所有供应商均为 OpenAI 兼容的 /chat/completions，图片走 image_url 的 base64 data URI。
"""
import base64
import logging
import time

import requests

logger = logging.getLogger("bookfinder.vision")

# 供应商定义：name -> 描述。env 是注入密钥的环境变量名；thinking=True 用于需要在
# 请求体里禁用思考模式的兼容端点（目前只有 DeepSeek）。
PROVIDER_DEFS = {
    "deepseek": {
        "label": "DeepSeek flash",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-flash",
        "env": "DEEPSEEK_API_KEY",
        "thinking": True,
        "note": "最快最准，架上寻书主力",
    },
    "mimo": {
        "label": "小米 MiMo",
        "base_url": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5",
        "env": "MIMO_API_KEY",
        "note": "准，最佳备选",
    },
    "doubao": {
        "label": "火山豆包",
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-2-0-pro-260215",
        "env": "DOUBAO_API_KEY",
        "note": "准",
    },
    "qwen": {
        "label": "阿里百炼 Qwen",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen3-vl-plus",
        "env": "QWEN_API_KEY",
        "note": "可能有零星插字错误",
    },
    "ernie": {
        "label": "百度千帆 Ernie",
        "base_url": "https://qianfan.baidubce.com/v2",
        "model": "ernie-5.0",
        "env": "ERNIE_API_KEY",
        "note": "准但较慢",
    },
    "openrouter": {
        "label": "OpenRouter Lingo(free)",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "inclusionai/ling-3.0-flash-vl:free",
        "env": "OPENROUTER_API_KEY",
        "note": "免费兜底",
    },
    "glm": {
        "label": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model": "glm-5.3-flash",
        "env": "GLM_API_KEY",
        "note": "新模型视觉可用",
    },
}

DEFAULT_PROVIDER = "deepseek"

# 共享识别指令：所有供应商用同一份提示词。
PROMPT = (
    "这是一张图书馆书架照片。请识别图中每一本书的书脊，从左到右、从上到下。"
    "对每本书输出：shelf（该书所在书架的编号架标，如 A-03、I24、12架，通常印在层板侧面或"
    "立柱的大标签上；照片中看不到架标则填空字符串）、"
    "title（书脊上的书名，竖排文字按阅读顺序转为一行；书名在书脊上分多行/多段印刷时，"
    "按阅读顺序合并为一个 title。特别注意副标题：很多书在主书名之外还印有副标题，"
    "常以\"——\"\"-\"\"：\"\"·\"连接，或排成一行较小的字；只要书脊上印有副标题，"
    "就必须把它一并读入 title，主书名+副标题合并成一条输出，绝不能只输出主书名、"
    "把副标题漏掉。例如主书名\"沟通错位\"配副标题\"皆大欢喜的谈判妙招\"，"
    "应输出\"沟通错位——皆大欢喜的谈判妙招\"。看不清则填空字符串）、"
    "author（作者只许老老实实读书脊上印刷的作者名，去掉\"著\"\"著者\"\"◎著\"\"主编\""
    "\"编\"\"绘\"\"译\"等字样，只留人名；如果书脊上作者字太小、模糊、反光、"
    "或根本没有作者，则 author 一律填空字符串——严格禁止凭书名去联想、"
    "靠印象背出你自以为什么人写的书，宁可留空也绝不编造作者名）、"
    "看不清的字不要凭印象瞎猜：请在被裁到看不清的位置自行放大、仔细辨认，"
    "能看清再如实填写，实在看不清才留空；宁可少认也不要编造。"
    "bbox（书脊在图中的包围盒，应框住整条书脊而非某一段文字，"
    "归一化坐标 [x1,y1,x2,y2]，0~1，保留3位小数）、"
    "confidence（你对该书名的置信度，0~1）。"
    "注意：一条物理书脊只输出一本书。书脊上除书名外常印有作者名、卷数/系列数字"
    "（如 \"37\"）、出版社名，这些都不是独立的书，不要单独输出；"
    "作者填入 author 字段，卷数若是书脊主体文字的一部分可并入 title。"
    "架标通常同时印有分类号和类目名两部分（如 \"C912.22/44422 社会团体\"），"
    "请把架标完整读出，两部分用空格连接；"
    "书脊底部小贴纸上的索书号（如 TP18、C912.2 等字母数字编号）不是书名也不是架标，不要读取；"
    "书脊上没有可辨认书名时 title 留空。在图片边缘被裁掉大半、几乎看不到书脊的书不要输出。"
    "位于图片上边缘或下边缘、书脊被画面边框裁断（看不到书脊完整的顶端或底端）的整排书，"
    "一律不要输出。"
    "只输出 JSON 数组，不要输出任何其他文字、解释或代码围栏。"
)


def call_vision_any(image_bytes: bytes, *, base_url: str, api_key: str,
                    model: str, thinking: bool = False, label: str = "",
                    retries: int = 2) -> str:
    """对任意 OpenAI 兼容视觉端点做一次整图识别，返回模型原文（JSON 数组字符串）。"""
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{b64}",
                               "detail": "original"}},
            ],
        }],
        "max_tokens": 32000,
        "temperature": 0.1,
    }
    if thinking:
        payload["thinking"] = {"type": "disabled"}
    if not api_key:
        raise RuntimeError(f"服务端未配置 {label or '该供应商'} API Key："
                           f"请设置环境变量后重启服务")
    name = label or model
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
                json=payload, timeout=300,
            )
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            if resp.status_code in (401, 403):
                raise RuntimeError(f"{name} 的 API Key 无效或无权限，请检查配置")
            resp.raise_for_status()
            try:
                data = resp.json()
            except ValueError as e:
                raise ValueError(f"{name} 返回非 JSON: {resp.text[:200]}") from e
            if not data.get("choices"):
                raise ValueError(f"{name} 返回无 choices: {str(data)[:300]}")
            choice = data["choices"][0]
            if choice.get("finish_reason") == "length":
                logger.warning("%s 输出被 max_tokens 截断", name)
            return choice["message"].get("content") or ""
        except (requests.Timeout, requests.ConnectionError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise last_err if last_err else RuntimeError(f"{name} 视觉接口调用失败：未知错误")