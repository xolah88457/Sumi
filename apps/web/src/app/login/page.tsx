"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SumiMark } from "@/components/sumi-mark";
import { postJson } from "@/lib/use-api";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await postJson("/api/auth", { password });
      router.push("/");
      router.refresh();
    } catch {
      setError("Wrong password");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2 text-center">
              <SumiMark className="mx-auto h-6 w-7 text-brand" />
              <h1 className="text-[32px] font-normal leading-none tracking-[-0.035em]">
                Sumi<span className="text-brand">.</span>
              </h1>
              <p className="text-[15px] text-muted-foreground">Enter your password to unlock.</p>
            </div>
            <Input
              type="password"
              aria-label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoFocus
            />
            {error && <Notice role="alert" tone="error" title={error} />}
            <Button type="submit" className="w-full">
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
