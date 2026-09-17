const { uploadRecognize, getToken } = require('../../utils/request');

// 与后端 /api/recognize 的上传限制保持一致：
// MAX_UPLOAD_BYTES=30MB、MAX_IMAGE_PIXELS=5000 万像素，超出后端会 413/400。
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50 * 1000 * 1000;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 上传前预检：提前拦截超大/超高分辨率图片并给出友好提示，
// 避免用户白等一次上传（后端会以 413/400 拒绝）。返回错误文案，通过则返回 ''。
function checkImageLimit(file) {
  if (!file) return '';
  if (file.size && file.size > MAX_UPLOAD_BYTES) {
    return '图片过大，请压缩到 30MB 以内';
  }
  if (file.width && file.height && file.width * file.height > MAX_IMAGE_PIXELS) {
    return '图片分辨率过高，请压缩后重试';
  }
  return '';
}

Page({
  data: {
    step: 'pick', // pick | crop | result
    cameraOn: false,
    imagePath: '',
    stageW: 0,
    stageH: 0,
    rect: { x: 0, y: 0, w: 0, h: 0 },
    recognizing: false,
    record: null
  },

  onLoad() {
    let winW = 375;
    try {
      winW = wx.getWindowInfo().windowWidth;
    } catch (e) {
      winW = wx.getSystemInfoSync().windowWidth;
    }
    this.stageW = winW - 32; // 两侧各 16px 边距
  },

  onShow() {
    if (!getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  },

  // ---------- 取图 ----------
  onChooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        const limitMsg = checkImageLimit(file);
        if (limitMsg) {
          wx.showToast({ title: limitMsg, icon: 'none' });
          return;
        }
        this.enterCrop(file.tempFilePath);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return; // 用户主动取消，静默
        if (/auth|deny|permission/i.test(msg)) {
          wx.showModal({
            title: '需要授权',
            content: '请在设置中允许使用相机和相册后再试。',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            }
          });
        } else {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  },

  onToggleCamera() {
    this.setData({ cameraOn: !this.data.cameraOn });
  },

  onTakePhoto() {
    wx.createCameraContext().takePhoto({
      quality: 'high',
      success: (res) => {
        this.setData({ cameraOn: false });
        this.enterCrop(res.tempImagePath);
      },
      fail: () => {
        wx.showToast({ title: '拍摄失败', icon: 'none' });
      }
    });
  },

  onCameraError(e) {
    wx.showModal({
      title: '相机不可用',
      content: '请在系统设置中允许小程序使用相机，或改用相册选图。',
      showCancel: false
    });
    this.setData({ cameraOn: false });
  },

  enterCrop(path) {
    this.setData({ step: 'crop', imagePath: path, record: null });
  },

  // ---------- 裁剪框 ----------
  onImgLoad(e) {
    const nw = e.detail.width;
    const nh = e.detail.height;
    // 拿不到原始尺寸时直接跳过，避免 maxW/nw 出现除零 → scale=Infinity → stageW=NaN
    if (!nw || !nh) return;
    const MAX_STAGE_H = 1200; // 超长图高度上限，避免页面被撑爆
    const maxW = this.stageW;
    // 统一缩放：宽不超屏、高不超上限，容器与图片实际展示尺寸保持一致
    const scale = Math.min(maxW / nw, MAX_STAGE_H / nh);
    this.scale = scale; // 展示尺寸 / 原始像素
    const stageW = Math.round(nw * scale);
    const stageH = Math.round(nh * scale);
    const insetX = Math.round(stageW * 0.06);
    const insetY = Math.round(stageH * 0.06);
    this.setData({
      stageW,
      stageH,
      rect: {
        x: insetX,
        y: insetY,
        w: stageW - insetX * 2,
        h: stageH - insetY * 2
      }
    });
  },

  onHandleStart(e) {
    this.dragMode = e.currentTarget.dataset.mode;
    const t = e.touches[0];
    this.lastX = t.clientX;
    this.lastY = t.clientY;
  },

  onBodyStart(e) {
    this.dragMode = 'move';
    const t = e.touches[0];
    this.lastX = t.clientX;
    this.lastY = t.clientY;
  },

  onTouchStart(e) {
    if (this.dragMode) return; // 已在拖拽中，忽略第二根手指
    const t = e.touches[0];
    this.lastX = t.clientX;
    this.lastY = t.clientY;
  },

  onTouchMove(e) {
    if (!this.dragMode) return;
    const t = e.touches[0];
    const dx = t.clientX - this.lastX;
    const dy = t.clientY - this.lastY;
    this.lastX = t.clientX;
    this.lastY = t.clientY;

    const r = { ...this.data.rect };
    const W = this.data.stageW;
    const H = this.data.stageH;
    const MIN = 40;
    const mode = this.dragMode;

    if (mode === 'move') {
      r.x = clamp(r.x + dx, 0, W - r.w);
      r.y = clamp(r.y + dy, 0, H - r.h);
    } else {
      if (mode.indexOf('l') >= 0) {
        const nx = clamp(r.x + dx, 0, r.x + r.w - MIN);
        r.w += r.x - nx;
        r.x = nx;
      }
      if (mode.indexOf('r') >= 0) {
        r.w = clamp(r.w + dx, MIN, W - r.x);
      }
      if (mode.indexOf('t') >= 0) {
        const ny = clamp(r.y + dy, 0, r.y + r.h - MIN);
        r.h += r.y - ny;
        r.y = ny;
      }
      if (mode.indexOf('b') >= 0) {
        r.h = clamp(r.h + dy, MIN, H - r.y);
      }
    }
    this.setData({ rect: r });
  },

  onTouchEnd() {
    this.dragMode = null;
  },

  onResetCrop() {
    const W = this.data.stageW;
    const H = this.data.stageH;
    this.setData({
      rect: { x: 0, y: 0, w: W, h: H }
    });
  },

  onCancelCrop() {
    this.setData({ step: 'pick', imagePath: '' });
  },

  // ---------- 确认裁剪并识别 ----------
  onConfirmCrop() {
    if (this._confirming) return; // 防连点重复裁剪/重复上传
    const r = this.data.rect;
    const W = this.data.stageW;
    const H = this.data.stageH;
    // 图片尚未加载完成（stageW/H 或选框为 0）时归一化会产生 NaN 字符串，
    // 后端解析为 400；这里提前拦截并提示。
    if (!W || !H || r.w <= 0 || r.h <= 0) {
      wx.showToast({ title: '请等待图片加载完成', icon: 'none' });
      return;
    }
    this._confirming = true;
    // 归一化 crop（相对原图），同时传给后端做双保险
    const crop = [
      (r.x / W).toFixed(4),
      (r.y / H).toFixed(4),
      ((r.x + r.w) / W).toFixed(4),
      ((r.y + r.h) / H).toFixed(4)
    ].join(',');

    wx.showLoading({ title: '裁剪中…', mask: true });
    this.cropToFile(r)
      .then((filePath) => {
        // canvas 裁剪成功：上传的已是裁剪后的图，crop 必须传空，否则服务端会再裁一次
        wx.hideLoading();
        this.doRecognize(filePath, '');
      })
      .catch(() => {
        // 裁剪失败回退原图，由后端按归一化 crop 裁剪兜底
        wx.hideLoading();
        this.doRecognize(this.data.imagePath, crop);
      });
  },

  // 用 Canvas 2D 按框选区域裁出新临时图片
  cropToFile(rect) {
    return new Promise((resolve, reject) => {
      const scale = this.scale || 1;
      const sx = Math.round(rect.x / scale);
      const sy = Math.round(rect.y / scale);
      const sw = Math.round(rect.w / scale);
      const sh = Math.round(rect.h / scale);
      if (sw < 10 || sh < 10) {
        reject(new Error('crop too small'));
        return;
      }
      // 限制画布尺寸，避免超大图内存溢出
      const MAX = 2048;
      let cw = sw;
      let ch = sh;
      if (cw > MAX || ch > MAX) {
        const k = MAX / Math.max(cw, ch);
        cw = Math.round(cw * k);
        ch = Math.round(ch * k);
      }

      wx.createSelectorQuery()
        .in(this)
        .select('#cropCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            reject(new Error('canvas not found'));
            return;
          }
          const canvas = res[0].node;
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
            wx.canvasToTempFilePath({
              canvas,
              success: (r2) => resolve(r2.tempFilePath),
              fail: reject
            });
          };
          img.onerror = reject;
          img.src = this.data.imagePath;
        });
    });
  },

  doRecognize(filePath, crop) {
    this.setData({ recognizing: true });
    wx.showLoading({ title: '识别中…', mask: true });
    const name = '书架 ' + new Date().toLocaleString();
    uploadRecognize({ filePath, name, crop })
      .then((record) => {
        const books = (record.books || []).map((b) => ({
          ...b,
          confidencePct: Math.round((b.confidence || 0) * 100)
        }));
        this.setData({
          step: 'result',
          record: { ...record, books }
        });
      })
      .catch((err) => {
        wx.showModal({ title: '识别失败', content: err.message, showCancel: false });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({ recognizing: false });
        this._confirming = false;
      });
  },

  // ---------- 结果 ----------
  onTapBook(e) {
    const b = e.currentTarget.dataset.book;
    wx.showModal({
      title: b.title,
      content: '书架：' + (b.shelf || this.data.record.shelf || '-') +
        '\n第 ' + b.index + ' 本' +
        '\n置信度：' + b.confidencePct + '%',
      showCancel: false
    });
  },

  onRestart() {
    this.setData({ step: 'pick', imagePath: '', record: null });
  }
});
