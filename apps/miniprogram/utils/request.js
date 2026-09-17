const { BASE_URL } = require('./config');

function getToken() {
  return wx.getStorageSync('token') || '';
}

// 多个并发请求同时 401 时，避免连续 wx.reLaunch 造成跳转风暴（reLaunch:fail）
let _last401At = 0;

function handle401() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('username');
  const now = Date.now();
  if (now - _last401At < 1500) return;
  _last401At = now;
  wx.reLaunch({ url: '/pages/login/login' });
}

// 通用 JSON 请求，自动带 token，401 跳登录
// skipAuth: 登录类接口（login/register/auth/wechat）传 true，401 作为普通错误返回给页面
function request({ url, method = 'GET', data, skipAuth }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: { Authorization: 'Bearer ' + getToken() },
      success(res) {
        if (res.statusCode === 401 && !skipAuth) {
          handle401();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const detail = (res.data && res.data.detail) || ('请求失败（' + res.statusCode + '）');
        reject(new Error(detail));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误，请检查后端服务是否启动'));
      }
    });
  });
}

// 解析 SSE 文本：wx.request/wx.uploadFile 不支持流式读取，
// 服务端会把整段 text/event-stream 一次性返回，这里取最后一个 done 事件的 JSON。
function parseSse(text) {
  const lines = String(text || '').split(/\r?\n/);
  let curEvent = '';
  let dataLines = [];
  let lastDone = null;
  let errMsg = null;

  function flush() {
    if (!curEvent || dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    try {
      const obj = JSON.parse(payload);
      if (curEvent === 'done') lastDone = obj;
      else if (curEvent === 'error') errMsg = obj.error || '识别失败';
    } catch (e) {
      // 忽略无法解析的事件
    }
  }

  for (const line of lines) {
    if (line === '') {
      flush();
      curEvent = '';
      dataLines = [];
      continue;
    }
    if (line.indexOf('event:') === 0) curEvent = line.slice(6).trim();
    else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
  }
  flush();

  if (lastDone) return lastDone;
  throw new Error(errMsg || '识别失败：服务端未返回结果');
}

// 上传识别（multipart）。crop 为 "x0,y0,x1,y1" 归一化字符串（可为空字符串）。
function uploadRecognize({ filePath, name, crop, skipAuth }) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + '/api/recognize',
      filePath,
      name: 'image',
      // 整架识别要跑多个切块的视觉接口，默认 60s 超时对大图偏短，
      // 超时会以 fail 分支返回笼统的"上传失败"，这里放宽到 5 分钟。
      timeout: 300000,
      formData: {
        tiles: '1',
        name: name || '',
        crop: crop || ''
      },
      header: { Authorization: 'Bearer ' + getToken() },
      success(res) {
        if (res.statusCode === 401 && !skipAuth) {
          handle401();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let detail = '识别请求失败（' + res.statusCode + '）';
          try {
            const d = JSON.parse(res.data);
            if (d && d.detail) detail = d.detail;
          } catch (e) {}
          reject(new Error(detail));
          return;
        }
        try {
          resolve(parseSse(res.data));
        } catch (e) {
          reject(e);
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '上传失败，请检查网络与后端服务'));
      }
    });
  });
}

// 下载文件（带 token），用于导出 Excel
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: BASE_URL + url,
      header: { Authorization: 'Bearer ' + getToken() },
      success(res) {
        if (res.statusCode === 401) {
          handle401();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error('下载失败（' + res.statusCode + '）'));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail(err) {
        reject(new Error(err.errMsg || '下载失败'));
      }
    });
  });
}

// 删除单条识别记录
function deleteResult(rid) {
  return request({ url: '/api/results/' + rid, method: 'DELETE' });
}

// 删除当前用户全部识别记录（不可逆）
function deleteAllResults() {
  return request({ url: '/api/results/delete_all', method: 'POST' });
}

module.exports = {
  request,
  uploadRecognize,
  downloadFile,
  deleteResult,
  deleteAllResults,
  getToken,
  BASE_URL
};
