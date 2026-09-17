# -*- coding: utf-8 -*-
"""微信小程序登录（code2session）测试。"""
import requests

import main
from conftest import auth_headers
from core import auth


class _FakeResp:
    """模拟 requests.get 的响应对象。"""

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def _mock_code2session(monkeypatch, payload):
    """配好微信凭据并把 code2session 的 requests.get 替换为假返回。"""
    monkeypatch.setattr(main, "WECHAT_APPID", "test-appid")
    monkeypatch.setattr(main, "WECHAT_SECRET", "test-secret-wx")
    monkeypatch.setattr(requests, "get",
                        lambda *a, **kw: _FakeResp(payload))


class TestWechatLogin:
    def test_not_configured_503(self, client, monkeypatch):
        monkeypatch.setattr(main, "WECHAT_APPID", "")
        monkeypatch.setattr(main, "WECHAT_SECRET", "")
        r = client.post("/api/auth/wechat", json={"code": "abc"})
        assert r.status_code == 503
        assert r.json()["detail"] == "微信登录未配置"

    def test_new_user_created(self, client, monkeypatch):
        openid = "oABCDEFGH1234567890"
        _mock_code2session(monkeypatch,
                           {"openid": openid, "session_key": "sk"})
        r = client.post("/api/auth/wechat", json={"code": "abc"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token"]
        assert body["username"] == "wx_" + openid[:8]
        # 用户确实落库且绑定 openid
        assert auth.find_user_by_openid(openid) == body["username"]
        # token 可用
        me = client.get("/api/me", headers=auth_headers(body["token"]))
        assert me.status_code == 200
        assert me.json()["username"] == body["username"]

    def test_repeat_login_same_user(self, client, monkeypatch):
        payload = {"openid": "oXYZXYZXY987654321", "session_key": "sk"}
        _mock_code2session(monkeypatch, payload)
        r1 = client.post("/api/auth/wechat", json={"code": "c1"})
        r2 = client.post("/api/auth/wechat", json={"code": "c2"})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["username"] == r2.json()["username"]

    def test_errcode_401(self, client, monkeypatch):
        _mock_code2session(monkeypatch,
                           {"errcode": 40029, "errmsg": "invalid code"})
        r = client.post("/api/auth/wechat", json={"code": "bad"})
        assert r.status_code == 401
        assert r.json()["detail"] == "微信登录失败: invalid code"

    def test_wechat_user_cannot_password_login(self, client, monkeypatch):
        openid = "oNOPASSWD1234567890"
        _mock_code2session(monkeypatch,
                           {"openid": openid, "session_key": "sk"})
        r = client.post("/api/auth/wechat", json={"code": "abc"})
        assert r.status_code == 200
        username = r.json()["username"]
        # 无密码用户用任何密码登录都应 401
        r = client.post("/api/login",
                        json={"username": username, "password": "pass123"})
        assert r.status_code == 401
        assert r.json()["detail"] == "用户名或密码错误"
