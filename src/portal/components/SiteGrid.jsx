export default function SiteGrid({ categories, onOpen, onLog }) {
  if (!categories.length) return null

  return (
    <>
      {categories.map((cat) => (
        <section className="site-cat" key={cat.name}>
          <h2>{cat.name}</h2>
          <div className="site-grid">
            {cat.sites.map((site) => {
              const inStore = site.kind === 'in_store'
              return (
                <button
                  className={`site-tile ${inStore ? 'in-store' : ''}`}
                  key={site.id}
                  onClick={() => (inStore ? onLog(site) : onOpen(site))}
                >
                  <span className="site-emoji" aria-hidden="true">
                    {site.emoji || (inStore ? '🏪' : '🛒')}
                  </span>
                  <span className="site-name">{site.name}</span>
                  {site.blurb && <span className="site-blurb">{site.blurb}</span>}
                  <span className="site-action">
                    {inStore ? 'Log a receipt' : 'Open store →'}
                    {site.auto_import && <span className="site-auto">logs itself</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
