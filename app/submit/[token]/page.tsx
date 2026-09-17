import { RecapUploader } from "@/components/RecapUploader";
import { TeamIdentity } from "@/components/TeamIdentity";
import { getRecapByUploadToken } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SubmitRecapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const recap = await getRecapByUploadToken(token);

  if (!recap) {
    return (
      <section className="login-wrap">
        <div className="card upload-card">
          <span className="eyebrow">RECAP UPLOAD</span>
          <h1>Link unavailable</h1>
          <p>This upload link is invalid, has already been used, or was replaced by a newer link. Ask the commissioner for a fresh link.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="login-wrap">
      <div className="card upload-card">
        <span className="eyebrow">WEEK {recap.week} RECAP</span>
        <h1>Submit your video</h1>
        <div className="upload-team"><TeamIdentity name={recap.team_name} logo={recap.team_logo} /></div>
        <p>Record your Week {recap.week} recap directly on this page, or upload an existing compressed video. Once the upload completes, the recap is automatically marked complete and added to the league archive.</p>
        <RecapUploader token={token} />
      </div>
    </section>
  );
}
