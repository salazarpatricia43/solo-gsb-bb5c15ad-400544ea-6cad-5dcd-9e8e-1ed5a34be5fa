import { describe, expect, it } from 'vitest';
import type { JsonValue } from './types';
import {
  compileSchema,
  countErrors,
  findUnresolvableLocalRefs,
  validateData,
} from './schemaValidation';

describe('compileSchema', () => {
  it('编译合法的 Draft 2020-12 Schema', () => {
    const out = compileSchema(JSON.stringify({ type: 'object', required: ['name'] }));
    expect(out.ok).toBe(true);
  });

  it('支持布尔 Schema（true/false）', () => {
    expect(compileSchema('true').ok).toBe(true);
    expect(compileSchema('false').ok).toBe(true);
  });

  it('JSON 解析失败时给出明确错误', () => {
    const out = compileSchema('{ not json');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('Schema JSON 解析失败');
  });

  it('Schema 结构不合法（type 取值非法）时给出明确错误', () => {
    const out = compileSchema(JSON.stringify({ type: 'not-a-type' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('不是合法的 Draft 2020-12 JSON Schema');
  });

  it('无法解析的本地 pointer $ref 给出位置信息', () => {
    const out = compileSchema(
      JSON.stringify({ $ref: '#/$defs/missing' }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain('无法解析的本地 $ref');
      expect(out.error).toContain('#/$defs/missing');
      expect(out.error).toContain('（根）');
    }
  });

  it('嵌套位置无法解析的 $ref 报告其 JSON Pointer 位置', () => {
    const out = compileSchema(
      JSON.stringify({ properties: { a: { $ref: '#/nope' } } }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('/properties/a');
  });

  it('正确解析 #/ 路径形式的本地 $ref', () => {
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/name' } },
      $defs: { name: { type: 'string' } },
    };
    expect(compileSchema(JSON.stringify(schema)).ok).toBe(true);
  });

  it('正确解析 #anchor 形式的本地 $ref', () => {
    const schema = {
      type: 'object',
      properties: { a: { $ref: '#name' } },
      $defs: { name: { $anchor: 'name', type: 'string' } },
    };
    expect(compileSchema(JSON.stringify(schema)).ok).toBe(true);
  });

  it('未声明的纯名称 anchor 视为无法解析', () => {
    const out = compileSchema(JSON.stringify({ $ref: '#name' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('#name');
  });

  it('引用当前资源内未声明的 anchor 视为无法解析', () => {
    const out = compileSchema(
      JSON.stringify({
        $defs: { a: { $anchor: 'a' } },
        properties: { x: { $ref: '#b' } },
      }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('#b');
  });

  it('嵌套 $id 资源内的相对 pointer 在资源根内解析', () => {
    const schema = {
      $id: 'https://example.com/root',
      $defs: {
        sub: {
          $id: 'sub',
          type: 'object',
          def: { type: 'number' },
          properties: { x: { $ref: '#/def' } },
        },
      },
    };
    expect(compileSchema(JSON.stringify(schema)).ok).toBe(true);
  });

  it('嵌套 $id 资源内引用文档根中不存在于资源内的路径时失败', () => {
    const schema = {
      $id: 'https://example.com/root',
      def: { type: 'number' },
      $defs: {
        sub: {
          $id: 'sub',
          properties: { x: { $ref: '#/def' } },
        },
      },
    };
    const out = compileSchema(JSON.stringify(schema));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('无法解析的本地 $ref');
  });

  it('enum/default 等实例数据中的 $ref 形态字符串不被误判', () => {
    const bad = findUnresolvableLocalRefs({
      enum: [{ $ref: '#/nope' }],
      default: { $ref: '#/nope' },
    });
    expect(bad).toEqual([]);
  });

  it('外部引用缺失时报编译失败（本地预检不拦截非 # 引用）', () => {
    const out = compileSchema(JSON.stringify({ $ref: 'https://example.com/missing.json#' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('Schema 编译失败');
  });
});

describe('validateData', () => {
  function groupsOf(schema: JsonValue, data: JsonValue) {
    const out = compileSchema(JSON.stringify(schema));
    if (!out.ok) throw new Error(out.error);
    return validateData(out.compiled.validate, data);
  }

  it('通过校验时返回空数组', () => {
    expect(groupsOf({ type: 'object' }, { a: 1 })).toEqual([]);
  });

  it('errors 按 instancePath 分组并保留关键字、消息、参数', () => {
    const groups = groupsOf(
      {
        type: 'object',
        required: ['name', 'age'],
        properties: { age: { type: 'number', minimum: 0 } },
      },
      { age: -1 },
    );
    // 根：缺 name（required）；/age：最小值（minimum），各成一组
    const rootGroup = groups.find((g) => g.instancePath === '');
    expect(rootGroup).toBeDefined();
    const requiredErr = rootGroup!.errors.find((e) => e.keyword === 'required')!;
    expect(requiredErr).toBeDefined();
    expect(requiredErr.params).toHaveProperty('missingProperty', 'name');
    expect(typeof requiredErr.message).toBe('string');

    const ageGroup = groups.find((g) => g.instancePath === '/age');
    expect(ageGroup).toBeDefined();
    const minimumErr = ageGroup!.errors.find((e) => e.keyword === 'minimum')!;
    expect(minimumErr).toBeDefined();
    expect(minimumErr.params).toMatchObject({ limit: 0, comparison: '>=' });
  });

  it('同一路径缺多个必填属性时归入同一组', () => {
    const groups = groupsOf({ type: 'object', required: ['a', 'b', 'c'] }, {});
    const rootGroup = groups.find((g) => g.instancePath === '')!;
    expect(rootGroup.errors).toHaveLength(3);
    expect(rootGroup.errors.map((e) => e.params.missingProperty)).toEqual(['a', 'b', 'c']);
  });

  it('同一 instancePath 上的多个关键字错误归入同一组', () => {
    // 字符串同时触发 maxLength 与 pattern（二者都会对字符串求值）
    const groups = groupsOf(
      { properties: { name: { type: 'string', maxLength: 3, pattern: '^[0-9]+$' } } },
      { name: 'abcdef' },
    );
    const nameGroup = groups.find((g) => g.instancePath === '/name')!;
    expect(nameGroup.errors.map((e) => e.keyword)).toEqual(
      expect.arrayContaining(['maxLength', 'pattern']),
    );
  });

  it('嵌套路径错误使用转义后的 JSON Pointer', () => {
    const groups = groupsOf(
      { type: 'object', properties: { child: { type: 'object', required: ['x'] } } },
      { child: {} },
    );
    expect(groups.map((g) => g.instancePath)).toContain('/child');
  });

  it('countErrors 统计所有分组的错误总数', () => {
    const groups = groupsOf({ type: 'object', required: ['a', 'b', 'c'] }, {});
    expect(countErrors(groups)).toBe(3);
  });
});
