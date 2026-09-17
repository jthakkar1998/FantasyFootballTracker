# Direct Recap Recorder Upgrade

This version keeps the existing recap archive/upload feature and adds a browser-based recorder designed around the Supabase Free file-size limit.

## Supabase Storage

Use the existing public bucket named `recap-videos`.

- File size limit: **50 MB**
- Allowed MIME types:
  - `video/mp4`
  - `video/quicktime`
  - `video/webm`

No additional SQL migration is required if `supabase/recap-videos-migration.sql` was already run.

## Recording behavior

The `/submit/[token]` page now:

- requests the front-facing camera and microphone;
- requests video up to 1280×720 at 30 fps;
- targets 2.0 Mbps video and 96 kbps audio;
- stops automatically at 2 minutes;
- also stops early if recorded chunks approach 46 MB;
- verifies the finished file is no larger than 48 MB;
- lets the user preview or re-record before submitting;
- retains existing-file upload as a fallback, capped at 48 MB.

The browser controls the encoder, so bitrate is a target rather than an absolute guarantee. The explicit file-size checks prevent an oversized recording from being submitted.

## Environment variables

No new variables beyond the prior video-enabled version:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Keep `SUPABASE_SECRET_KEY` server-only.

## Testing

1. Run `npm run dev`.
2. Open `/admin` and create a recap upload link.
3. Open the link on your phone using the Mac's deployed HTTPS site for the most realistic test, or use `localhost` on the Mac for desktop-camera testing.
4. Tap **Record recap** and allow camera/microphone permission.
5. Record, stop, preview, and submit.
6. Confirm the recap becomes complete and appears under `/recaps`.
