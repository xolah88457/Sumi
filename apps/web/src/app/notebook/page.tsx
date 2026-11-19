"use client";
import { OptionSelect } from "@/components/ui/option-select";

import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderPlus, Plus, Search, Trash2 } from "lucide-react";
import { FolderList, applyFolderOrder } from "./folder-list";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

interface NoteRow {
  id: string;
  folderId: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  name: string;
  kind: string;
}

export default function NotebookPage() {
  return (
    <Suspense>
      <Notebook />
    </Suspense>
  );
}

function Notebook() {
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<FolderRow | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const { data, refresh } = useApi<{ notes: NoteRow[]; folders: FolderRow[] }>(
    `/api/notes?folder=${folder}&q=${encodeURIComponent(search)}`,
  );
  const selected = data?.notes.find((note) => note.id === selectedId) ?? null;
  const currentFolder = data?.folders.find((item) => item.id === folder);
  // A dragged order shows at once and stays until a load after the save confirms it.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [orderError, setOrderError] = useState("");
  const savingOrder = useRef(0);
  useEffect(() => {
    if (savingOrder.current === 0) setPendingOrder(null);
  }, [data]);
  const sidebarFolders = applyFolderOrder(
    data?.folders.filter((item) => item.id !== "all") ?? [],
    pendingOrder,
  );

  const reorderFolders = async (order: string[]) => {
    setPendingOrder(order);
    setOrderError("");
    savingOrder.current += 1;
    try {
      await postJson("/api/folders", { order }, "PUT");
    } catch (error) {
      setPendingOrder(null);
      setOrderError(
        error instanceof Error ? error.message : "Could not save the folder order. Try again.",
      );
    } finally {
      savingOrder.current -= 1;
      refresh();
    }
  };

  const requestFolderDelete = (item: FolderRow) => {
    setDeleteError("");
    setFolderToDelete(item);
  };

  const deleteFolder = async () => {
    if (!folderToDelete || deletingFolder) return;
    setDeletingFolder(true);
    setDeleteError("");
    try {
      await postJson(`/api/folders/${folderToDelete.id}`, undefined, "DELETE");
      setFolder((current) => (current === folderToDelete.id ? "my-notes" : current));
      refresh();
      setFolderToDelete(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete the folder. Try again.",
      );
    } finally {
      setDeletingFolder(false);
    }
  };

  const createNote = async () => {
    const result = await postJson<{ id: string }>("/api/notes", {
      folderId: folder === "all" ? "my-notes" : folder,
      title: "Untitled",
    });
    refresh();
    setSelectedId(result.id);
  };

  const createFolder = async () => {
    if (creatingFolder || !folderName.trim()) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const result = await postJson<{ id: string }>("/api/folders", { name: folderName });
      setFolder(result.id);
      setSelectedId(null);
      setSearch("");
      refresh();
      setFolderOpen(false);
      setFolderName("");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Could not create the folder. Try again.",
      );
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div>
      <Dialog
        open={Boolean(folderToDelete)}
        onOpenChange={(open) => !open && !deletingFolder && setFolderToDelete(null)}
      >
        <DialogContent>
          <DialogTitle>Delete “{folderToDelete?.name}”?</DialogTitle>
          <DialogDescription>
            The folder will be removed. Its notes will be kept in My notes.
          </DialogDescription>
          {deleteError && (
            <p role="alert" className="text-[15px] text-destructive">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deletingFolder}
              onClick={() => setFolderToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingFolder}
              onClick={() => void deleteFolder()}
            >
              {deletingFolder ? "Deleting…" : "Delete folder"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={folderOpen} onOpenChange={(open) => !creatingFolder && setFolderOpen(open)}>
        <DialogContent>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Organize your notes in a named folder.</DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <label className="block space-y-2 text-[15px]">
              <span>Folder name</span>
              <Input
                autoFocus
                value={folderName}
                maxLength={100}
                required
                disabled={creatingFolder}
                onChange={(event) => {
                  setFolderName(event.target.value);
                  setFolderError("");
                }}
              />
            </label>
            {folderError && (
              <p role="alert" className="text-[15px] text-destructive">
                {folderError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creatingFolder}
                onClick={() => setFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFolder || !folderName.trim()}>
                {creatingFolder ? "Creating…" : "Create folder"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <FilterBar
        title="Notebook"
        lede="Notes, reviews and ideas, kept in folders."
        compact
        actions={
          <Button size="sm" onClick={createNote}>
            <Plus />
            New note
          </Button>
        }
      />
      <div className="notebook-workspace" data-note-open={Boolean(selected)}>
        <div className="notebook-folders min-w-0 space-y-0.5 overflow-y-auto border-r p-3">
          <button
            className={cn(
              "w-full rounded-full py-2 pl-4 pr-3 text-left text-[15px]",
              folder === "all"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setFolder("all")}
          >
            All notes
          </button>
          <FolderList
            folders={sidebarFolders}
            selected={folder}
            onSelect={setFolder}
            onDelete={requestFolderDelete}
            onReorder={(order) => void reorderFolders(order)}
          />
          {orderError && (
            <p role="alert" className="px-2.5 py-1 text-[13px] text-destructive">
              {orderError}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              setFolderError("");
              setFolderOpen(true);
            }}
          >
            <FolderPlus />
            New folder
          </Button>
        </div>

        <div className="notebook-list min-w-0 overflow-y-auto border-r">
          <div className="sticky top-0 z-[1] space-y-2 border-b bg-background p-3">
            <div className="flex min-w-0 items-center gap-2 xl:hidden">
              <OptionSelect
                aria-label="Note folder"
                value={folder}
                onValueChange={(next) => setFolder(next)}
                className="min-w-0 flex-1"
              >
                <option value="all">All notes</option>
                {sidebarFolders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </OptionSelect>
              {currentFolder && currentFolder.id !== "all" && currentFolder.id !== "my-notes" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete folder: ${currentFolder.name}`}
                  onClick={() => requestFolderDelete(currentFolder)}
                >
                  <Trash2 />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="New folder"
                onClick={() => {
                  setFolderError("");
                  setFolderOpen(true);
                }}
              >
                <FolderPlus />
              </Button>
            </div>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notes"
                className="pl-9"
              />
            </div>
          </div>
          {data?.notes.length === 0 && (
            <EmptyState
              className="m-3 px-4 py-6"
              title={search ? "No matching notes" : "No notes here yet"}
            >
              {search ? "Try a different search." : "Add a note to start this folder."}
            </EmptyState>
          )}
          {data?.notes.map((note) => (
            <button
              key={note.id}
              className={cn(
                "block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted",
                selectedId === note.id && "bg-accent hover:bg-accent",
              )}
              onClick={() => setSelectedId(note.id)}
            >
              <div className="truncate text-[15px]">{note.title || "Untitled"}</div>
              <div className="truncate text-[13px] text-muted-foreground">
                {note.updatedAt.slice(0, 10)} · {note.content.slice(0, 60) || "empty"}
              </div>
            </button>
          ))}
        </div>

        <div className="notebook-editor min-w-0 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
          {selected && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-3 md:hidden"
              onClick={() => setSelectedId(null)}
            >
              <ArrowLeft />
              Back to notes
            </Button>
          )}
          {selected ? (
            <NoteEditor key={selected.id} note={selected} onChanged={refresh} />
          ) : (
            <EmptyState
              className="mx-auto mt-6 max-w-md"
              title="Select or create a note"
              action={
                <Button variant="outline" onClick={createNote}>
                  <Plus />
                  New note
                </Button>
              }
            >
              Pick a note from the list, or start a fresh one.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteEditor({ note, onChanged }: { note: NoteRow; onChanged: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<"edit" | "preview">(note.content.trim() ? "preview" : "edit");
  const editor = useRef<RichEditorHandle>(null);
  const {
    save: queueSave,
    status,
    flush,
  } = useAutosave(`/api/notes/${note.id}`, "PATCH", onChanged);
  const save = (title: string, content: string) => queueSave({ title, content });

  return (
    <div className="mx-auto max-w-[calc(66ch+3rem)] space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              save(event.target.value, content);
            }}
            className="notebook-editor-title h-auto border-0 bg-transparent px-0 text-[26px] font-normal leading-tight tracking-[-0.02em] shadow-none focus-visible:ring-0"
            placeholder="Title"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
          >
            {mode === "preview" ? "Edit" : "Preview"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={async () => {
              if (confirm("Delete this note?")) {
                await postJson(`/api/notes/${note.id}`, undefined, "DELETE");
                onChanged();
              }
            }}
          >
            Delete
          </Button>
        </div>
        <RichEditor
          editorRef={editor}
          aiContext={`Notebook note${title.trim() ? `: ${title.trim()}` : ""}`}
          mode={mode}
          onModeChange={setMode}
          showModeToggle={false}
          value={content}
          onChange={(value) => {
            setContent(value);
            save(title, value);
          }}
        />
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span role="status">{status}</span>
          <Button variant="ghost" size="sm" onClick={() => void flush()}>
            Save now
          </Button>
        </div>
        <ReviewExport document={{ title: title || "Journal note", lines: [content] }} />
        <Attachments type="note" id={note.id} />
      </div>
    </div>
  );
}
