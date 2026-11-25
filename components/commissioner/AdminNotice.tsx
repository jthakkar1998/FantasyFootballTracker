type Params = { synced?: string; error?: string; uploadLink?: string; testPush?: string };
export function AdminNotice({ params }: { params: Params }) {
  return <>
    {params.synced ? <div className="notice success">ESPN sync completed.</div> : null}
    {params.testPush ? <div className="notice success">Push service accepted {params.testPush.replace("-", "/")} test notifications. Check the actual phones.</div> : null}
    {params.error ? <div className="notice error">Action failed: {params.error}</div> : null}
    {params.uploadLink ? <div className="notice success upload-link-notice"><strong>Private recap link created.</strong>
      <p>Copy this link and send it only to the manager who owes this recap. Creating another link replaces the previous link.</p>
      <input readOnly value={params.uploadLink} aria-label="Private recap upload link" /></div> : null}
  </>;
}
