import { useEffect, useMemo, useRef, useState } from 'react';
import type { PatchOp } from '../merge/rfc6902';
import type { JsonValue } from '../merge/types';
import {
  compileSchema,
  countErrors,
  validateData,
  type CompiledSchema,
  type SchemaErrorGroup,
  type SchemaErrorItem,
} from '../merge/schemaValidation';
import JsonTreeView, { type JsonTreeHandle } from './JsonTreeView';

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
  const [validationOn, setValidationOn] = useState(true);
  const [schemaText, setSchemaText] = useState('');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  // 最近一次有效 Schema：解析/编译失败时不覆盖，校验继续使用旧 Schema
  const [activeSchema, setActiveSchema] = useState<CompiledSchema | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(true);
  const treeRef = useRef<JsonTreeHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mergedText = useMemo(() => JSON.stringify(merged, null, 2), [merged]);
  const patchText = useMemo(() => JSON.stringify(patch, null, 2), [patch]);

  // Schema 文本变化后防抖编译；空文本视为“尚未提供 Schema”，不算错误
  useEffect(() => {
    const text = schemaText.trim();
    if (!text) {
      // 明确清空：不保留任何已编译 Schema（与“新 Schema 编译失败不覆盖旧 Schema”区分）
      setSchemaError(null);
      setActiveSchema(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const outcome = compileSchema(schemaText);
      if (outcome.ok) {
        setSchemaError(null);
        setActiveSchema(outcome.compiled); // 仅成功时更新，保留旧的有效 Schema
        setSchemaOpen(false);
      } else {
        setSchemaError(outcome.error);
        setSchemaOpen(true); // 失败时展开面板，展示错误与原始文本
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [schemaText]);

  // 用当前有效 Schema 校验合并结果
  const errorGroups: SchemaErrorGroup[] = useMemo(() => {
    if (!validationOn || !activeSchema) return [];
    return validateData(activeSchema.validate, merged);
  }, [validationOn, activeSchema, merged]);

  const errorCount = countErrors(errorGroups);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const handleCopy = async (text: string, label: string) => {
    showToast((await copyText(text)) ? `${label}已复制到剪贴板` : '复制失败，请手动选择复制');
  };

  const handleSchemaFile = async (file: File | undefined) => {
    if (!file) return;
    setSchemaText(await file.text());
    setSchemaOpen(true);
  };

  const locatePointer = (pointer: string) => {
    const ok = treeRef.current?.locate(pointer);
    if (ok === false) showToast('结果中不存在该 JSON Pointer');
  };

  const schemaProvided = schemaText.trim().length > 0;

  return (
    <>
      <div className="schema-bar">
        <div className="schema-bar-head">
          <label className="schema-toggle">
            <input
              type="checkbox"
              checked={validationOn}
              onChange={(e) => setValidationOn(e.target.checked)}
            />{' '}
            JSON Schema 校验（Draft 2020-12）
          </label>
          {validationOn && schemaProvided && !schemaError && activeSchema && (
            <span className={`schema-status ${errorCount > 0 ? 'bad' : 'good'}`}>
              {errorCount > 0 ? `⚠ 发现 ${errorCount} 个校验错误` : '✓ 校验通过'}
            </span>
          )}
          {validationOn && schemaProvided && !schemaError && !activeSchema && (
            <span className="schema-status">正在编译 Schema…</span>
          )}
          {schemaError && (
            <span className="schema-status bad" title={schemaError}>
              ⚠ Schema 不可用，仍使用上一次有效 Schema
            </span>
          )}
          <button className="small" onClick={() => setSchemaOpen((o) => !o)}>
            {schemaOpen ? '收起 ▴' : '展开 ▾'}
          </button>
        </div>
        {schemaOpen && (
          <div className="schema-bar-body">
            <textarea
              className="schema-input"
              placeholder='粘贴 Draft 2020-12 JSON Schema，或点击「导入 Schema 文件」，例如 {"type":"object","required":["name"]}'
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
            />
            {schemaError && <div className="error-text schema-error">{schemaError}</div>}
            <div className="panel-actions">
              <button className="small" onClick={() => fileRef.current?.click()}>
                导入 Schema 文件
              </button>
              <button className="small" onClick={() => setSchemaText('')} disabled={!schemaText}>
                清空 Schema
              </button>
              <span className="hint-inline">支持 #/pointer 与 #anchor 形式的本地 $ref；关闭开关即不做校验</span>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  void handleSchemaFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="output-grid">
        <div className="output-panel">
          <h3>
            合并结果 JSON
            {validationOn && activeSchema && errorCount > 0 && (
              <span
                className="error-badge"
                title="合并结果未通过 Schema 校验，仍可下载"
              >
                ⚠ {errorCount} 个校验错误
              </span>
            )}
          </h3>
          <div className="json-tree-wrap">
            <JsonTreeView ref={treeRef} data={merged} />
          </div>
          <div className="panel-actions">
            <button className="small" onClick={() => void handleCopy(mergedText, '合并结果 ')}>
              复制
            </button>
            <button
              className={`small${validationOn && activeSchema && errorCount > 0 ? ' download-warn' : ''}`}
              onClick={() => download('merged.json', mergedText)}
              title={
                validationOn && activeSchema && errorCount > 0
                  ? '结果未通过 Schema 校验，仍可下载'
                  : undefined
              }
            >
              下载 merged.json
              {validationOn && activeSchema && errorCount > 0 && (
                <span className="warn-dot">{errorCount}</span>
              )}
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

      {validationOn && activeSchema && errorCount > 0 && (
        <SchemaErrors groups={errorGroups} onLocate={locatePointer} />
      )}

      <div className="output-actions">
        <button onClick={onBack}>← 返回继续调整</button>
        <button onClick={onRestart}>重新开始</button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function SchemaErrors({
  groups,
  onLocate,
}: {
  groups: SchemaErrorGroup[];
  onLocate: (pointer: string) => void;
}) {
  return (
    <div className="schema-errors">
      <h3>Schema 校验错误（按 JSON Pointer 分组，点击路径可在结果中定位）</h3>
      {groups.map((group) => (
        <div className="error-group" key={group.instancePath}>
          <button className="pointer-link" onClick={() => onLocate(group.instancePath)}>
            📍 {group.instancePath === '' ? '（根节点）' : group.instancePath}
          </button>
          <ul>
            {group.errors.map((err, i) => (
              <li key={i}>
                <span className="kw-badge">{err.keyword}</span>
                <span className="err-msg">{err.message}</span>
                <ParamsView params={err.params} />
                <span className="schema-path" title="Schema 中对应关键字的位置">
                  {err.schemaPath}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ParamsView({ params }: { params: SchemaErrorItem['params'] }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <span className="err-params">
      {entries.map(([k, v]) => (
        <code key={k}>
          {k}={formatParam(v)}
        </code>
      ))}
    </span>
  );
}

function formatParam(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
