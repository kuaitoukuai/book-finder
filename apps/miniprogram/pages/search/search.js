const { request, getToken } = require('../../utils/request');

Page({
  data: {
    text: '',
    searching: false,
    results: []
  },

  onShow() {
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSearch() {
    const queries = this.data.text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (queries.length === 0) {
      wx.showToast({ title: '请输入书名，每行一个', icon: 'none' });
      return;
    }
    if (queries.length > 50) {
      wx.showToast({ title: '一次最多搜索 50 本', icon: 'none' });
      return;
    }
    this.setData({ searching: true, results: [] });
    request({ url: '/api/search', method: 'POST', data: { queries } })
      .then((res) => {
        const pct = (m) => ({ ...m, confidencePct: Math.round((m.confidence || 0) * 100) });
        const results = (res.results || []).map((it) => {
          const matches = (it.matches || []).map(pct);
          const others = matches
            .filter((m) => !it.best ||
              !(m.record_id === it.best.record_id && m.index === it.best.index))
            // 单用 index 作 wx:key 会在跨记录出现相同书序时重复，拼上 record_id 保证唯一
            .map((m) => ({ ...m, key: String(m.record_id || '') + '#' + m.index }));
          return {
            query: it.query,
            best: it.best ? pct(it.best) : null,
            others
          };
        });
        this.setData({ results });
      })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
      })
      .finally(() => {
        this.setData({ searching: false });
      });
  },

  onTapMatch(e) {
    const m = e.currentTarget.dataset.match;
    wx.showModal({
      title: m.title,
      content: '书架：' + (m.shelf || '-') +
        '\n第 ' + m.index + ' 本' +
        '\n所在记录：' + m.record_name +
        '\n识别置信度：' + Math.round((m.confidence || 0) * 100) + '%' +
        '\n匹配得分：' + Math.round((m.score || 0) * 100) + '%',
      showCancel: false
    });
  }
});
