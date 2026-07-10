/**
 * Shared review-KPI computation — single source of truth so the inline live strip
 * (Analysis tab) and the Metrics tab always agree. All accuracy/issue metrics are
 * computed from reviewed documents that belong to the LOADED dataset, and recompute
 * whenever `reviewed` changes (i.e. live as the user reviews).
 */
import { DocClassificationDocument, ReviewedDocClassification } from '../types/docClassification';

export interface ReviewKpis {
  total: number;
  reviewedCount: number;      // all dispositioned (manual + auto) — for completion/coverage
  userReviewedCount: number;  // human reviews only — the accuracy denominator
  autoReviewed: number;       // machine-suggested (presumed correct), awaiting human confirmation
  reviewProgress: number;     // % of dataset dispositioned
  // Accuracy/issue metrics are computed over USER (manual) reviews only — an auto-review
  // can never produce an "issue", so including it would pin accuracy at 100% (meaningless).
  hasUserReviews: boolean;
  docAccuracy: number;        // % of USER-reviewed with no classification issue
  vendorAccuracy: number;     // % of invoice USER-reviewed without a wrong-vendor matching issue
  docIssues: number;          // USER-reviewed with docClassificationIssue === 'Yes'
  vendorIssues: number;       // USER-reviewed with vendor21MatchingIssue === 'Vendor Matching Issue'
  // Vendor accuracy applies ONLY to invoices (vendor is N/A for "Others"), so it has its own
  // denominator/gate — otherwise every "Others" review counts as a free correct match.
  vendorReviewedCount: number; // invoice USER-reviews (the vendorAccuracy denominator)
  hasVendorReviews: boolean;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function computeReviewKpis(
  data: DocClassificationDocument[],
  reviewed: ReviewedDocClassification[],
): ReviewKpis {
  const total = data.length;
  const dataIds = new Set(data.map(d => d.documentId));
  const reviews = reviewed.filter(d => !!d.isAnInvoice && dataIds.has(d.documentId));
  const reviewedCount = reviews.length;

  const userReviews = reviews.filter(r => !r.isAutoReviewed);
  const userReviewedCount = userReviews.length;
  const autoReviewed = reviewedCount - userReviewedCount;

  // Vendor matching only applies to invoices — "Others" reviews have no vendor to match.
  const vendorScope = userReviews.filter(r => r.isAnInvoice === 'Invoice');
  const vendorReviewedCount = vendorScope.length;

  let docCorrect = 0, docIssues = 0;
  for (const r of userReviews) {
    if (r.docClassificationIssue !== 'Yes') docCorrect++; else docIssues++;
  }
  let vendorCorrect = 0, vendorIssues = 0;
  for (const r of vendorScope) {
    if (r.vendor21MatchingIssue !== 'Vendor Matching Issue') vendorCorrect++; else vendorIssues++;
  }

  return {
    total,
    reviewedCount,
    userReviewedCount,
    autoReviewed,
    reviewProgress: pct(reviewedCount, total),
    hasUserReviews: userReviewedCount > 0,
    docAccuracy: pct(docCorrect, userReviewedCount),
    vendorAccuracy: pct(vendorCorrect, vendorReviewedCount),
    docIssues,
    vendorIssues,
    vendorReviewedCount,
    hasVendorReviews: vendorReviewedCount > 0,
  };
}
