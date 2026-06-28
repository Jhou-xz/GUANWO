// 神煞标签：点开看释义，键盘也可达（Enter/Space）。八字柱与每日一瞥共用。
export default function SsTag({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      className="ss-tag" role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      {label}
    </span>
  )
}
