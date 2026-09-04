export default function SiteGrid({ categories, onOpen }) {
  if (!categories.length) return null

  return (
    <>
      {categories.map((cat) => (
        <section className="site-cat" key={cat.name}>
          <h2>{cat.name}</h2>
          <div className="site-grid">
            {cat.sites.map((site) => (
              <button className="site-tile" key={site.id} onClick={() => onOpen(site)}>
                <span className="site-emoji" aria-hidden="true">
                  {site.emoji || '🛒'}
                </span>
                <span className="site-name">{site.name}</span>
                {site.blurb && <span className="site-blurb">{site.blurb}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
