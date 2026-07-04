"use client";

import { useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
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
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // Presigned URLs are fetched on first click and kept here so the second
  // click can be a real <a target="_blank"> navigation (see below for why).
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({});

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

  // Presigned URLs expire in 5 minutes; drop any fetched ones once the menu
  // closes so reopening later always fetches a fresh link.
  const handleOpenChange = (open: boolean) => {
    if (open) {
      loadFiles();
    } else {
      setFileUrls({});
    }
  };

  const fetchFileUrl = async (key: string) => {
    setLoadingKey(key);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(
        `/api/knowledge-base/file-url?key=${encodeURIComponent(key)}`,
        { headers }
      );
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const data = await response.json();
      setFileUrls((prev) => ({ ...prev, [key]: data.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open file.");
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
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
          {files?.map((file) => {
            const url = fileUrls[file.key];
            // Once we have a presigned URL, render a real <a target="_blank">
            // so the second click is a genuine link navigation - immune to
            // popup blockers, unlike a script-triggered window.open() (which
            // browsers can block even when called synchronously from a
            // click, depending on how the menu library dispatches onSelect).
            if (url) {
              return (
                <DropdownMenuItem key={file.key} asChild className="flex items-center justify-between gap-2">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <span className="truncate">{file.key}</span>
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  </a>
                </DropdownMenuItem>
              );
            }
            return (
              <Tooltip key={file.key}>
                <TooltipTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      fetchFileUrl(file.key);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{file.key}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {loadingKey === file.key ? (
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
            );
          })}
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
