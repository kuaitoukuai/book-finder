const { request } = require('../../utils/request');

Page({
  data: {
    mode: 'login', // login | register
    username: '',
    password: '',
    loading: false
  },

  onSwitchMode() {
    this.setData({ mode: this.data.mode === 'login' ? 'register' : 'login' });
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  // 登录成功后统一处理
  handleAuthSuccess(res, msg) {
    wx.setStorageSync('token', res.token);
    wx.setStorageSync('username', res.username);
    getApp().globalData.token = res.token;
    getApp().globalData.username = res.username;
    wx.showToast({ title: msg, icon: 'success' });
    wx.switchTab({ url: '/pages/index/index' });
  },

  // 微信一键登录
  onWechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          this.setData({ loading: false });
          wx.showToast({ title: '微信登录失败：未获取到 code', icon: 'none' });
          return;
        }
        request({
          url: '/api/auth/wechat',
          method: 'POST',
          data: { code: loginRes.code },
          skipAuth: true
        })
          .then((res) => {
            this.handleAuthSuccess(res, '登录成功');
          })
          .catch((err) => {
            wx.showToast({ title: err.message, icon: 'none' });
          })
          .finally(() => {
            this.setData({ loading: false });
          });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '微信登录调用失败', icon: 'none' });
      }
    });
  },

  onSubmit() {
    const { mode, username, password } = this.data;
    if (!username.trim()) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    if (password.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    request({
      url: mode === 'login' ? '/api/login' : '/api/register',
      method: 'POST',
      data: { username: username.trim(), password },
      skipAuth: true
    })
      .then((res) => {
        this.handleAuthSuccess(res, mode === 'login' ? '登录成功' : '注册成功');
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  }
});
