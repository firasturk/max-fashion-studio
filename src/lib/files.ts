import { collapseContainer } from "@shared/paths";

/** Collects image files from a drop event, walking dropped folders recursively. Returns files with relative paths. */
export interface PickedFile {
  file: File;
  path: string;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err?: (e: unknown) => void) => void;
  };
}

function readAll(
  reader: ReturnType<NonNullable<FileSystemEntryLike["createReader"]>>,
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntryLike[] = [];
    const step = () =>
      reader.readEntries((entries) => {
        if (!entries.length) return resolve(out);
        out.push(...entries);
        step();
      }, reject);
    step();
  });
}

async function walk(entry: FileSystemEntryLike, out: PickedFile[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\//, "") });
  } else if (entry.isDirectory && entry.createReader) {
    for (const child of await readAll(entry.createReader())) await walk(child, out);
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items.map(
    (i) =>
      (
        i as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null }
      ).webkitGetAsEntry?.() ?? null,
  );
  if (entries.some(Boolean)) {
    for (const e of entries) if (e) await walk(e, out);
    return out;
  }
  return Array.from(dt.files).map((file) => ({ file, path: file.name }));
}

/** Files from an <input type=file>, keeping folder paths when the input had webkitdirectory. */
export function filesFromInput(list: FileList | null): {
  files: PickedFile[];
  root: string | null;
} {
  if (!list) return { files: [], root: null };
  const files = Array.from(list);
  const raw = files.map(
    (file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  );
  const { paths, root } = collapseContainer(raw);
  return { files: files.map((file, i) => ({ file, path: paths[i] })), root };
}
