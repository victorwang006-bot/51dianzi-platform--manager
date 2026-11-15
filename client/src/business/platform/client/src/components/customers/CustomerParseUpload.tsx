import React, { useEffect, useRef, useState } from "react";
import { Button } from "../channelInventory/bridge";
import { validateFile, type History } from "./customerUploadHistory";
import "./CustomerUploadHistory.css";

type Props = { persistOriginal: (file: File, mode: "parse") => Promise<History>; isCurrent: () => boolean; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void };
export function CustomerParseUpload(props: Props) {
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false);
  const [history, setHistory] = useState<History | null>(null); const [error, setError] = useState(""); const mounted = useRef(true); const running = useRef(false);
  const latest = useRef(props); latest.current = props;
  const current = () => mounted.current && latest.current.isCurrent();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (!file || running.current || !current()) return; running.current = true; setBusy(true); setError(""); props.onBusyChange(true);
    try { validateFile(file); const saved = await latest.current.persistOriginal(file, "parse"); if (!current()) return; setHistory(saved); setUnknown(false); latest.current.onDirtyChange(false); }
    catch (error) { if (current()) { setUnknown(true); setError(error instanceof Error ? error.message : "原文件提交结果待确认，请使用同一文件、同一请求重试。"); } }
    finally { running.current = false; if (current()) { setBusy(false); latest.current.onBusyChange(false); } }
  };
  return <section className="customer-parse-upload">
    <p>每日由管理员人工集中下载任务、使用 Manus 整理后按任务UUID回传。此处仅保存私有原表，不创建正式库存、渠道或批次。</p>
    {history ? <div role="status"><strong>已提交，等待解析</strong><p>任务UUID：<code>{history.historyId}</code></p><p>原文件：{history.originalFile.fileName}；关闭页面后原文件与任务仍保存在服务端，可从“解析历史”查看。</p></div> : <>
      <label className="ci-field"><span>解析原表（.xlsx/.xls/.csv，最多10MiB）</span><input type="file" accept=".xlsx,.xls,.csv" aria-label="上传待解析原表" disabled={busy || unknown} onChange={event => { const selected = event.target.files?.[0]; if (!selected) return; try { validateFile(selected); setFile(selected); setError(""); latest.current.onDirtyChange(true); } catch (error) { setError(error instanceof Error ? error.message : "文件无效"); } event.target.value = ""; }} /></label>
      {file ? <p>{file.name} · {file.size} 字节</p> : null}
      {unknown ? <p role="status">提交可能已到达服务端。请保留原文件并重试原请求；不会更换任务操作UUID。若已关闭页面，请先查看历史，勿重复提交。</p> : null}
      <Button type="button" className="ci-button ci-primary" disabled={!file || busy} onClick={() => void submit()}>{busy ? "正在保存原文件…" : unknown ? "按原UUID重试提交" : "提交，等待解析"}</Button>
    </>}
    {error ? <p className="ci-error" role="alert">{error}</p> : null}
  </section>;
}
