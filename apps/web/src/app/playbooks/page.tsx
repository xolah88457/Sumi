"use client";

import { Suspense, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AdherenceReport } from "@/components/adherence-report";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceNote } from "@/components/voice-note";
import { AiTidy } from "@/components/ai-tidy";
import { postJson, useApi } from "@/lib/use-api";

interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
  tradeCount: number;
}

export default function PlaybooksPage() {
  return (
    <Suspense>
      <Playbooks />
    </Suspense>
  );
}

function Playbooks() {
  const { data, refresh } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const rulesRef = useRef<HTMLTextAreaElement>(null);

  const create = async () => {
    await postJson("/api/playbooks", {
      name,
      description,
      rules: rules
        .split("\n")
        .map((rule) => rule.trim())
        .filter(Boolean),
    });
    setOpen(false);
    setName("");
    setDescription("");
    setRules("");
    refresh();
  };

  return (
    <div>
      <FilterBar
        title="Playbooks"
        lede="A playbook is a setup you trade on purpose. Name it, write its rules, then tag trades with it."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            New playbook
          </Button>
        }
      />
      <div className="grid gap-5 px-4 pb-8 lg:grid-cols-2 2xl:grid-cols-3">
        {data?.playbooks.length === 0 && (
          <EmptyState
            className="col-span-full"
            title="No playbooks yet"
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus />
                New playbook
              </Button>
            }
          >
            Tag your trades with a playbook and Reports will show whether that setup actually pays.
          </EmptyState>
        )}
        {data?.playbooks.map((playbook) => (
          <Card key={playbook.id} className="self-start">
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 pb-1">
              <div className="min-w-0">
                <CardTitle className="text-[21px] leading-tight tracking-[-0.02em] text-foreground">
                  {playbook.name}
                </CardTitle>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {playbook.tradeCount} trade{playbook.tradeCount === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Delete playbook: ${playbook.name}`}
                onClick={async () => {
                  if (
                    confirm(
                      `Delete "${playbook.name}"? Trades keep their data, just lose the link.`,
                    )
                  ) {
                    await postJson(`/api/playbooks/${playbook.id}`, undefined, "DELETE");
                    refresh();
                  }
                }}
              >
                <Trash2 />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {playbook.description && (
                <p className="max-w-[66ch] whitespace-pre-line text-[17px] leading-[1.65]">
                  {playbook.description}
                </p>
              )}
              {playbook.rules.length > 0 && (
                <ol className="max-w-[66ch] divide-y divide-border border-y border-border text-[17px] leading-[1.5]">
                  {playbook.rules.map((rule, index) => (
                    <li key={index} className="flex min-w-0 gap-3 break-words py-2.5">
                      <span className="tnum w-5 shrink-0 text-muted-foreground">{index + 1}.</span>
                      {rule}
                    </li>
                  ))}
                </ol>
              )}
              <AdherenceReport bookId={playbook.id} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New playbook</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (e.g. Opening range breakout)"
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="One-line description"
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[13px] text-muted-foreground">Rules (one per line)</label>
                <div className="flex items-center gap-1">
                  <VoiceNote targetRef={rulesRef} onText={(val) => setRules(val)} />
                  <AiTidy
                    text={rules}
                    onApply={setRules}
                    format="lines"
                    context={`Rules for the trading playbook${name.trim() ? ` "${name.trim()}"` : ""}`}
                  />
                </div>
              </div>
              <Textarea
                ref={rulesRef}
                value={rules}
                onChange={(event) => setRules(event.target.value)}
                placeholder={
                  "One rule per line:\nOnly A+ setups\nRisk max 1R\nNo entries after 11:30"
                }
                className="min-h-32"
              />
            </div>
            <Button onClick={create} disabled={!name}>
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
