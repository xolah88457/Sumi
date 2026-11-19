import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { CurrencyScope } from "@/lib/currencies";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function CurrencyNotice({ scope }: { scope: CurrencyScope }) {
  if (scope.converted)
    return (
      <p className="px-4 pb-4 text-[13px] text-muted-foreground">
        Trading P&amp;L in {scope.currency} · saved baseline conversion rates.{" "}
        <Link className="underline" href="/settings#currency-conversion">
          Edit rates
        </Link>
      </p>
    );
  if (scope.monetary && !scope.missingCurrencies.length) return null;
  return (
    <div className="px-4 pb-5">
      <Notice
        role="status"
        icon={<TriangleAlert />}
        title="Set up conversion to see your combined dashboard"
        action={
          <Button asChild size="sm">
            <Link href="/settings#currency-conversion">Set up currency conversion</Link>
          </Button>
        }
      >
        {scope.missingCurrencies.length
          ? `Save conversion rates for ${scope.missingCurrencies.join(", ")} to use the reporting currency. Amounts below remain in their original currencies.`
          : `These accounts use ${scope.sourceCurrencies.join(", ")}. Set your conversion rates to combine their performance.`}
      </Notice>
    </div>
  );
}
