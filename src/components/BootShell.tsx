/** Static, non-interactive startup shell; mirrors index.html before React loads. */
export default function BootShell() {
  return <div className="flow-boot-shell" role="status" aria-label="Opening Flow">
    <aside aria-hidden="true"><img src="/flow.svg?v=5" width="26" height="26" alt="" /><span>Private</span><i/><i/><i/></aside>
    <main aria-hidden="true"><header><i/></header><section><i/><i/><i/></section></main>
  </div>;
}
