import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { fetchWechatQr, fetchWechatQrStatus } from "@/lib/api";
import { useAuth } from "@/store/auth";

const POLL_INTERVAL_MS = 1800;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "showing"; qr: string; statusText: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** 微信扫码登录：生成小程序码 → 轮询确认结果 → 领取 token 登录 */
export function WechatQrLogin() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const loginWithToken = useAuth((s) => s.loginWithToken);
  const timerRef = useRef<number | null>(null);

  function stopPolling() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  function poll(ticket: string) {
    const tick = async () => {
      let res;
      try {
        res = await fetchWechatQrStatus(ticket);
      } catch {
        // 单次轮询失败（网络抖动）不算终态，下一轮继续
        timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      if (res.status === "confirmed") {
        stopPolling();
        setPhase({ kind: "done" });
        loginWithToken(res.token, res.username);
        return;
      }
      if (res.status === "cancelled") {
        stopPolling();
        setPhase({ kind: "error", message: "本次登录已在手机上取消，请重新生成二维码" });
        return;
      }
      if (res.status === "expired") {
        stopPolling();
        setPhase({ kind: "error", message: "二维码已过期，请重新生成" });
        return;
      }
      setPhase((p) =>
        p.kind === "showing" ? { ...p, statusText: "等待手机扫码确认…" } : p);
      timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
    };
    timerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
  }

  async function generate() {
    stopPolling();
    setPhase({ kind: "loading" });
    try {
      const { ticket, qr_image } = await fetchWechatQr();
      setPhase({ kind: "showing", qr: qr_image, statusText: "请用微信扫一扫" });
      poll(ticket);
    } catch (e) {
      const detail = axios.isAxiosError(e)
        ? (e.response?.data as { detail?: string } | undefined)?.detail
        : undefined;
      setPhase({ kind: "error", message: detail || "生成二维码失败，请稍后重试" });
    }
  }

  if (phase.kind === "done") {
    return <p className="text-center text-[13px] text-match">登录成功，正在进入…</p>;
  }

  return (
    <div className="space-y-3">
      {(phase.kind === "showing" || phase.kind === "loading") && (
        <div className="flex flex-col items-center gap-2">
          {phase.kind === "showing" ? (
            <img
              src={phase.qr}
              alt="微信扫码登录二维码"
              className="h-44 w-44 rounded border border-line bg-white p-1"
            />
          ) : (
            <div className="grid h-44 w-44 place-items-center rounded border border-line bg-white text-[13px] text-ink-soft">
              二维码生成中…
            </div>
          )}
          <p className="text-[13px] text-ink-soft">
            {phase.kind === "showing" ? phase.statusText : " "}
          </p>
        </div>
      )}
      {phase.kind === "error" && (
        <p className="text-center text-[13px] text-match">{phase.message}</p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={phase.kind === "loading"}
        onClick={generate}
      >
        {phase.kind === "showing" || phase.kind === "error" ? "重新生成二维码" : "微信扫码登录"}
      </Button>
      <p className="text-center text-[12px] leading-5 text-ink-soft">
        用微信扫描二维码，在手机上确认即可完成登录
      </p>
    </div>
  );
}
