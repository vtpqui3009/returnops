import { CircleAlert, PackageOpen } from "lucide-react";
import type { CaseDetail } from "../../shared/contracts";

const explanations: Record<string, { title: string; description: string }> = {
  DELIVERY_CONFLICT: { title: "Delivery conflict", description: "The delivery record conflicts with the claim. Review the current carrier evidence." },
  REPEATED_COMPLAINTS: { title: "Repeated recent complaints", description: "Recent complaint history needs a closer look before a decision is made." },
  OVER_HARD_CAP: { title: "Above automatic approval limit", description: "The order amount exceeds the shop’s automatic approval limit. An owner decision is required." },
  HARD_CAP: { title: "Amount requires review", description: "The order amount does not meet the requirements for automatic approval." },
  OUTSIDE_POLICY_WINDOW: { title: "Delivery timing requires review", description: "Delivery information does not meet the automatic approval window requirements." },
  CURRENT_VERIFIED_PROOF_REQUIRED: { title: "Verified evidence needed", description: "Add and verify evidence for the current order details before continuing." },
  OWNER_REVIEW_REQUIRED: { title: "Owner decision needed", description: "This request does not match an eligible automatic resolution." },
  APPROVED_RULE: { title: "Shop rule applied", description: "This request met the requirements of an approved shop rule." },
  AGENT_ESCALATION: { title: "Additional review needed", description: "The evaluation referred this request to the owner for a decision." },
};

export function RequestSummary({ detail: c, statusLabel }: { detail: CaseDetail; statusLabel: string }) {
  // Policy reasons can repeat risk flags; show each concern once.
  const codes = [...new Set([...c.flags, ...c.reasons])].filter(code => code !== "HARD_CAP" || !c.flags.includes("OVER_HARD_CAP") && !c.reasons.includes("OVER_HARD_CAP"));
  const concerns = codes.map(code => explanations[code] || { title: "Additional review needed", description: "An additional policy check needs attention. Review the evidence before deciding." });
  const heading = c.status === "NEEDS_OWNER_REVIEW" ? "Why owner review is needed" : c.status === "COMPLETED" ? "Decision context" : "What needs attention";

  return <section className="panel request-summary">
    <div className="panel-heading request-summary-heading">
      <h2>Request details</h2>
      <span className={`badge badge-${c.status === "COMPLETED" ? "success" : "warning"}`}>{statusLabel}</span>
    </div>
    <div className="order-summary">
      <span className="product-visual" aria-hidden="true"><PackageOpen /></span>
      <div className="request-order"><strong>Order {c.order.id}</strong><p>Case version {c.caseVersion}</p></div>
      <div className="request-amount"><span>Order amount</span><strong>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "VND" }).format(c.order.amountVnd)}</strong></div>
    </div>
    <dl className="facts-grid">
      <div><dt>Current tracking number</dt><dd>{c.order.tracking}</dd></div>
      <div><dt>Delivery date</dt><dd>{c.order.deliveredAt === null ? "No delivery information" : new Date(c.order.deliveredAt * 1000).toLocaleDateString("en-GB")}</dd></div>
      <div className="request-description"><dt>Request</dt><dd>{c.claim}</dd></div>
    </dl>
    {concerns.length > 0 && <div className="request-concerns">
      <h3>{c.status !== "COMPLETED" && <CircleAlert size={18} aria-hidden="true" />}{heading}</h3>
      <ul>{concerns.map((concern, i) => <li key={codes[i]}><strong>{concern.title}</strong><p>{concern.description}</p></li>)}</ul>
    </div>}
  </section>;
}
