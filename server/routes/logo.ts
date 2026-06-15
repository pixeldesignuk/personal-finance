import { Router } from "express";
import { storageEnabled, presignGet } from "../lib/storage.ts";
import { ensureLogo, ensureBrandColor, resolveBest, normalizeDomain } from "../lib/logos/index.ts";

export const logoRouter = Router();

// Brand metadata (currently just the avatar colour) for a domain. Cheap JSON,
// resolved lazily from the Brandfetch Brand API and cached. { color: hex | null }.
logoRouter.get("/logo/:domain/meta", async (req, res, next) => {
  try {
    const d = normalizeDomain(req.params.domain);
    const color = d ? await ensureBrandColor(d) : null;
    res.set("Cache-Control", "public, max-age=600");
    res.json({ color });
  } catch (err) {
    next(err);
  }
});

// Merchant logo for a domain. Primary path: the bucket-cached image (resolved
// once from the provider chain — Brandfetch → logo.dev → DuckDuckGo). Fallbacks,
// in order:
//   1. bucket cache hit            → redirect to a presigned URL
//   2. cache miss (providers tried) → 404 (client shows a monogram)
//   3. bucket/cache layer errored, OR no bucket configured (dev)
//                                  → resolve live from the providers and stream
// So a failure of the primary (cache) layer still falls through to the live
// provider chain rather than dropping straight to a monogram.
logoRouter.get("/logo/:domain", async (req, res, next) => {
  try {
    const d = normalizeDomain(req.params.domain);
    if (!d) { res.status(404).end(); return; }
    const name = typeof req.query.name === "string" ? req.query.name : null;

    if (storageEnabled()) {
      try {
        const hit = await ensureLogo(d, name);
        if (hit) {
          res.set("Cache-Control", "public, max-age=600");
          res.redirect(302, await presignGet(hit.key, 3600));
          return;
        }
        // Clean miss: every provider was tried and negative-cached — don't
        // re-resolve on each request, just tell the client to show a monogram.
        res.set("Cache-Control", "public, max-age=600");
        res.status(404).end();
        return;
      } catch (err) {
        // Bucket/cache failure — fall through to a live, uncached resolve below.
        console.error("logo cache failed, falling back to live resolve:", err instanceof Error ? err.message : err);
      }
    }

    // No bucket (dev) or the cache failed: resolve straight from the provider
    // chain (with the name-search fallback) and stream the winner's bytes.
    const live = await resolveBest(d, name);
    if (live) {
      res.set("Content-Type", live.contentType);
      res.set("Cache-Control", "public, max-age=600");
      res.send(live.body);
      return;
    }
    res.set("Cache-Control", "public, max-age=600");
    res.status(404).end();
  } catch (err) {
    next(err);
  }
});
