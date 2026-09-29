import { useState, type FormEvent } from "react";
import { Key02Icon, Loading03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccessKeyError, api, setAccessKey } from "@/lib/api";

// Shown when the page has no key, or an old one. The key is in the link the map printed.
export function KeyEntry({ reason, onReady }: { reason: "missing" | "stale"; onReady: () => void }) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!setAccessKey(value)) {
      setProblem("That is not the map link or key. Paste the whole link, or the 64 characters after #k=.");
      return;
    }
    setChecking(true);
    setProblem(null);
    try {
      await api.meta();
      onReady();
    } catch (err) {
      setProblem(
        err instanceof AccessKeyError
          ? "This key belongs to an earlier run of the map. Copy the newest link from where the map is running."
          : "The map did not answer. Check that it is still running, then try again.",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <Card className="w-full max-w-md rounded-xl shadow-none">
        <CardContent className="flex flex-col gap-4 px-5 py-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Key02Icon size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[16px] font-semibold">{reason === "stale" ? "The map restarted" : "Enter the map key"}</h1>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                {reason === "stale"
                  ? "Each start creates a new key, so this page needs the new link."
                  : "This page was opened without its key. The key keeps other programs on this computer out of your map."}{" "}
                Paste the link printed where the map is running. Your AI can also give you the link.
              </p>
            </div>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
            <Label htmlFor="map-key" className="text-[13px]">
              Map link or key
            </Label>
            <Input
              id="map-key"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="http://127.0.0.1:…/#k=…"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? "map-key-problem" : undefined}
              className="rounded-md font-mono text-[13px]"
            />
            <p id="map-key-problem" role="alert" className="min-h-5 text-[12px] text-destructive">
              {problem}
            </p>
            <Button type="submit" className="self-start rounded-md" disabled={checking || !value.trim()}>
              {checking ? <Loading03Icon size={16} className="animate-spin" aria-hidden="true" /> : null}
              Open the map
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
