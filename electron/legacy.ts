import {
  basename,
  dirname,
  extname,
  isAbsolute,
  resolve,
  win32,
} from "node:path";
import { randomUUID } from "node:crypto";
import { analysisSchema, normalizeName, type Analysis } from "../src/domain";

// This is a data parser, not an unpickler. Globals are never imported, and
// constructors, reducers, persistent references and extension opcodes never run.
// Only the inert historical treewidget_item.ClipItem shape is recognized.
const MARK = Symbol("mark");
const CLIP_CLASS = Symbol("historical ClipItem");
class Tuple {
  constructor(readonly values: unknown[]) {}
}
class LegacyClip {
  state: Map<string, unknown> | null = null;
}
export function importLegacy(data: Buffer, sourcePath: string): Analysis {
  if (data.length > 32 * 1024 * 1024)
    throw new Error("Legacy Analysis exceeds the 32 MiB import limit");
  let pos = 0,
    operations = 0;
  const stack: unknown[] = [],
    memo = new Map<number, unknown>();
  const malformed = (): never => {
    throw new Error(
      "Malformed or unsupported legacy Analysis. Open it in the Python app and Save As to convert it to JSON.",
    );
  };
  const take = (count: number): Buffer => {
    if (!Number.isSafeInteger(count) || count < 0 || pos + count > data.length)
      return malformed();
    const result = data.subarray(pos, pos + count);
    pos += count;
    return result;
  };
  const pop = (): unknown => {
    if (!stack.length) return malformed();
    return stack.pop();
  };
  const top = (): unknown => {
    if (!stack.length) return malformed();
    return stack[stack.length - 1];
  };
  const marked = (): unknown[] => {
    const i = stack.lastIndexOf(MARK);
    if (i < 0) return malformed();
    const values = stack.splice(i);
    return values.slice(1);
  };
  const line = () => {
    const end = data.indexOf(10, pos);
    if (end < 0) return malformed();
    return take(end - pos + 1)
      .subarray(0, -1)
      .toString("utf8");
  };
  const global = (module: unknown, name: unknown) => {
    if (module !== "treewidget_item" || name !== "ClipItem")
      throw new Error(
        `Unsupported legacy global ${String(module)}.${String(name)}`,
      );
    return CLIP_CLASS;
  };
  const put = (index: number) => {
    if (index > 1_000_000 || index < 0) malformed();
    memo.set(index, top());
  };
  const get = (index: number) => {
    if (!memo.has(index)) malformed();
    stack.push(memo.get(index));
  };
  const dictItems = (dict: unknown, values: unknown[]) => {
    if (!(dict instanceof Map) || values.length % 2) return malformed();
    for (let i = 0; i < values.length; i += 2) {
      if (typeof values[i] !== "string" || dict.has(values[i])) malformed();
      dict.set(values[i], values[i + 1]);
    }
  };
  let root: unknown;
  let stopped = false;
  while (pos < data.length && !stopped) {
    if (++operations > 2_000_000 || stack.length > 100_000) malformed();
    const opcode = take(1)[0];
    switch (opcode) {
      case 0x80: {
        const protocol = take(1)[0];
        if (protocol < 2 || protocol > 5) malformed();
        break;
      }
      case 0x95: {
        const size = take(8).readBigUInt64LE();
        if (size > BigInt(data.length - pos)) malformed();
        break;
      }
      case 0x28:
        stack.push(MARK);
        break;
      case 0x29:
        stack.push(new Tuple([]));
        break;
      case 0x5d:
        stack.push([]);
        break;
      case 0x7d:
        stack.push(new Map());
        break;
      case 0x4e:
        stack.push(null);
        break;
      case 0x88:
        stack.push(true);
        break;
      case 0x89:
        stack.push(false);
        break;
      case 0x4b:
        stack.push(take(1)[0]);
        break;
      case 0x4d:
        stack.push(take(2).readUInt16LE());
        break;
      case 0x4a:
        stack.push(take(4).readInt32LE());
        break;
      case 0x8a: {
        const bytes = take(take(1)[0]);
        if (bytes.length > 7) malformed();
        let value = 0n;
        for (let i = bytes.length - 1; i >= 0; i--)
          value = value * 256n + BigInt(bytes[i]);
        if (bytes.length && bytes[bytes.length - 1] & 128)
          value -= 1n << BigInt(bytes.length * 8);
        if (!Number.isSafeInteger(Number(value))) malformed();
        stack.push(Number(value));
        break;
      }
      case 0x58:
        stack.push(
          new TextDecoder("utf-8", { fatal: true }).decode(
            take(take(4).readUInt32LE()),
          ),
        );
        break;
      case 0x8c:
        stack.push(
          new TextDecoder("utf-8", { fatal: true }).decode(take(take(1)[0])),
        );
        break;
      case 0x94:
        put(memo.size);
        break;
      case 0x71:
        put(take(1)[0]);
        break;
      case 0x72:
        put(take(4).readUInt32LE());
        break;
      case 0x68:
        get(take(1)[0]);
        break;
      case 0x6a:
        get(take(4).readUInt32LE());
        break;
      case 0x63:
        stack.push(global(line(), line()));
        break;
      case 0x93: {
        const name = pop(),
          module = pop();
        stack.push(global(module, name));
        break;
      }
      case 0x81: {
        const args = pop(),
          cls = pop();
        if (
          cls !== CLIP_CLASS ||
          !(args instanceof Tuple) ||
          args.values.length
        )
          malformed();
        stack.push(new LegacyClip());
        break;
      }
      case 0x62: {
        const state = pop(),
          instance = top();
        if (
          !(state instanceof Map) ||
          !(instance instanceof LegacyClip) ||
          instance.state
        )
          malformed();
        (instance as LegacyClip).state = state as Map<string, unknown>;
        break;
      }
      case 0x75: {
        const values = marked();
        dictItems(top(), values);
        break;
      }
      case 0x73: {
        const value = pop(),
          key = pop();
        dictItems(top(), [key, value]);
        break;
      }
      case 0x65: {
        const values = marked(),
          list = top();
        if (!Array.isArray(list)) malformed();
        (list as unknown[]).push(...values);
        break;
      }
      case 0x61: {
        const value = pop(),
          list = top();
        if (!Array.isArray(list)) malformed();
        (list as unknown[]).push(value);
        break;
      }
      case 0x74:
        stack.push(new Tuple(marked()));
        break;
      case 0x85:
        stack.push(new Tuple([pop()]));
        break;
      case 0x86: {
        const second = pop(),
          first = pop();
        stack.push(new Tuple([first, second]));
        break;
      }
      case 0x87: {
        const third = pop(),
          second = pop(),
          first = pop();
        stack.push(new Tuple([first, second, third]));
        break;
      }
      case 0x2e: {
        root = pop();
        if (stack.length || pos !== data.length) malformed();
        stopped = true;
        break;
      }
      default:
        throw new Error(
          `Unsupported legacy pickle opcode 0x${opcode.toString(16)}. No pickle code was executed.`,
        );
    }
  }
  if (
    !stopped ||
    !(root instanceof Tuple) ||
    root.values.length !== 2 ||
    typeof root.values[0] !== "string" ||
    !Array.isArray(root.values[1])
  )
    return malformed();
  const [location, clips] = root.values as [string, unknown[]];
  if (!location) return malformed();
  const sourceId = randomUUID();
  const a: Analysis = {
    id: randomUUID(),
    title: basename(sourcePath, extname(sourcePath)),
    source_videos: [
      {
        id: sourceId,
        display_name: win32.basename(location),
        location:
          isAbsolute(location) || win32.isAbsolute(location)
            ? location
            : resolve(dirname(sourcePath), location),
        relative_path:
          !isAbsolute(location) && !win32.isAbsolute(location)
            ? location.replaceAll("\\", "/")
            : null,
        duration_ms: null,
        byte_size: null,
        fingerprint: null,
      },
    ],
    categories: [],
    clips: [],
    playlists: [],
  };
  for (const value of clips) {
    if (!(value instanceof LegacyClip) || !value.state) return malformed();
    const state = value.state;
    const fields = [
      "name",
      "start_position",
      "end_position",
      "notes",
      "category",
    ];
    if (state.size !== fields.length || fields.some((f) => !state.has(f)))
      return malformed();
    const name = state.get("category");
    let categoryId: string | null = null;
    if (name !== null) {
      if (typeof name !== "string" || !name.trim()) return malformed();
      let category = a.categories.find(
        (c) => normalizeName(c.name) === normalizeName(name),
      );
      if (!category) {
        category = { id: randomUUID(), name: name.trim(), color: "#808080" };
        a.categories.push(category);
      }
      categoryId = category.id;
    }
    // Full domain validation below rejects incorrect value types and boundaries.
    a.clips.push({
      id: randomUUID(),
      source_video_id: sourceId,
      name: state.get("name") as string,
      start_ms: state.get("start_position") as number,
      end_ms: state.get("end_position") as number,
      notes: state.get("notes") as string,
      category_id: categoryId,
      creation_order: a.clips.length,
    });
  }
  return analysisSchema.parse(a);
}
