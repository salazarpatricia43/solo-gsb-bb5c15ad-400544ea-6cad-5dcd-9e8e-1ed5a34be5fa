import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';
import { getBySegments, parsePointer } from './pointer';
import { isPlainObject, type JsonValue } from './types';

/**
 * Draft 2020-12 JSON Schema 校验。
 * 使用 Ajv（默认即 Draft 2020-12）对合并结果做校验，
 * 并在编译前预先扫描无法解析的本地 $ref，给出明确错误。
 */

export interface CompiledSchema {
  /** 编译成功时对应的 Schema 文本 */
  text: string;
  validate: ValidateFunction;
}

export type CompileOutcome =
  | { ok: true; compiled: CompiledSchema }
  | { ok: false; error: string };

/** 单条校验错误（Ajv error 的精简视图） */
export interface SchemaErrorItem {
  keyword: string;
  /** 出错值的 JSON Pointer（根为 ''） */
  instancePath: string;
  /** 命中的 Schema 子节点路径（JSON Pointer 片段） */
  schemaPath: string;
  message: string;
  /** 关键字参数，如 { missingProperty: "name" } */
  params: Record<string, unknown>;
}

/** 按 instancePath 分组后的错误 */
export interface SchemaErrorGroup {
  instancePath: string;
  errors: SchemaErrorItem[];
}

/** 值为单个子 Schema 的关键字 */
const SUBSCHEMA_KEYS = [
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'additionalProperties',
  'additionalItems',
  'contentSchema',
  'items',
];

/** 值为子 Schema 数组的关键字 */
const SUBSCHEMA_ARRAY_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

/** 值为「键 → 子 Schema」映射的关键字 */
const SUBSCHEMA_MAP_KEYS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];

interface RefOccurrence {
  ref: string;
  /** $ref 在 Schema 文档中的位置（JSON Pointer） */
  location: string;
  scope: SchemaScope;
}

interface SchemaScope {
  /** 当前 Schema 资源的根节点（最近一个 $id 所在节点，顶层为整份文档） */
  rootNode: unknown;
  /** 当前资源内声明的 $anchor 名称集合 */
  anchors: Set<string>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 扫描 Schema 中所有无法解析的本地 $ref。
 * 本地引用指仅含片段标识符的 $ref："#"、"#/a/b"（JSON Pointer）或 "#anchor"（$anchor）。
 */
export function findUnresolvableLocalRefs(schema: unknown): { ref: string; location: string }[] {
  const refs: RefOccurrence[] = [];
  const rootScope: SchemaScope = { rootNode: schema, anchors: new Set() };

  const walk = (node: unknown, location: string, scope: SchemaScope) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${location}/${i}`, scope));
      return;
    }
    if (!isPlainObject(node)) return;

    // $id（相对或绝对 URI，但不含纯片段）开启新的 Schema 资源
    let current = scope;
    if (typeof node.$id === 'string' && node.$id !== '' && !node.$id.startsWith('#')) {
      current = { rootNode: node, anchors: new Set() };
    }
    if (typeof node.$anchor === 'string') {
      current.anchors.add(node.$anchor);
    }

    if (typeof node.$ref === 'string') {
      refs.push({ ref: node.$ref, location, scope: current });
      // $ref 的同级关键字会被忽略，无需继续向下扫描
      return;
    }

    for (const key of SUBSCHEMA_KEYS) {
      if (key in node) walk(node[key], `${location}/${key}`, current);
    }
    for (const key of SUBSCHEMA_ARRAY_KEYS) {
      if (key in node) walk(node[key], `${location}/${key}`, current);
    }
    for (const key of SUBSCHEMA_MAP_KEYS) {
      if (key in node && isPlainObject(node[key])) {
        for (const subKey of Object.keys(node[key] as Record<string, unknown>)) {
          walk(
            (node[key] as Record<string, unknown>)[subKey],
            `${location}/${key}/${subKey}`,
            current,
          );
        }
      }
    }
    // dependencies（Draft 7）的值可能是子 Schema 或字符串数组，字符串会被 walk 忽略
    if ('dependencies' in node && isPlainObject(node.dependencies)) {
      for (const depKey of Object.keys(node.dependencies as Record<string, unknown>)) {
        walk(
          (node.dependencies as Record<string, unknown>)[depKey],
          `${location}/dependencies/${depKey}`,
          current,
        );
      }
    }
    // 其余未知关键字按注解处理，不深入扫描（避免误判 enum/default/examples 等实例数据）
  };

  walk(schema, '', rootScope);

  const bad: { ref: string; location: string }[] = [];
  for (const { ref, location, scope } of refs) {
    if (!ref.startsWith('#')) continue; // 外部引用交给 Ajv 编译期处理
    const fragment = ref.slice(1);
    if (fragment === '') continue; // "#" 指向资源根，必然存在

    let found: boolean;
    if (fragment.startsWith('/')) {
      // JSON Pointer 片段：相对当前 Schema 资源根解析（嵌套 $id 资源不能回退到文档根）
      const segments = parsePointer(fragment);
      found = getBySegments(scope.rootNode as JsonValue, segments) !== undefined;
    } else {
      // 纯名称片段：解析为当前资源内的 $anchor
      found = scope.anchors.has(fragment);
    }
    if (!found) bad.push({ ref, location: location || '（根）' });
  }
  return bad;
}

/**
 * 解析并编译一份 Schema 文本。
 * 失败时返回明确的中文错误信息（JSON 解析失败 / Schema 不合法 / 本地 $ref 无法解析 / 编译失败）。
 */
export function compileSchema(rawText: string): CompileOutcome {
  let schema: unknown;
  try {
    schema = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, error: `Schema JSON 解析失败：${errorMessage(err)}` };
  }

  const badRefs = findUnresolvableLocalRefs(schema);
  if (badRefs.length > 0) {
    const detail = badRefs.map((r) => `${r.ref}（位于 ${r.location}）`).join('；');
    return { ok: false, error: `Schema 包含无法解析的本地 $ref：${detail}` };
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const anySchema = schema as AnySchema;
  if (!ajv.validateSchema(anySchema)) {
    const details = (ajv.errors ?? [])
      .map((e) => `${e.instancePath || '（根）'} ${e.message ?? '不是合法的 Schema'}`)
      .join('；');
    return { ok: false, error: `不是合法的 Draft 2020-12 JSON Schema：${details || '结构有误'}` };
  }

  try {
    const validate = ajv.compile(anySchema);
    return { ok: true, compiled: { text: rawText, validate } };
  } catch (err) {
    return { ok: false, error: `Schema 编译失败：${errorMessage(err)}` };
  }
}

/** 用已编译的 Schema 校验数据，错误按 instancePath 分组（保持首次出现顺序） */
export function validateData(validate: ValidateFunction, data: JsonValue): SchemaErrorGroup[] {
  const valid = validate(data);
  if (valid || !validate.errors) return [];

  const groups = new Map<string, SchemaErrorGroup>();
  for (const err of validate.errors as ErrorObject<string, Record<string, unknown>>[]) {
    const item: SchemaErrorItem = {
      keyword: err.keyword,
      instancePath: err.instancePath ?? '',
      schemaPath: err.schemaPath,
      message: err.message ?? '校验未通过',
      params: err.params ?? {},
    };
    const group = groups.get(item.instancePath);
    if (group) {
      group.errors.push(item);
    } else {
      groups.set(item.instancePath, { instancePath: item.instancePath, errors: [item] });
    }
  }
  return [...groups.values()];
}

/** 统计分组中的错误总条数 */
export function countErrors(groups: SchemaErrorGroup[]): number {
  return groups.reduce((n, g) => n + g.errors.length, 0);
}
