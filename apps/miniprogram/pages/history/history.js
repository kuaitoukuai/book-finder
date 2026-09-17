const { request, downloadFile, deleteResult, deleteAllResults, getToken } = require('../../utils/request');

Page({
  data: {
    list: [],
    loading: false,
    exporting: false,
    deleting: false
  },

  onShow() {
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.loadList();
  },

  loadList() {
    this.setData({ loading: true });
    request({ url: '/api/results' })
      .then((list) => {
        this.setData({
          list: (list || []).map((it) => ({ ...it, checked: false }))
        });
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onToggleCheck(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.list.map((it) =>
      it.id === id ? { ...it, checked: !it.checked } : it
    );
    this.setData({ list });
  },

  onTapItem(e) {
    if (this.data.deleting) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/historyDetail/historyDetail?rid=' + id });
  },

  // 删除单条记录（catchtap，不触发进入详情）
  onDeleteItem(e) {
    if (this.data.deleting) return;
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((it) => it.id === id);
    wx.showModal({
      title: '删除记录',
      content: '确定删除「' + (item ? item.name : '') + '」吗？图片和识别结果将一起删除，不可恢复。',
      confirmText: '删除',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: '删除中…', mask: true });
        deleteResult(id)
          .then(() => {
            // 本地移除，同时清掉其选中状态
            this.setData({
              list: this.data.list.filter((it) => it.id !== id)
            });
            wx.showToast({ title: '已删除', icon: 'success' });
          })
          .catch((err) => {
            wx.showToast({ title: err.message, icon: 'none' });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ deleting: false });
          });
      }
    });
  },

  // 删除全部记录
  onDeleteAll() {
    if (this.data.deleting) return;
    const total = this.data.list.length;
    if (total === 0) return;
    wx.showModal({
      title: '删除全部记录',
      content: '确定删除全部 ' + total + ' 条记录吗？图片和识别结果将一起删除，不可恢复。',
      confirmText: '全部删除',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: '删除中…', mask: true });
        deleteAllResults()
          .then((r) => {
            this.setData({ list: [] });
            wx.showToast({ title: '已删除 ' + (r.deleted != null ? r.deleted : total) + ' 条', icon: 'none' });
          })
          .catch((err) => {
            wx.showToast({ title: err.message, icon: 'none' });
          })
          .finally(() => {
            wx.hideLoading();
            this.setData({ deleting: false });
          });
      }
    });
  },

  onExport() {
    const ids = this.data.list.filter((it) => it.checked).map((it) => it.id);
    if (ids.length === 0) {
      wx.showToast({ title: '请先勾选要导出的记录', icon: 'none' });
      return;
    }
    this.setData({ exporting: true });
    wx.showLoading({ title: '导出中…', mask: true });
    downloadFile('/api/export?ids=' + ids.join(','))
      .then((filePath) => {
        wx.openDocument({
          filePath,
          fileType: 'xlsx',
          showMenu: true,
          fail: () => {
            wx.showModal({
              title: '提示',
              content: '当前环境无法直接打开 Excel 文件，可在 Web 端导出。',
              showCancel: false
            });
          }
        });
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ exporting: false });
      });
  },

  onPullDownRefresh() {
    this.loadList();
    wx.stopPullDownRefresh();
  }
});
