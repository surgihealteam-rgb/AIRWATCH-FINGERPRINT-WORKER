# AirWatch fingerprint worker (browser-deployable via Render)

This separate long-running worker uses `fpcalc`/Chromaprint to extract an audio fingerprint from each uploaded video/audio file in the private Supabase Storage bucket. It polls `public.cuts` for rows whose `fingerprint_status = 'pending'`, downloads the object, and writes the fingerprint to `cuts.fingerprint`.

## Deploy with a browser
1. Create a NEW public or private GitHub repository named `AIRWATCH-FINGERPRINT-WORKER`.
2. Upload the files in this folder (`Dockerfile`, `package.json`, `worker.js`, `README.md`) to the repository root.
3. In Render, create a **Background Worker** from that repository. Choose Docker as the runtime if prompted.
4. Add environment variables in Render (do not put secrets in GitHub):
   - `SUPABASE_URL` = same project URL used by AirWatch
   - `SUPABASE_SERVICE_ROLE_KEY` = same service-role key already stored in Vercel
   - `SUPABASE_STORAGE_BUCKET` = `trailer-cuts`
   - Optional: `POLL_INTERVAL_MS` = `10000`
5. Deploy. In Render logs, expect `AirWatch fingerprint worker started...`.
6. Upload a small audio/video cut to AirWatch. After the worker polls, its `fingerprint_status` should become `ready` or `failed`.

## Important
- The worker must be running continuously for automatic processing. It does not itself monitor live TV or compare a broadcast feed.
- Audio fingerprinting works only if `fpcalc` can decode the uploaded media. Some unusual formats may fail.
- This is a first processing worker, not production-hardened: concurrent worker locking, retries/backoff, authentication/tenant isolation, and operational monitoring should be added before production use.
- Keep the Supabase service-role key secret. Never commit it to GitHub or put it in browser code.
