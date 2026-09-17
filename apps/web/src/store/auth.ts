import axios from "axios";
import { create } from "zustand";

const TOKEN_KEY = "v3_token";
const USER_KEY = "v3_username";

interface AuthState {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  /** 扫码登录等已拿到 token 的场景：直接写入，与账密登录同一套存储 */
  loginWithToken: (token: string, username: string) => void;
  logout: () => void;
}

// localStorage 在隐私模式 / 禁用 Cookie 的浏览器里读写会直接抛 SecurityError，
// store 是在模块加载时初始化的，不包一层会让整个应用白屏。
function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* 存储被禁用或已满：登录态只在内存里，功能仍可用 */ }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* 忽略 */ }
}

function extractError(e: unknown): Error {
  if (axios.isAxiosError(e)) {
    const detail = (e.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) return new Error(detail);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export const useAuth = create<AuthState>((set) => ({
  token: readLS(TOKEN_KEY),
  username: readLS(USER_KEY),

  login: async (username, password) => {
    try {
      const { data } = await axios.post<{ token: string; username: string }>(
        "/api/login", { username, password });
      writeLS(TOKEN_KEY, data.token);
      writeLS(USER_KEY, data.username);
      set({ token: data.token, username: data.username });
    } catch (e) {
      throw extractError(e);
    }
  },

  register: async (username, password) => {
    try {
      const { data } = await axios.post<{ token: string; username: string }>(
        "/api/register", { username, password });
      writeLS(TOKEN_KEY, data.token);
      writeLS(USER_KEY, data.username);
      set({ token: data.token, username: data.username });
    } catch (e) {
      throw extractError(e);
    }
  },

  loginWithToken: (token, username) => {
    writeLS(TOKEN_KEY, token);
    writeLS(USER_KEY, username);
    set({ token, username });
  },

  logout: () => {
    removeLS(TOKEN_KEY);
    removeLS(USER_KEY);
    set({ token: null, username: null });
  },
}));
