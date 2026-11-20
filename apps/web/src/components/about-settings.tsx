"use client";

import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { SumiMark } from "@/components/sumi-mark";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDesktopInfo } from "@/lib/desktop-info";

export const SOURCE_REPO_URL = "https://github.com/xolah88457/trade-journal";

export const CORE_MIT_LICENSES = [
  {
    id: "luxalgo",
    name: "LuxAlgo Trade Journal",
    upstream: "https://github.com/LuxAlgo/trade-journal",
    copyright: "Copyright (c) 2026 LuxAlgo Global, LLC",
    description: "Core trade journal engine, database schemas, and analytics.",
    licenseText: `MIT License

Copyright (c) 2026 LuxAlgo Global, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
  {
    id: "kami",
    name: "Kami Design & Editorial Theme",
    upstream: "https://github.com/tw93/Kami",
    copyright: "Copyright (c) 2026 Tw93",
    description: "Visual palette (parchment, ivory, navy) and editorial typography influences.",
    licenseText: `MIT License

Copyright (c) 2026 Tw93

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
  {
    id: "transcribe-cpp",
    name: "transcribe.cpp Voice Engine",
    upstream: "https://github.com/handy-computer/transcribe.cpp",
    copyright: "Copyright (c) 2024-present The transcribe.cpp authors",
    description: "On-device speech recognition runtime and Apple Metal bindings.",
    licenseText: `MIT License

Copyright (c) 2024-present The transcribe.cpp authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
  {
    id: "silero-vad",
    name: "Silero VAD",
    upstream: "https://github.com/snakers4/silero-vad",
    copyright: "Copyright (c) 2020-present Silero Team",
    description: "Voice activity detection model (bundled asset silero-vad-v6.2-F32.gguf).",
    licenseText: `MIT License

Copyright (c) 2020-present Silero Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
] as const;

export function AboutSettings() {
  const { isDesktop, info, isLoading, isChecking, error, checkCompletionKey, checkForUpdates } =
    useDesktopInfo();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Project overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary p-2 text-foreground">
              <SumiMark className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[21px] font-normal leading-snug tracking-[-0.02em] text-foreground">
                  Sumi Trading Journal
                </h3>
                <Badge variant="outline" className="text-[13px] font-normal">
                  Local Desktop
                </Badge>
              </div>
              <p className="text-[15px] text-muted-foreground">
                An independent, private local desktop trading journal engineered for offline-first
                trade tracking, multi-asset analytics, and disciplined reflection.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-[15px] text-muted-foreground">
            <p>
              <strong className="font-normal text-foreground">Core Application:</strong> Based on
              the open-source{" "}
              <a
                href="https://github.com/LuxAlgo/trade-journal"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                LuxAlgo Trade Journal
              </a>{" "}
              (MIT License, Copyright &copy; 2026 LuxAlgo Global, LLC).
            </p>
            <p>
              <strong className="font-normal text-foreground">Visual Theme:</strong> Inspired by{" "}
              <a
                href="https://github.com/tw93/Kami"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Kami
              </a>{" "}
              by Tw93 (MIT License, Copyright &copy; 2026 Tw93), adapting its parchment, ivory, and
              deep navy editorial aesthetic. Sumi uses independent branding and the Charis SIL
              typeface (SIL Open Font License 1.1), bundled with the app. Nothing is fetched at
              runtime and there is no remote tracking.
            </p>
          </div>

          <Notice title="Independence & No-Affiliation Notice">
            Sumi is an independent local desktop adaptation, not an official product of LuxAlgo or
            Tw93. Sumi is not affiliated with, maintained by, or endorsed by LuxAlgo Global, LLC or
            Tw93. References to upstream projects and trademarks are made solely for factual
            attribution under nominative fair use.
          </Notice>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="outline" size="sm" asChild>
              <a
                href={SOURCE_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Source repository
              </a>
            </Button>
            <span className="text-[13px] text-muted-foreground font-mono">{SOURCE_REPO_URL}</span>
          </div>

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Open source and local first: your journal is stored on this device. Sumi is a journaling
            tool, not investment advice.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application updates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isDesktop ? (
            <Notice title="Web browser mode">
              Running in a web browser. Native desktop features, local shell integration, and
              automatic software updates are active only in the Sumi desktop application.
            </Notice>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] text-foreground">Sumi Desktop</span>
                    {info?.version && (
                      <Badge variant="outline" className="font-mono text-[13px]">
                        v{info.version}
                      </Badge>
                    )}
                  </div>
                  {info && (
                    <p className="font-mono text-[13px] text-muted-foreground">
                      Version {info.version} &bull; Tauri {info.tauriVersion || "unknown"} &bull;{" "}
                      {info.platform} ({info.arch})
                    </p>
                  )}
                  {isLoading && !info && (
                    <p className="text-[13px] text-muted-foreground">
                      Reading desktop runtime info…
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={checkForUpdates}
                    disabled={isChecking}
                    aria-busy={isChecking}
                    className="gap-1.5"
                  >
                    {isChecking ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        <span>Checking for updates…</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        <span>Check for updates…</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Checks for updates and prompts to download, install, and restart Sumi. Save your
                work first.
              </p>

              {error && (
                <Notice
                  role="alert"
                  tone="error"
                  icon={<AlertCircle />}
                  title={error}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkForUpdates}
                      disabled={isChecking}
                    >
                      Retry
                    </Button>
                  }
                />
              )}
              {!error && info?.update?.status === "available" && (
                <Notice icon={<CheckCircle2 />}>
                  Update available
                  {info.update.availableVersion ? `: v${info.update.availableVersion}` : ""}.{" "}
                  {info.update.message || "Native updater window will guide download and restart."}
                </Notice>
              )}

              {!error && info?.update?.status === "downloading" && (
                <Notice icon={<Loader2 className="animate-spin" />}>
                  {info.update.message || "Downloading update…"}
                </Notice>
              )}

              {!error && info?.update?.status === "downloaded" && (
                <Notice icon={<CheckCircle2 />}>
                  {info.update.message || "Update downloaded; ready to install."}
                </Notice>
              )}

              {!error && info?.update?.status === "installing" && (
                <Notice icon={<Loader2 className="animate-spin" />}>
                  {info.update.message || "Installing update…"}
                </Notice>
              )}

              {!error && info?.update?.status === "unavailable" && (
                <Notice icon={<AlertCircle />}>
                  {info.update.message ||
                    "Automatic updates are unavailable for this installation format."}
                </Notice>
              )}

              {!error &&
                checkCompletionKey > 0 &&
                (!info?.update ||
                  info.update.status === "not-available" ||
                  info.update.status === "idle") && (
                  <Notice icon={<CheckCircle2 />}>
                    Sumi is up to date (version {info?.version || "0.2.0"}).
                  </Notice>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Core open-source licenses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[15px] text-muted-foreground">
            Original MIT copyright and permission notices for core software and design components.
            Click any section below to inspect its verbatim license text.
          </p>

          <div className="space-y-3">
            {CORE_MIT_LICENSES.map((item) => (
              <details
                key={item.id}
                className="group rounded-xl border border-border bg-card p-4 text-[13px] transition-colors open:bg-muted"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-[15px] text-foreground select-none">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{item.name}</span>
                    <span className="text-muted-foreground font-normal text-[13px]">
                      &mdash; {item.copyright}
                    </span>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[13px]">
                    MIT
                  </Badge>
                </summary>
                <div className="mt-3 space-y-2.5 border-t border-border pt-3">
                  <p className="text-muted-foreground">{item.description}</p>
                  <div className="flex flex-wrap items-center gap-1 text-[13px]">
                    <span className="text-muted-foreground">Upstream:</span>
                    <a
                      href={item.upstream}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                    >
                      {item.upstream}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                  <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap select-text">
                    {item.licenseText}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice engine & model notices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-[15px] text-muted-foreground">
          <p>
            Local voice dictation runs entirely on-device with no audio streams or transcription
            data transmitted over the network.
          </p>

          <div className="space-y-2 rounded-lg bg-secondary px-4 py-3.5 text-[13px]">
            <div>
              <p className="text-[15px] text-foreground">Local Voice Runtime & VAD</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                Software libraries (
                <code className="font-mono text-foreground">transcribe-cpp</code> and native Apple
                Metal binaries) and the bundled Voice Activity Detection model asset (
                <code className="font-mono text-foreground">silero-vad-v6.2-F32.gguf</code>, 1.2 MB)
                are licensed under the MIT License (Silero Team &amp; transcribe.cpp authors).
              </p>
            </div>

            <div className="border-t border-border pt-2">
              <p className="text-[15px] text-foreground">
                Model License Metadata Caveat &amp; External Storage
              </p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                The optional speech-to-text recognition model is based on NVIDIA Parakeet Unified EN
                0.6B (
                <code className="font-mono text-foreground">nvidia/parakeet-unified-en-0.6b</code>
                ), converted to GGUF Q8_0 format by handy-computer.
              </p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Licensing metadata caveat:</strong> Repository
                metadata header lists <code className="font-mono">CC-BY-4.0</code>, whereas the
                underlying base model card specifies governing terms under the{" "}
                <em>NVIDIA Open Model License Agreement</em> (&ldquo;Licensed by NVIDIA Corporation
                under the NVIDIA Open Model License&rdquo;).
              </p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                <strong className="text-foreground">External storage:</strong> Heavy speech model
                weights (~731 MB) are <em>not redistributed within the application bundle</em>. They
                are downloaded or cached strictly outside the application into user local storage (
                <code className="font-mono">~/Library/Application Support/Sumi/voice</code>) or
                reused read-only from your local HuggingFace cache upon user request.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bundled third-party notices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-[15px] text-muted-foreground">
          <p>
            Sumi includes standard open-source dependencies (Next.js, React, SQLite, Radix UI,
            Tailwind CSS, and associated utilities). Each package retains its original open-source
            license.
          </p>
          <p className="text-[13px] leading-relaxed">
            The full catalog of third-party dependency licenses and notices is bundled offline with
            desktop releases at{" "}
            <code className="font-mono text-foreground">
              Contents/Resources/licenses/THIRD-PARTY-NOTICES.md
            </code>{" "}
            and{" "}
            <code className="font-mono text-foreground">
              Contents/Resources/licenses/dependencies/
            </code>{" "}
            inside the application bundle (source repository path:{" "}
            <code className="font-mono text-foreground">desktop/THIRD-PARTY-NOTICES.md</code>). All
            notices in this section are presented statically and offline without background network
            or file-system queries.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
