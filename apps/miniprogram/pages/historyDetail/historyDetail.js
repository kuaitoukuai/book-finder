const { request, getToken, BASE_URL } = require('../../utils/request');

Page({
  data: {
    record: null,
    imageUrl: '',
    loading: true
  },

  onLoad(options) {
    const rid = options.rid;
    this.rid = rid;
    const token = getToken();
    this.setData({
      imageUrl: BASE_URL + '/results/' + rid + '/image.jpg?token=' + encodeURIComponent(token)
    });
    request({ url: '/api/results/' + rid })
      .then((record) => {
        const books = (record.books || []).map((b) => ({
          ...b,
          confidencePct: Math.round((b.confidence || 0) * 100)
        }));
        this.setData({ record: { ...record, books } });
        wx.setNavigationBarTitle({ title: record.name || '记录详情' });
      })
      .catch((err) => {
        wx.showModal({ title: '加载失败', content: err.message, showCancel: false });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onPreviewImage() {
    wx.previewImage({ urls: [this.data.imageUrl] });
  },

  onImgError() {
    wx.showToast({ title: '图片加载失败，请重新登录', icon: 'none' });
  }
});
