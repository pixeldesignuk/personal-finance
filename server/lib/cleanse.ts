import { reconcile } from "../categorise/reconcile.ts";
import { autoNameMerchants } from "./merchantNaming.ts";
import { autoMerchantDomains } from "./merchantDomains.ts";
import type { AuditFn } from "../categorise/audit.ts";

// One-shot AI data cleanse: clean merchant names from statement lines, resolve
// brand logo domains, then categorise any uncategorised transactions. Each step
// only touches un-done records, so it's safe to re-run and resumes across runs
// (Gemini's free tier is rate-limited, so a large backlog completes over a few
// passes). Streams progress via the audit callback.
export async function cleanseData(audit: AuditFn): Promise<{ merchantsNamed: number; domainsSet: number; categorised: number; stillUncategorised: number }> {
  audit({ kind: "log", text: "● Cleaning merchant names (statement → brand)", tone: "bold" });
  const named = await autoNameMerchants(audit, 200);

  audit({ kind: "log", text: "● Resolving logo domains", tone: "bold" });
  const domains = await autoMerchantDomains(audit, 200);

  audit({ kind: "log", text: "● Categorising transactions", tone: "bold" });
  const recon = await reconcile({ audit });

  const categorised = recon.byRules + recon.byLlm;
  return { merchantsNamed: named.named, domainsSet: domains.set, categorised, stillUncategorised: recon.total - categorised };
}
