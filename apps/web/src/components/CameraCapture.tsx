import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** 摄像头拍照：getUserMedia 预览 + 拍照出图 */
export function CameraCapture({ onCapture, onClose, onFallback }: {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** getUserMedia 不可用/被拒时的降级（如调起系统相机） */
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // navigator.mediaDevices 在非安全上下文（http 且非 localhost）是 undefined，
  // 可选链之后的 .then 会直接抛 TypeError，所以不支持时直接给出可读提示并走降级。
  // 这里用惰性初始值而不是在 effect 里 setState，避免"同步 setState 触发额外渲染"。
  const [error, setError] = useState(() =>
    typeof navigator.mediaDevices?.getUserMedia === "function"
      ? "" : "当前环境不支持摄像头（需 HTTPS 或 localhost）");

  useEffect(() => {
    let cancelled = false;
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") return;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("无法打开摄像头（可能未授权或设备不支持）"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("无法创建绘图上下文，请换用系统相机拍照");
      return;
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("拍照失败，请重试");
        return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      onCapture(new File([blob], `拍照_${stamp}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="mt-3.5 rounded-md border border-line bg-white px-3 py-3">
      {error ? (
        <div className="text-[13px]">
          <p className="text-match">{error}</p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" onClick={onFallback}>
              改用系统相机拍照
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef} autoPlay playsInline muted
            className="block max-h-[55vh] max-w-full rounded bg-black"
          />
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" onClick={shoot}>拍照</Button>
            <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          </div>
        </>
      )}
    </div>
  );
}
