// 微信扫码登录 · 确认页（小程序端）
//
// 由「扫码进入小程序」触发（小程序码 scene 携带 ticket）：
//   1. onLoad 取 ticket（scene 需 decodeURIComponent，兼容 query ticket）；
//   2. wx.login() 拿 code（静默，不弹授权框），POST /api/auth/wechat/confirm；
//   3. 真正的登录发生在电脑浏览器上，本页不接收也不需要 token；
//   4. 提供「不是我操作的」取消入口（作废票据，防 QRLJacking），
//      成功后引导退出小程序。

const { request } = require('../../utils/request');

const SITE_NAME = '架上寻书';

// 与后端 core/scan_login.py 的 TICKET_RE 保持一致
const TICKET_PATTERN = /^[a-f0-9]{32}$/;

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res && res.code) resolve(res.code);
        else reject(new Error('未能取得登录凭证，请重试'));
      },
      fail: () => reject(new Error('微信登录失败，请重试'))
    });
  });
}

Page({
  data: {
    siteName: SITE_NAME,
    /** working | success | cancelled | failed */
    state: 'working',
    errorText: ''
  },

  /** 本次登录对应的票据，存在实例上而不是 data（不需要渲染） */
  ticket: '',

  onLoad(options) {
    // 扫码进入时 scene 会被微信做一次 URL 编码，必须 decode
    const fromScene = options && options.scene ? decodeURIComponent(options.scene) : '';
    // 开发者工具用「编译模式」调试时走普通 query
    const fromQuery = (options && options.ticket) || '';
    const ticket = String(fromScene || fromQuery).trim();

    if (!TICKET_PATTERN.test(ticket)) {
      this.setData({
        state: 'failed',
        errorText: '二维码无效或已过期，请在电脑上重新生成后扫码'
      });
      return;
    }

    this.ticket = ticket;
    this.confirm();
  },

  async confirm() {
    try {
      const code = await wxLogin();
      await request({
        url: '/api/auth/wechat/confirm',
        method: 'POST',
        data: { ticket: this.ticket, code },
        skipAuth: true
      });
      this.setData({ state: 'success' });
      if (wx.vibrateShort) {
        try {
          wx.vibrateShort({ type: 'light' });
        } catch (e) {
          /* 部分基础库/机型不支持，静默忽略 */
        }
      }
    } catch (err) {
      this.setData({
        state: 'failed',
        errorText: (err && err.message) || '登录未完成，请在电脑上重新扫码'
      });
    }
  },

  /** 「不是我操作的」→ 作废票据，电脑端会立刻收到 cancelled */
  onCancel() {
    wx.showModal({
      title: '不是我操作的？',
      content: '将作废本次登录，电脑上的二维码随即失效。',
      confirmText: '取消登录',
      cancelText: '继续',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({
            url: '/api/auth/wechat/cancel',
            method: 'POST',
            data: { ticket: this.ticket },
            skipAuth: true
          });
        } catch (e) {
          // 取消失败不影响安全：不做确认动作，票据到期后自然作废
        }
        this.setData({ state: 'cancelled' });
      }
    });
  },

  /** 成功后引导离开小程序 */
  onDone() {
    if (wx.exitMiniProgram) {
      wx.exitMiniProgram({
        // 扫码进入的场景不一定允许主动退出，失败时给出手动指引
        fail: () => {
          wx.showToast({ title: '请点右上角关闭本页', icon: 'none', duration: 2500 });
        }
      });
      return;
    }
    wx.showToast({ title: '请点右上角关闭本页', icon: 'none', duration: 2500 });
  },

  /** 失败后返回登录页（扫码进入时页面栈只有本页，navigateBack 不可用） */
  onBack() {
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
