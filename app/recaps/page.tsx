import { TeamIdentity } from "@/components/TeamIdentity";
import { listRecapVideos } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function RecapsPage() {
  const videos = await listRecapVideos();

  return (
    <section className="page-section">
      <div className="page-title">
        <span className="eyebrow">VIDEO ARCHIVE</span>
        <h1>Weekly recaps</h1>
        <p>The season&apos;s collection of lowest-score explanations, preserved for posterity.</p>
      </div>

      {videos.length ? (
        <div className="video-grid">
          {videos.map((item) => (
            <article className="card video-card" key={item.id}>
              <div className="video-card-head">
                <div><span className="eyebrow">WEEK {item.week}</span><TeamIdentity name={item.team_name} logo={item.team_logo} /></div>
                <strong>{item.fantasy_points?.toFixed(2)} pts</strong>
              </div>
              <video controls preload="metadata" src={item.video_url} playsInline>
                Your browser does not support embedded video.
              </video>
            </article>
          ))}
        </div>
      ) : (
        <div className="card empty-state compact"><h2>No recap videos yet.</h2><p>The first uploaded weekly recap will appear here.</p></div>
      )}
    </section>
  );
}
