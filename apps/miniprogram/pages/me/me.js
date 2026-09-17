const { getToken } = require('../../utils/request');

Page({
  data: {
    username: ''
  },

  onShow() {
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({ username: wx.getStorageSync('username') || '' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return;
        wx.removeStorageSync('token');
        wx.removeStorageSync('username');
        getApp().globalData.token = '';
        getApp().globalData.username = '';
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  },

  onAbout() {
    wx.showModal({
      title: '关于',
      content: '架上寻书 V3 小程序端\n拍摄书架照片，AI 识别书籍并定位，支持多书搜索与 Excel 导出。',
      showCancel: false
    });
  }
});
