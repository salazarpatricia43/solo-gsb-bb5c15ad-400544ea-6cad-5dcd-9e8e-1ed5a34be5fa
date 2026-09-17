import { useState } from 'react';
import type { PatchOp } from '../merge/rfc6902';
import type { JsonValue } from '../merge/types';

interface Props {
  merged: JsonValue;
  patch: PatchOp[];
  onBack: () => void;
  onRestart: () => void;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function OutputStage({ merged, patch, onBack, onRestart }: Props) {
  const [toast, setToast] = useState<string | null>(null);

  const mergedText = JSON.stringify(merged, null, 2);
  const patchText = JSON.stringify(patch, null, 2);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const handleCopy = async (text: string, label: string) => {
    showToast((await copyText(text)) ? `${label}已复制到剪贴板` : '复制失败，请手动选择复制');
  };

  return (
    <>
      <div className="output-grid">
        <div className="output-panel">
          <h3>合并结果 JSON</h3>
          <pre>{mergedText}</pre>
          <div className="panel-actions">
            <button className="small" onClick={() => void handleCopy(mergedText, '合并结果 ')}>
              复制
            </button>
            <button className="small" onClick={() => download('merged.json', mergedText)}>
              下载 merged.json
            </button>
          </div>
        </div>
        <div className="output-panel">
          <h3>RFC 6902 补丁（基线 → 合并结果）</h3>
          <pre>{patchText}</pre>
          <div className="panel-actions">
            <button className="small" onClick={() => void handleCopy(patchText, '补丁 ')}>
              复制
            </button>
            <button className="small" onClick={() => download('patch.json', patchText)}>
              下载 patch.json
            </button>
          </div>
        </div>
      </div>
      <div className="output-actions">
        <button onClick={onBack}>← 返回继续调整</button>
        <button onClick={onRestart}>重新开始</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
