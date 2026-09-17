# -*- coding: utf-8 -*-
"""启动辅助脚本（仅供 启动图书查找V3.bat 调用，不要直接运行）。

V3 出于安全只从环境变量读取密钥。本脚本从 data/secrets.json 读出密钥，
输出一批 set 命令到 stdout，由 bat 捕获后 call 执行，完成环境变量注入。
secrets.json 不存在时会自动从模板生成，需手工填入 api_key。
令牌签名密钥固定保存在 data/secret.key（首次运行自动生成），保证重启后登录态不失效。
"""
import json
import secrets as _secrets
import sys
from pathlib import Path

base = Path(__file__).resolve().parent
data = base / "data"
data.mkdir(exist_ok=True)

secrets_file = data / "secrets.json"
if not secrets_file.exists():
    secrets_file.write_text(json.dumps(
        {"api_key": "", "wechat_appid": "", "wechat_secret": "",
         "mimo_api_key": "", "doubao_api_key": "", "qwen_api_key": "",
         "ernie_api_key": "", "openrouter_api_key": "", "glm_api_key": ""},
        ensure_ascii=False, indent=2), encoding="utf-8")
cfg = json.loads(secrets_file.read_text(encoding="utf-8"))

api_key = str(cfg.get("api_key") or "").strip()
if not api_key:
    sys.exit("data/secrets.json 里没有 api_key，识别功能不可用")

key_file = data / "secret.key"
if key_file.exists():
    secret = key_file.read_text(encoding="ascii").strip()
else:
    secret = _secrets.token_hex(32)
    key_file.write_text(secret, encoding="ascii")

print(f"set DEEPSEEK_API_KEY={api_key}")
print(f"set BOOKFINDER_SECRET={secret}")
print(f"set WECHAT_APPID={str(cfg.get('wechat_appid') or '').strip()}")
print(f"set WECHAT_SECRET={str(cfg.get('wechat_secret') or '').strip()}")
# 多视觉供应商密钥（可选，配了哪个才启用哪个）
for env_name, v in (
    ("MIMO_API_KEY", "mimo_api_key"),
    ("DOUBAO_API_KEY", "doubao_api_key"),
    ("QWEN_API_KEY", "qwen_api_key"),
    ("ERNIE_API_KEY", "ernie_api_key"),
    ("OPENROUTER_API_KEY", "openrouter_api_key"),
    ("GLM_API_KEY", "glm_api_key"),
):
    val = str(cfg.get(v) or "").strip()
    if val:
        print(f"set {env_name}={val}")
