import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { escapeSegment, getBySegments, parsePointer } from '../merge/pointer';
import type { JsonValue } from '../merge/types';

export interface JsonTreeHandle {
  /** 按 JSON Pointer 定位并高亮对应值；路径不存在时返回 false */
  locate: (pointer: string) => boolean;
}

interface Props {
  data: JsonValue;
}

/**
 * 以可折叠树渲染 JSON，每个节点按其 JSON Pointer 注册 DOM 行，
 * 供 Schema 校验错误点击后展开祖先、滚动并高亮对应值。
 */
const JsonTreeView = forwardRef<JsonTreeHandle, Props>(function JsonTreeView({ data }, ref) {
  // data 变化时重建注册表；节点卸载时会以 null 回填
  const registry = useMemo(() => new Map<string, HTMLDivElement | null>(), [data]);
  const openSet = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  const register = (pointer: string) => (el: HTMLDivElement | null) => {
    registry.set(pointer, el);
  };

  useImperativeHandle(ref, () => ({
    locate(pointer: string) {
      // 先按数据本身判断路径是否存在（折叠时子孙行尚未挂载）
      let segments: string[];
      try {
        segments = parsePointer(pointer);
      } catch {
        return false;
      }
      if (getBySegments(data, segments) === undefined) {
        // 合法但值为 undefined 不可能出现在 JSON 中；根标量等正常值不会被误判
        return false;
      }

      // 展开祖先链上所有折叠的容器（pointer 切片本身即转义段，无需反转义）
      const escSegments = pointer === '' ? [] : pointer.slice(1).split('/');
      let changed = false;
      for (let i = 0; i < escSegments.length; i++) {
        const ancestor = '/' + escSegments.slice(0, i + 1).join('/');
        const el = registry.get(ancestor);
        if (el && el.dataset.open === 'false') {
          openSet.current.delete(ancestor);
          changed = true;
        }
      }

      const scrollToTarget = () => {
        const row = registry.get(pointer);
        if (!row) return false;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlight(pointer);
        window.clearTimeout(highlightTimer.current);
        highlightTimer.current = window.setTimeout(() => setHighlight(null), 2400);
        return true;
      };

      if (changed) {
        setTick((n) => n + 1);
        // 等待 React 提交、子孙节点挂载后再滚动
        requestAnimationFrame(() => {
          if (!scrollToTarget()) requestAnimationFrame(() => scrollToTarget());
        });
      } else {
        scrollToTarget();
      }
      return true;
    },
  }));

  return (
    <div className="json-tree">
      <NodeView
        node={data}
        keyName={null}
        segments={[]}
        depth={0}
        registry={registry}
        register={register}
        openSet={openSet.current}
        onToggle={() => setTick((n) => n + 1)}
        highlight={highlight}
        isLast
      />
    </div>
  );
});

interface NodeProps {
  node: JsonValue;
  keyName: string | null;
  segments: string[];
  depth: number;
  registry: Map<string, HTMLDivElement | null>;
  register: (pointer: string) => (el: HTMLDivElement | null) => void;
  openSet: Set<string>;
  onToggle: () => void;
  highlight: string | null;
  isLast: boolean;
}

function pointerOf(segments: string[]): string {
  return segments.length === 0 ? '' : '/' + segments.map(escapeSegment).join('/');
}

function NodeView(props: NodeProps) {
  const { node, keyName, segments, depth, registry, register, openSet, onToggle, highlight, isLast } = props;
  const pointer = pointerOf(segments);
  const isObj = typeof node === 'object' && node !== null && !Array.isArray(node);
  const isArr = Array.isArray(node);

  if (isObj) {
    const keys = Object.keys(node as Record<string, JsonValue>);
    return (
      <ContainerView
        {...props}
        pointer={pointer}
        open={!openSet.has(pointer)}
        empty={keys.length === 0}
        openBracket="{"
        closeBracket="}"
      >
        {(open) =>
          open &&
          keys.map((k, i) => (
            <NodeView
              key={k}
              node={(node as Record<string, JsonValue>)[k]}
              keyName={k}
              segments={[...segments, k]}
              depth={depth + 1}
              registry={registry}
              register={register}
              openSet={openSet}
              onToggle={onToggle}
              highlight={highlight}
              isLast={i === keys.length - 1}
            />
          ))
        }
      </ContainerView>
    );
  }

  if (isArr) {
    const arr = node as JsonValue[];
    return (
      <ContainerView
        {...props}
        pointer={pointer}
        open={!openSet.has(pointer)}
        empty={arr.length === 0}
        openBracket="["
        closeBracket="]"
      >
        {(open) =>
          open &&
          arr.map((item, i) => (
            <NodeView
              key={i}
              node={item}
              keyName={String(i)}
              segments={[...segments, String(i)]}
              depth={depth + 1}
              registry={registry}
              register={register}
              openSet={openSet}
              onToggle={onToggle}
              highlight={highlight}
              isLast={i === arr.length - 1}
            />
          ))
        }
      </ContainerView>
    );
  }

  return (
    <div
      ref={register(pointer)}
      data-pointer={pointer}
      className={`jt-row jt-leaf${highlight === pointer ? ' jt-hit' : ''}`}
      style={{ paddingLeft: depth * 18 + 8 }}
    >
      <span className="jt-toggle"> </span>
      {keyName !== null && <span className="jt-key">"{keyName}": </span>}
      {renderPrimitive(node)}
      {!isLast && <span className="jt-comma">,</span>}
    </div>
  );
}

interface ContainerViewProps extends NodeProps {
  pointer: string;
  open: boolean;
  empty: boolean;
  openBracket: string;
  closeBracket: string;
  children: (open: boolean) => ReactNode;
}

function ContainerView({
  pointer,
  keyName,
  depth,
  register,
  openSet,
  onToggle,
  highlight,
  isLast,
  open,
  empty,
  openBracket,
  closeBracket,
  children,
}: ContainerViewProps) {
  const toggle = () => {
    if (openSet.has(pointer)) openSet.delete(pointer);
    else openSet.add(pointer);
    onToggle();
  };
  const shown = empty || open;

  return (
    <>
      <div
        ref={register(pointer)}
        data-pointer={pointer}
        data-open={shown ? 'true' : 'false'}
        className={`jt-row jt-container${highlight === pointer ? ' jt-hit' : ''}`}
        style={{ paddingLeft: depth * 18 + 8 }}
      >
        <span className="jt-toggle" onClick={toggle}>
          {empty ? ' ' : open ? '▾' : '▸'}
        </span>
        {keyName !== null && <span className="jt-key">"{keyName}": </span>}
        <span className="jt-bracket">{openBracket}</span>
        {!shown && (
          <>
            <span className="jt-collapsed"> … </span>
            <span className="jt-bracket">
              {closeBracket}
              {!isLast && ','}
            </span>
          </>
        )}
      </div>
      {!empty && shown && children(true)}
      {!empty && shown && (
        <div className="jt-row jt-closing" style={{ paddingLeft: depth * 18 + 8 }}>
          <span className="jt-toggle"> </span>
          <span className="jt-bracket">
            {closeBracket}
            {!isLast && ','}
          </span>
        </div>
      )}
    </>
  );
}

function renderPrimitive(v: JsonValue): ReactNode {
  if (typeof v === 'string') return <span className="jt-string">"{v}"</span>;
  if (typeof v === 'number') return <span className="jt-number">{String(v)}</span>;
  if (typeof v === 'boolean') return <span className="jt-boolean">{String(v)}</span>;
  if (v === null) return <span className="jt-null">null</span>;
  return null;
}

export default JsonTreeView;
