App({
  globalData: {
    token: '',
    username: ''
  },
  onLaunch() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.token = token;
      this.globalData.username = wx.getStorageSync('username') || '';
    }
  }
});
