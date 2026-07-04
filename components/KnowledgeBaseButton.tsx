"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authHeaders } from "@/lib/authenticated-fetch";

interface KnowledgeBaseFile {
  key: string;
  size: number;
  lastModified: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBaseButton() {
  const [files, setFiles] = useState<KnowledgeBaseFile[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const loadFiles = async () => {
    if (files || isLoading) return; // cache within this mount; reopen refetches only if empty/errored
    setIsLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/knowledge-base/files", { headers });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const data = await response.json();
      setFiles(data.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    } finally {
      setIsLoading(false);
    }
  };

  const openFile = async (key: string) => {
    setOpeningKey(key);
    // Open the tab synchronously, as a direct result of the click, so
    // browsers (Safari especially) don't treat it as a blocked popup - if
    // this happened after the awaits below instead, it would no longer
    // count as a direct user-gesture response. We navigate this tab once
    // the presigned URL comes back.
    const newTab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const headers = await authHeaders();
      const response = await fetch(
        `/api/knowledge-base/file-url?key=${encodeURIComponent(key)}`,
        { headers }
      );
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const data = await response.json();
      if (newTab) {
        newTab.location.href = data.url;
      } else {
        setError("Pop-up blocked - please allow pop-ups for this site.");
      }
    } catch (err) {
      newTab?.close();
      setError(err instanceof Error ? err.message : "Failed to open file.");
    } finally {
      setOpeningKey(null);
    }
  };

  return (
    <DropdownMenu onOpenChange={(open) => open && loadFiles()}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs rounded-full">
          <FileText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Knowledge Base</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Knowledge base documents</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading...
          </div>
        )}
        {error && <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
        {!isLoading && !error && files?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No documents uploaded yet.</p>
        )}
        <TooltipProvider delayDuration={200}>
          {files?.map((file) => (
            <Tooltip key={file.key}>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    openFile(file.key);
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{file.key}</span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {openingKey === file.key ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      formatSize(file.size)
                    )}
                  </span>
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[280px] break-all text-xs">
                {file.key}
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
